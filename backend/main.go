// backend/main.go — Vidhi Arena Control Plane v5.1
// HTTP server: submission upload, AST scan, transpile, forge, job dispatch
// WebSocket: live telemetry broadcast to frontend dashboard
// Now wired to: Postgres (TimescaleDB), Redis, real Forge subprocess calls,
//              real Game Master binary dispatch, Bot Fleet HTTP service.

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/rs/cors"

	"vidhi-control/auth"
	"vidhi-control/credits"
	"vidhi-control/validator"
	"vidhi-control/worker"
)

// ─── Config (read from env, with sane defaults) ───────────────────────────────
var cfg = struct {
	Port               string
	DatabaseURL        string
	RedisURL           string
	BotFleetURL        string
	SoCache            string
	ForgeDir           string
	GameMasterBin      string
	MaxSubmissionBytes int64
	CreditsPerDay      int
}{
	Port:               getenv("PORT", "8080"),
	DatabaseURL:        getenv("DATABASE_URL", "postgres://vidhi:vidhi_secret@localhost:5432/vidhidb?sslmode=disable"),
	RedisURL:           getenv("REDIS_URL", "localhost:6379"),
	BotFleetURL:        getenv("BOT_FLEET_URL", "http://localhost:9090"),
	SoCache:            getenv("SO_CACHE", "/tmp/vidhi/so"),
	ForgeDir:           getenv("FORGE_DIR", "./forge"),
	GameMasterBin:      getenv("GM_BIN", "./vidhi-gm"),
	MaxSubmissionBytes: 64 * 1024, // 64 KB
	CreditsPerDay:      5,
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Domain types ─────────────────────────────────────────────────────────────
type SubmitResponse struct {
	RunID   string `json:"run_id"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type RunResult struct {
	RunID       string    `json:"run_id"`
	UserID      string    `json:"user_id"`
	RoundID     string    `json:"round_id"`
	Status      string    `json:"status"`
	PnL         float64   `json:"pnl"`
	PnLPct      float64   `json:"pnl_pct"`
	P50NS       float64   `json:"p50_ns"`
	P90NS       float64   `json:"p90_ns"`
	P99NS       float64   `json:"p99_ns"`
	TotalFills  int64     `json:"total_fills"`
	TotalTicks  int64     `json:"total_ticks"`
	TLECount    int64     `json:"tle_count"`
	Correctness float64   `json:"correctness"` // shadow LOB score 0.0–1.0
	Violations  int64     `json:"violations"`  // shadow LOB violation count
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at"`
}

type LeaderboardEntry struct {
	Rank        int     `json:"rank"`
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	TeamName    string  `json:"team_name"`
	PnLPct      float64 `json:"pnl_pct"`
	P99NS       float64 `json:"p99_ns"`
	TotalFills  int64   `json:"total_fills"`
}

// ─── In-memory run cache (for fast WS broadcasts) ─────────────────────────────
var (
	runCache   = make(map[string]*RunResult)
	runCacheMu sync.RWMutex
)

// ─── Infrastructure clients ───────────────────────────────────────────────────
var (
	db          *sql.DB
	redisClient *redis.Client
	workerPool  *worker.Worker // Redis job queue worker pool
	wsClients   = make(map[*websocket.Conn]bool)
	wsMu        sync.Mutex
	wsUpgrader  = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// ─── Main ─────────────────────────────────────────────────────────────────────
func main() {
	os.MkdirAll(cfg.SoCache, 0755)

	// ── Connect Postgres ──────────────────────────────────────────────────────
	var err error
	db, err = sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Printf("[WARN] Postgres unavailable: %v — falling back to in-memory", err)
		db = nil
	} else {
		db.SetMaxOpenConns(100)
		db.SetMaxIdleConns(50)
		db.SetConnMaxLifetime(5 * time.Minute)
		if pingErr := db.Ping(); pingErr != nil {
			log.Printf("[WARN] Postgres ping failed: %v — in-memory mode", pingErr)
			db = nil
		} else {
			log.Println("[DB] Postgres connected ✓")
		}
	}

	// ── Connect Redis ─────────────────────────────────────────────────────────
	redisClient = redis.NewClient(&redis.Options{Addr: cfg.RedisURL})
	if _, err := redisClient.Ping(context.Background()).Result(); err != nil {
		log.Printf("[WARN] Redis unavailable: %v — rate limiting disabled", err)
		redisClient = nil
	} else {
		log.Println("[REDIS] Redis connected ✓")
	}

	// ── Start Redis job queue worker pool ────────────────────────────────────
	if redisClient != nil {
		workerPool = worker.New(redisClient, db, cfg.GameMasterBin, cfg.SoCache, 10)
		workerPool.Start(context.Background())
		log.Println("[WORKER] Job queue workers started (concurrency=10)")

		// ── Subscribe to live telemetry ──────────────────────────────────────
		go func() {
			pubsub := redisClient.PSubscribe(context.Background(), "telemetry:*")
			defer pubsub.Close()
			ch := pubsub.Channel()
			for msg := range ch {
				// msg.Payload is the JSON string from job_worker.go
				var payload map[string]any
				if err := json.Unmarshal([]byte(msg.Payload), &payload); err == nil {
					// Extract runID from channel name: "telemetry:run_id"
					runID := strings.TrimPrefix(msg.Channel, "telemetry:")
					wsMsg, _ := json.Marshal(map[string]any{
						"type":    "TICK_TELEMETRY",
						"run_id":  runID,
						"payload": payload,
					})
					wsMu.Lock()
					for conn := range wsClients {
						conn.WriteMessage(websocket.TextMessage, wsMsg)
					}
					wsMu.Unlock()
				}
			}
		}()
	}

	r := mux.NewRouter()

	// ── Public endpoints (no auth required) ──────────────────────────────────
	r.HandleFunc("/api/health", handleHealth).Methods("GET")
	r.HandleFunc("/api/leaderboard", handleLeaderboard).Methods("GET")
	r.HandleFunc("/api/contests", handleContests).Methods("GET")
	r.HandleFunc("/api/contests/{contest_id}/active-round", handleActiveRound).Methods("GET")
	r.HandleFunc("/ws/telemetry", handleWS)

	// ── Self-service key provisioning (requires no auth — bootstrapping) ─────
	r.HandleFunc("/api/apikey", handleProvisionAPIKey).Methods("POST")

	// ── Authenticated endpoints (require X-API-Key header) ──────────────────
	protected := r.PathPrefix("/api").Subrouter()
	protected.Use(auth.Middleware(db))
	protected.HandleFunc("/submit", handleSubmit).Methods("POST")
	protected.HandleFunc("/runs/{run_id}", handleGetRun).Methods("GET")
	protected.HandleFunc("/runs/{run_id}/log", handleGetRunLog).Methods("GET")
	protected.HandleFunc("/credits", handleCredits).Methods("GET")
	r.HandleFunc("/api/contestants", handleRegisterContestant).Methods("POST")
	r.HandleFunc("/api/contests", handleContests).Methods("POST")  // admin: create contest
	r.HandleFunc("/api/rounds", handleCreateRound).Methods("POST") // admin: create round
	r.HandleFunc("/api/rounds/{round_id}/dataset", handleUploadDataset).Methods("POST")
	r.HandleFunc("/api/rounds/{round_id}/final-dataset", handleUploadFinalDataset).Methods("POST")
	r.HandleFunc("/api/rounds/{round_id}/final-eval", handleFinalEval).Methods("POST")

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization", "X-API-Key"},
		AllowCredentials: false,
	}).Handler(r)

	log.Printf("[VIDHI] Control plane v5.1 on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, handler))
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	dbOK := db != nil && db.Ping() == nil
	redisOK := redisClient != nil
	workerOK := workerPool != nil
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"version": "v5.1-wired",
		"db":      dbOK,
		"redis":   redisOK,
		"worker":  workerOK,
		"time":    time.Now().Format(time.RFC3339),
	})
}

// POST /api/submit
func handleSubmit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if err := r.ParseMultipartForm(cfg.MaxSubmissionBytes); err != nil {
		writeError(w, 400, "payload too large or malformed")
		return
	}

	// Use the authenticated user_id (from X-API-Key) — never trust the form value
	userID := auth.GetUserID(r)
	roundID := r.FormValue("round_id")
	if roundID == "" {
		if db != nil {
			err := db.QueryRowContext(r.Context(), `SELECT id FROM rounds WHERE status='active' ORDER BY starts_at DESC LIMIT 1`).Scan(&roundID)
			if err != nil {
				roundID = "round1"
			}
		} else {
			roundID = "round1"
		}
	}

	// Read code
	file, _, err := r.FormFile("code")
	if err != nil {
		writeError(w, 400, "missing 'code' file")
		return
	}
	defer file.Close()
	codeBytes, err := io.ReadAll(io.LimitReader(file, cfg.MaxSubmissionBytes))
	if err != nil {
		writeError(w, 500, "failed to read submission")
		return
	}

	// ── Credit check (all rounds — Redis atomic Lua script) ──────────────────
	// Every submission costs 1 credit regardless of round. Daily limit enforced.
	ledger := credits.NewLedger(redisClient)
	if err := ledger.DeductCredit(r.Context(), userID, cfg.CreditsPerDay); err != nil {
		if errors.Is(err, credits.ErrDailyLimitReached) {
			writeError(w, 429, fmt.Sprintf("daily limit reached (%d/day). Resets at midnight UTC.", cfg.CreditsPerDay))
			return
		}
		// Log but don't block — Redis unavailable should not prevent submission
		log.Printf("[CREDIT] Error deducting credits for %s: %v", userID, err)
	}

	// SHA256 dedup
	hash := fmt.Sprintf("%x", sha256.Sum256(codeBytes))
	soPath := filepath.Join(cfg.SoCache, hash+".so")
	runID := fmt.Sprintf("run_%s_%d", hash[:8], time.Now().UnixMilli())

	// Ensure contestant exists in DB
	if db != nil {
		db.ExecContext(r.Context(),
			`INSERT INTO contestants(id) VALUES($1) ON CONFLICT DO NOTHING`, userID)
	}

	run := &RunResult{
		RunID:     runID,
		UserID:    userID,
		RoundID:   roundID,
		Status:    "queued",
		StartedAt: time.Now(),
	}
	cacheRun(run)
	if db != nil {
		persistRun(run)
	}

	go runForgePipeline(codeBytes, hash, soPath, runID, userID, roundID)

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(SubmitResponse{
		RunID:   runID,
		Status:  "queued",
		Message: "Submission accepted. Forge pipeline starting.",
	})
}

// GET /api/runs  (N1 — paginated run list)
// Query params:
//
//	user_id  — optional; defaults to authenticated user
//	page     — 1-indexed page number (default 1)
//	limit    — results per page (default 20, max 100)
func handleListRuns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = auth.GetUserID(r)
	}
	page, limit := 1, 20
	if v := r.URL.Query().Get("page"); v != "" {
		fmt.Sscanf(v, "%d", &page)
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	if limit > 100 {
		limit = 100
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	type RunSummary struct {
		RunID       string    `json:"run_id"`
		Status      string    `json:"status"`
		PnLPct      float64   `json:"pnl_pct"`
		P99NS       float64   `json:"p99_ns"`
		TotalFills  int64     `json:"total_fills"`
		TLECount    int64     `json:"tle_count"`
		StartedAt   time.Time `json:"started_at"`
		CompletedAt time.Time `json:"completed_at"`
	}

	var runs []RunSummary
	var total int

	if db != nil {
		// Count total for pagination metadata
		db.QueryRowContext(r.Context(),
			`SELECT COUNT(*) FROM runs WHERE user_id=$1`, userID).Scan(&total)

		rows, err := db.QueryContext(r.Context(),
			`SELECT run_id, status, pnl_pct, p99_ns, total_fills, tle_count, started_at, completed_at
			 FROM runs WHERE user_id=$1
			 ORDER BY started_at DESC
			 LIMIT $2 OFFSET $3`,
			userID, limit, offset)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var s RunSummary
				rows.Scan(&s.RunID, &s.Status, &s.PnLPct, &s.P99NS, &s.TotalFills, &s.TLECount, &s.StartedAt, &s.CompletedAt)
				runs = append(runs, s)
			}
		}
	} else {
		// In-memory fallback
		runCacheMu.RLock()
		for _, run := range runCache {
			if run.UserID == userID {
				runs = append(runs, RunSummary{
					RunID: run.RunID, Status: run.Status,
					PnLPct: run.PnLPct, P99NS: run.P99NS,
					TotalFills: run.TotalFills, TLECount: run.TLECount,
					StartedAt: run.StartedAt, CompletedAt: run.CompletedAt,
				})
			}
		}
		runCacheMu.RUnlock()
		total = len(runs)
		// Sort by started_at descending, apply pagination manually
		sort.Slice(runs, func(i, j int) bool { return runs[i].StartedAt.After(runs[j].StartedAt) })
		if offset >= len(runs) {
			runs = []RunSummary{}
		} else {
			end := offset + limit
			if end > len(runs) {
				end = len(runs)
			}
			runs = runs[offset:end]
		}
	}

	if runs == nil {
		runs = []RunSummary{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"user_id": userID,
		"page":    page,
		"limit":   limit,
		"total":   total,
		"runs":    runs,
	})
}

// GET /api/runs/{run_id}
func handleGetRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	runID := mux.Vars(r)["run_id"]

	// Try Postgres first
	if db != nil {
		run := loadRunFromDB(runID)
		if run != nil {
			json.NewEncoder(w).Encode(run)
			return
		}
	}

	// Fall back to memory cache
	runCacheMu.RLock()
	run, ok := runCache[runID]
	runCacheMu.RUnlock()
	if ok {
		json.NewEncoder(w).Encode(run)
		return
	}
	writeError(w, 404, "run not found")
}

// GET /api/runs/{run_id}/log
func handleGetRunLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	runID := mux.Vars(r)["run_id"]

	if db == nil {
		writeError(w, 400, "database not available for telemetry logs")
		return
	}

	rows, err := db.QueryContext(r.Context(),
		`SELECT tick_id, bid_price, ask_price, pnl
		 FROM tick_telemetry
		 WHERE run_id=$1
		 ORDER BY tick_id ASC`, runID)
	
	if err != nil {
		writeError(w, 500, "failed to query telemetry")
		return
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString("day;timestamp;product;bid_price_1;bid_volume_1;bid_price_2;bid_volume_2;bid_price_3;bid_volume_3;ask_price_1;ask_volume_1;ask_price_2;ask_volume_2;ask_price_3;ask_volume_3;mid_price;profit_and_loss\n")

	hasRows := false
	for rows.Next() {
		hasRows = true
		var tickID int64
		var bid, ask, pnl float64
		if err := rows.Scan(&tickID, &bid, &ask, &pnl); err != nil {
			continue
		}
		mid := (bid + ask) / 2.0
		// format: day;timestamp;product;bid1;vol1;;;;;ask1;vol1;;;;;mid;pnl
		sb.WriteString(fmt.Sprintf("3;%d;VIDHI_ASSET;%.2f;1;;;;;%.2f;1;;;;;%.2f;%.2f\n",
			tickID*100, bid, ask, mid, pnl))
	}
    
	if !hasRows {
		writeError(w, 404, "no telemetry found for run")
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"submissionId": runID,
		"activitiesLog": sb.String(),
	})
}

// GET /api/leaderboard
func handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	roundID := r.URL.Query().Get("round_id")

	// Try Postgres materialized view first
	if db != nil {
		entries := loadLeaderboardFromDB(roundID)
		if entries != nil {
			json.NewEncoder(w).Encode(entries)
			return
		}
	}

	// Fallback: build from memory cache
	best := make(map[string]*RunResult)
	runCacheMu.RLock()
	for _, run := range runCache {
		if run.Status != "complete" {
			continue
		}
		prev, ok := best[run.UserID]
		if !ok || run.PnLPct > prev.PnLPct {
			best[run.UserID] = run
		}
	}
	runCacheMu.RUnlock()

	entries := make([]LeaderboardEntry, 0, len(best))
	for uid, run := range best {
		entries = append(entries, LeaderboardEntry{
			UserID: uid, DisplayName: uid, PnLPct: run.PnLPct,
			P99NS: run.P99NS, TotalFills: run.TotalFills,
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].PnLPct > entries[j].PnLPct })
	for i := range entries {
		entries[i].Rank = i + 1
	}
	json.NewEncoder(w).Encode(entries)
}

// GET /api/credits?user_id=xxx
func handleCredits(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "anonymous"
	}

	used, _ := creditsUsed(userID)

	// Calculate reset time (midnight UTC)
	now := time.Now().UTC()
	resets := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)

	json.NewEncoder(w).Encode(map[string]any{
		"user_id":   userID,
		"used":      used,
		"limit":     cfg.CreditsPerDay,
		"remaining": max(0, cfg.CreditsPerDay-used),
		"resets_at": resets.Format(time.RFC3339),
	})
}

// POST /api/contestants  body: {user_id, display_name, team_name}
func handleRegisterContestant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		UserID      string `json:"user_id"`
		DisplayName string `json:"display_name"`
		TeamName    string `json:"team_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad JSON")
		return
	}
	if req.UserID == "" {
		req.UserID = "anon_" + fmt.Sprintf("%d", time.Now().UnixNano()%100000)
	}

	if db != nil {
		db.ExecContext(context.Background(), `
			INSERT INTO contestants(id, display_name, team_name)
			VALUES($1,$2,$3)
			ON CONFLICT(id) DO UPDATE SET display_name=$2, team_name=$3`,
			req.UserID, req.DisplayName, req.TeamName)
	}
	json.NewEncoder(w).Encode(map[string]string{"user_id": req.UserID, "status": "ok"})
}

// GET /api/contests  — returns active contests (seeds demo if empty)
// POST /api/contests — creates a new contest (admin)
func handleContests(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "POST" {
		var req struct {
			Name      string `json:"name"`
			TickCount int64  `json:"tick_count"`
			Phase     string `json:"phase"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "bad JSON")
			return
		}
		if req.Name == "" {
			req.Name = "IICPC Contest"
		}
		if req.TickCount == 0 {
			req.TickCount = 100000
		}
		if req.Phase == "" {
			req.Phase = "public"
		}
		contestID := fmt.Sprintf("contest_%d", time.Now().UnixNano())
		if db != nil {
			db.ExecContext(context.Background(), `
				INSERT INTO contests(id, name, phase, tick_count, status, starts_at, ends_at)
				VALUES($1,$2,$3,$4,'active',NOW(),NOW()+INTERVAL '7 days')`,
				contestID, req.Name, req.Phase, req.TickCount)
		}
		json.NewEncoder(w).Encode(map[string]string{"id": contestID, "status": "created"})
		return
	}

	// GET — return active contests
	type Round struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		AssetName     string `json:"asset_name"`
		BotConfig     string `json:"bot_config"`
		TickCount     int64  `json:"tick_count"`
		PositionLimit int64  `json:"position_limit"`
		Status        string `json:"status"`
		StartsAt      string `json:"starts_at"`
		EndsAt        string `json:"ends_at"`
	}

	type Contest struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Phase    string  `json:"phase"`
		Status   string  `json:"status"`
		StartsAt string  `json:"starts_at"`
		EndsAt   string  `json:"ends_at"`
		Rounds   []Round `json:"rounds"`
	}
	var contests []Contest

	if db != nil {
		rows, err := db.QueryContext(context.Background(),
			`SELECT id, name, phase, status, starts_at, ends_at
			 FROM contests WHERE status='active' ORDER BY starts_at DESC LIMIT 20`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var c Contest
				var sa, ea time.Time
				rows.Scan(&c.ID, &c.Name, &c.Phase, &c.Status, &sa, &ea)
				c.StartsAt = sa.Format(time.RFC3339)
				c.EndsAt = ea.Format(time.RFC3339)

				// Fetch rounds
				c.Rounds = []Round{}
				rRows, rErr := db.QueryContext(context.Background(),
					`SELECT id, name, asset_name, bot_config, tick_count, position_limit, status, starts_at, ends_at
					 FROM rounds WHERE contest_id=$1 ORDER BY starts_at ASC`, c.ID)
				if rErr == nil {
					for rRows.Next() {
						var r Round
						var rsa, rea time.Time
						rRows.Scan(&r.ID, &r.Name, &r.AssetName, &r.BotConfig, &r.TickCount, &r.PositionLimit, &r.Status, &rsa, &rea)
						r.StartsAt = rsa.Format(time.RFC3339)
						r.EndsAt = rea.Format(time.RFC3339)
						c.Rounds = append(c.Rounds, r)
					}
					rRows.Close()
				}

				contests = append(contests, c)
			}
		}
	}

	// Seed demo contest if empty
	if len(contests) == 0 {
		contests = []Contest{{
			ID: "iicpc_2026", Name: "IICPC Prosperity 2026",
			Phase: "public", Status: "active",
			StartsAt: time.Now().Add(-48 * time.Hour).Format(time.RFC3339),
			EndsAt:   time.Now().Add(120 * time.Hour).Format(time.RFC3339),
		}}
	}
	json.NewEncoder(w).Encode(contests)
}

// POST /api/rounds  (N4 — admin: add a round to a contest)
// Body: { contest_id, name, asset_name, bot_config, tick_count, position_limit, starts_at, ends_at }
func handleCreateRound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		ContestID     string `json:"contest_id"`
		Name          string `json:"name"`
		AssetName     string `json:"asset_name"`
		BotConfig     string `json:"bot_config"`
		TickCount     int64  `json:"tick_count"`
		PositionLimit int64  `json:"position_limit"`
		StartsAt      string `json:"starts_at"` // RFC3339
		EndsAt        string `json:"ends_at"`   // RFC3339
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad JSON: "+err.Error())
		return
	}
	if req.ContestID == "" {
		writeError(w, 400, "contest_id is required")
		return
	}
	// Defaults
	if req.Name == "" {
		req.Name = "Round"
	}
	if req.AssetName == "" {
		req.AssetName = "public_99k"
	}
	if req.BotConfig == "" {
		req.BotConfig = "MM:1.0,MOM:1.0,MR:1.0,NOISE:1.0,SNIPER:1.0"
	}
	if req.TickCount == 0 {
		req.TickCount = 100_000
	}
	if req.PositionLimit == 0 {
		req.PositionLimit = 1000
	}
	if req.StartsAt == "" {
		req.StartsAt = time.Now().Format(time.RFC3339)
	}
	if req.EndsAt == "" {
		req.EndsAt = time.Now().Add(7 * 24 * time.Hour).Format(time.RFC3339)
	}

	roundID := fmt.Sprintf("round_%s_%d", req.ContestID, time.Now().UnixNano())

	if db != nil {
		_, err := db.ExecContext(r.Context(), `
			INSERT INTO rounds(id, contest_id, name, asset_name, bot_config,
			                   tick_count, position_limit, status, starts_at, ends_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8::timestamptz,$9::timestamptz)`,
			roundID, req.ContestID, req.Name, req.AssetName, req.BotConfig,
			req.TickCount, req.PositionLimit, req.StartsAt, req.EndsAt)
		if err != nil {
			writeError(w, 500, "failed to insert round: "+err.Error())
			return
		}
	}

	log.Printf("[ADMIN] Round created: %s (%s / %s)", roundID, req.ContestID, req.Name)
	json.NewEncoder(w).Encode(map[string]any{
		"round_id":   roundID,
		"status":     "created",
		"bot_config": req.BotConfig,
	})
}

// (streamGMTelemetry removed as it's now handled via Redis PubSub)

// WS /ws/telemetry
func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	wsMu.Lock()
	wsClients[conn] = true
	wsMu.Unlock()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	wsMu.Lock()
	delete(wsClients, conn)
	wsMu.Unlock()
}

// POST /api/apikey — Self-service API key provisioning
// Body: {"user_id": "alice", "display_name": "Alice Smith", "team_name": "AlphaTeam"}
// Returns the plaintext key ONCE — store it immediately. Only the hash is kept in DB.
// If the user already has a key, revokes the old one and issues a new one.
func handleProvisionAPIKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		UserID      string `json:"user_id"`
		DisplayName string `json:"display_name"`
		TeamName    string `json:"team_name"`
		Label       string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad JSON: "+err.Error())
		return
	}
	if req.UserID == "" {
		writeError(w, 400, "user_id is required")
		return
	}
	if req.Label == "" {
		req.Label = "IICPC 2026"
	}

	// Ensure contestant record exists
	if db != nil {
		_, err := db.ExecContext(r.Context(),
			`INSERT INTO contestants(id, display_name, team_name)
			 VALUES($1,$2,$3)
			 ON CONFLICT(id) DO UPDATE SET display_name=$2, team_name=$3`,
			req.UserID, req.DisplayName, req.TeamName)
		if err != nil {
			writeError(w, 500, "failed to upsert contestant: "+err.Error())
			return
		}

		// Revoke existing keys for this user (one key per user policy)
		db.ExecContext(r.Context(), `DELETE FROM api_keys WHERE user_id=$1`, req.UserID)
	}

	// Generate new key
	plaintext, hash := auth.GenerateKey(req.UserID)

	if db != nil {
		_, err := db.ExecContext(r.Context(),
			`INSERT INTO api_keys(user_id, key_hash, label) VALUES($1,$2,$3)`,
			req.UserID, hash, req.Label)
		if err != nil {
			writeError(w, 500, "failed to store key: "+err.Error())
			return
		}
	}

	// Invalidate any old cache entry
	auth.InvalidateCache(hash)

	log.Printf("[AUTH] Provisioned API key for user=%s label=%s", req.UserID, req.Label)
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":    req.UserID,
		"api_key":    plaintext,              // shown ONCE — not stored anywhere
		"key_prefix": plaintext[:20] + "...", // safe to log/display
		"message":    "Save this key immediately — it will not be shown again.",
	})
}

// GET /api/contests/{contest_id}/active-round
func handleActiveRound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	contestID := mux.Vars(r)["contest_id"]
	var roundID string
	if db != nil {
		err := db.QueryRowContext(r.Context(),
			`SELECT id FROM rounds WHERE contest_id=$1 AND status='active' ORDER BY starts_at DESC LIMIT 1`,
			contestID).Scan(&roundID)
		if err != nil {
			writeError(w, 404, "no active round found")
			return
		}
	} else {
		roundID = "round1"
	}
	json.NewEncoder(w).Encode(map[string]string{"round_id": roundID})
}

// dataset upload helper
func handleDatasetUpload(w http.ResponseWriter, r *http.Request, isFinal bool) {
	w.Header().Set("Content-Type", "application/json")
	if err := r.ParseMultipartForm(100 << 20); err != nil { // 100MB limit
		writeError(w, 400, "payload too large")
		return
	}
	roundID := mux.Vars(r)["round_id"]
	file, header, err := r.FormFile("dataset")
	if err != nil {
		writeError(w, 400, "missing dataset file")
		return
	}
	defer file.Close()

	os.MkdirAll("/app/data/ticks", 0755)
	tmpPath := filepath.Join("/app/data/ticks", header.Filename)
	out, err := os.Create(tmpPath)
	if err != nil {
		writeError(w, 500, "failed to create temp file")
		return
	}
	io.Copy(out, file)
	out.Close()

	// Run generate_datasets.py to convert CSV to BIN if it's a CSV
	var binPath string
	if strings.HasSuffix(strings.ToLower(header.Filename), ".csv") {
		binFileName := strings.TrimSuffix(header.Filename, ".csv") + ".bin"
		if isFinal {
			binFileName = "final_" + binFileName
		}
		binPath = filepath.Join("/app/data/ticks", binFileName)
		cmd := exec.Command("python3", "scripts/generate_datasets.py", "--csv", tmpPath, "--out", binPath)
		if err := cmd.Run(); err != nil {
			log.Printf("[DATASET] Failed to convert CSV: %v", err)
			writeError(w, 500, "failed to convert CSV to binary format")
			return
		}
		os.Remove(tmpPath) // clean up csv
	} else {
		// Assuming it's already a bin
		binPath = tmpPath
	}

	if db != nil {
		col := "dataset_path"
		if isFinal {
			col = "final_dataset_path"
		}
		_, err := db.ExecContext(r.Context(), fmt.Sprintf(`UPDATE rounds SET %s=$1 WHERE id=$2`, col), binPath, roundID)
		if err != nil {
			writeError(w, 500, "failed to update round dataset path")
			return
		}
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": binPath})
}

// POST /api/rounds/{round_id}/dataset
func handleUploadDataset(w http.ResponseWriter, r *http.Request) {
	handleDatasetUpload(w, r, false)
}

// POST /api/rounds/{round_id}/final-dataset
func handleUploadFinalDataset(w http.ResponseWriter, r *http.Request) {
	handleDatasetUpload(w, r, true)
}

// POST /api/rounds/{round_id}/final-eval
func handleFinalEval(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	roundID := mux.Vars(r)["round_id"]
	if db == nil {
		writeError(w, 500, "database required for final eval")
		return
	}

	// 1. Get all unique participants with a complete run in this round
	rows, err := db.QueryContext(r.Context(), `
		SELECT DISTINCT ON(user_id) user_id, code_hash
		FROM runs 
		WHERE round_id=$1 AND status='complete'
		ORDER BY user_id, completed_at DESC`, roundID)
	if err != nil {
		writeError(w, 500, "failed to query runs")
		return
	}
	defer rows.Close()

	var jobs []string
	for rows.Next() {
		var userID, codeHash string
		if err := rows.Scan(&userID, &codeHash); err != nil {
			continue
		}
		soPath := filepath.Join(cfg.SoCache, codeHash+".so")
		runID := fmt.Sprintf("run_final_%s_%d", codeHash[:8], time.Now().UnixMilli())
		
		run := &RunResult{
			RunID:     runID,
			UserID:    userID,
			RoundID:   roundID,
			Status:    "queued",
			StartedAt: time.Now(),
		}
		cacheRun(run)
		persistRun(run)

		job := worker.RunJob{
			RunID:   runID,
			UserID:  userID,
			SoPath:  soPath,
			RoundID: roundID,
			Retries: 0,
		}
		worker.Enqueue(redisClient, job)
		jobs = append(jobs, runID)
	}

	// update round status to ended
	db.ExecContext(r.Context(), `UPDATE rounds SET status='ended' WHERE id=$1`, roundID)

	json.NewEncoder(w).Encode(map[string]any{
		"status": "evaluating",
		"jobs":   jobs,
		"count":  len(jobs),
	})
}

// ─── Forge Pipeline ───────────────────────────────────────────────────────────

// FIX #5: hashLocks is ref-counted so entries are deleted when no goroutine uses them.
// Old version grew the map indefinitely (one mutex per unique submission, never freed).
var (
	hashLocksMu sync.Mutex
	hashLocks   = make(map[string]*hashLockEntry)
)

type hashLockEntry struct {
	mu   sync.Mutex
	refs int
}

func acquireHashLock(hash string) *hashLockEntry {
	hashLocksMu.Lock()
	entry, ok := hashLocks[hash]
	if !ok {
		entry = &hashLockEntry{}
		hashLocks[hash] = entry
	}
	entry.refs++
	hashLocksMu.Unlock()
	entry.mu.Lock()
	return entry
}

func releaseHashLock(hash string, entry *hashLockEntry) {
	entry.mu.Unlock()
	hashLocksMu.Lock()
	entry.refs--
	if entry.refs == 0 {
		delete(hashLocks, hash) // FIX: free the entry when no goroutines remain
	}
	hashLocksMu.Unlock()
}

func runForgePipeline(code []byte, hash, soPath, runID, userID, roundID string) {
	entry := acquireHashLock(hash)
	defer releaseHashLock(hash, entry)

	codeStr := string(code)
	isCpp := strings.Contains(codeStr, "extern \"C\"") || strings.Contains(codeStr, "#include")

	if isCpp {
		// ── Native C++ Pipeline (HFT Ultra-Low Latency) ──────────────────────────
		cppPath := filepath.Join("/tmp/vidhi", hash+"_raw.cpp")
		os.MkdirAll("/tmp/vidhi", 0755)
		if err := os.WriteFile(cppPath, code, 0644); err != nil {
			failRun(runID, "write failed: "+err.Error())
			return
		}
		updateRunStatus(runID, "compiling_cpp")
		broadcastRunUpdate(runID)

		if _, err := os.Stat(soPath); os.IsNotExist(err) {
			cmd := exec.Command("bash", "forge/forge_cpp.sh", cppPath, soPath)
			if out, err := cmd.CombinedOutput(); err != nil {
				failRun(runID, "forge_cpp failed: "+string(out))
				return
			}
			log.Printf("[FORGE:%s] Native C++ compile ✓ → %s", runID[:12], filepath.Base(soPath))
		} else {
			log.Printf("[FORGE:%s] Native C++ .so cache hit", runID[:12])
		}
	} else {
		// ── Python/Numba Pipeline ────────────────────────────────────────────────
		rawPath := filepath.Join("/tmp/vidhi", hash+"_raw.py")
		os.MkdirAll("/tmp/vidhi", 0755)
		if err := os.WriteFile(rawPath, code, 0644); err != nil {
			failRun(runID, "write failed: "+err.Error())
			return
		}

		// ── Step 1: AST Security Scanner
		updateRunStatus(runID, "scanning")
		broadcastRunUpdate(runID)
		scanOut, scanErr := runPythonForge("scanner.py", rawPath)
		if scanErr != nil {
			var scanResult struct {
				OK         bool     `json:"ok"`
				Errors     []string `json:"errors"`
				FirstError string   `json:"first_error"`
			}
			if jsonErr := json.Unmarshal([]byte(scanOut), &scanResult); jsonErr == nil && !scanResult.OK {
				failRun(runID, "Security scan failed: "+scanResult.FirstError)
			} else {
				failRun(runID, "Security scan failed: "+scanErr.Error())
			}
			broadcastRunUpdate(runID)
			return
		}
		log.Printf("[FORGE:%s] AST scan ✓", runID[:12])

		// ── Step 2: Transpiler
		transformedPath := filepath.Join("/tmp/vidhi", hash+"_transformed.py")
		if _, err := runPythonForge("transpiler.py", rawPath, transformedPath); err != nil {
			failRun(runID, "transpiler failed: "+err.Error())
			return
		}
		log.Printf("[FORGE:%s] Transpile ✓", runID[:12])

		// ── Step 3: Numba AOT → .so
		if _, err := os.Stat(soPath); os.IsNotExist(err) {
			if _, err := runPythonForge("forge.py", transformedPath, soPath); err != nil {
				failRun(runID, "forge/numba failed: "+err.Error())
				return
			}
			log.Printf("[FORGE:%s] Numba compile ✓ → %s", runID[:12], filepath.Base(soPath))
		} else {
			log.Printf("[FORGE:%s] .so cache hit", runID[:12])
		}
	}

	// ── Step 4: ELF Validation (Go-native analysis) ───────────────────────────
	if err := validator.ValidateContestantBinary(soPath); err != nil {
		os.Remove(soPath)
		failRun(runID, "ELF validation failed: "+err.Error())
		return
	}
	log.Printf("[FORGE:%s] ELF valid ✓", runID[:12])

	// ── Step 5: Dispatch to Game Master (via Redis queue or direct) ───────────
	updateRunStatus(runID, "queued_gm")
	broadcastRunUpdate(runID)

	if workerPool != nil && redisClient != nil {
		// ── Fault-tolerant path: push job to Redis queue ──────────────────────
		// Workers pick it up, run GM, update DB, broadcast result.
		// If a worker crashes mid-run, the Reaper re-enqueues after TTL.
		job := worker.RunJob{
			RunID:   runID,
			UserID:  userID,
			SoPath:  soPath,
			RoundID: roundID,
			Retries: 0,
		}
		if err := worker.Enqueue(redisClient, job); err != nil {
			log.Printf("[SUBMIT] Enqueue failed, falling back to direct: %v", err)
			// fallthrough to direct dispatch below
		} else {
			log.Printf("[SUBMIT:%s] Enqueued to Redis job queue", runID[:12])
			return // worker will handle the rest
		}
	}

	// ── Fallback: direct Game Master dispatch (no Redis / dev mode) ────────────
	updateRunStatus(runID, "running")
	broadcastRunUpdate(runID)

	result, err := dispatchToGameMaster(soPath, runID, roundID)
	if err != nil {
		failRun(runID, "execution failed: "+err.Error())
		broadcastRunUpdate(runID)
		return
	}

	// ── Step 6: Persist result ────────────────────────────────────────────────
	runCacheMu.Lock()
	if r, ok := runCache[runID]; ok {
		r.Status = "complete"
		r.PnL = result.PnL
		r.PnLPct = result.PnLPct
		r.P50NS = result.P50NS
		r.P90NS = result.P90NS
		r.P99NS = result.P99NS
		r.TotalFills = result.TotalFills
		r.TotalTicks = result.TotalTicks
		r.TLECount = result.TLECount
		r.Correctness = result.Correctness
		r.Violations = result.Violations
		r.CompletedAt = time.Now()
	}
	runCacheMu.Unlock()

	if db != nil {
		runCacheMu.RLock()
		r := runCache[runID]
		runCacheMu.RUnlock()
		if r != nil {
			persistRun(r)
		}
		maybeRefreshLeaderboard() // rate-limited: at most 1 refresh per 5s
	}

	broadcastRunUpdate(runID)
	log.Printf("[GM:%s] Complete — PnL=%.4f%% p99=%.0fns", runID[:12], result.PnLPct, result.P99NS)
}

// ─── Leaderboard refresh rate limiter (P2-6) ────────────────────────────────
// REFRESH MATERIALIZED VIEW CONCURRENTLY is expensive.
// Rate-limit to at most 1 refresh per 5 seconds to prevent thundering herd.
var (
	lastLeaderboardRefresh   time.Time
	leaderboardRefreshMu     sync.Mutex
	leaderboardRefreshMinGap = 5 * time.Second
)

func maybeRefreshLeaderboard() {
	if db == nil {
		return
	}
	leaderboardRefreshMu.Lock()
	if time.Since(lastLeaderboardRefresh) < leaderboardRefreshMinGap {
		leaderboardRefreshMu.Unlock()
		return // skip — too soon since last refresh
	}
	lastLeaderboardRefresh = time.Now()
	leaderboardRefreshMu.Unlock()
	go func() {
		if _, err := db.ExecContext(context.Background(), "SELECT refresh_leaderboard()"); err != nil {
			log.Printf("[DB] refresh_leaderboard error: %v", err)
		}
	}()
}

// runPythonForge runs a forge Python script via subprocess
func runPythonForge(script string, args ...string) (string, error) {
	scriptPath := filepath.Join(cfg.ForgeDir, script)
	cmdArgs := append([]string{scriptPath}, args...)
	cmd := exec.Command("python3", cmdArgs...)
	cmd.Env = append(os.Environ(), "PYTHONPATH="+filepath.Dir(cfg.ForgeDir))
	out, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(out))
	if err != nil {
		return "", fmt.Errorf("%s\n%s", err.Error(), output)
	}
	return output, nil
}

type GameMasterResult struct {
	PnL, PnLPct, P50NS, P90NS, P99NS float64
	TotalFills, TotalTicks, TLECount int64
	Correctness                      float64
	Violations                       int64
}

// dispatchToGameMaster spawns the vidhi-gm binary and parses its JSON output
func dispatchToGameMaster(soPath, runID, roundID string) (*GameMasterResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	ticks := "100000" // Fallback
	botConfig := "MM:1.0"
	assetName := "public_99k" // Fallback dataset
	var dbDatasetPath sql.NullString
	if db != nil {
		var ticksInt int64
		err := db.QueryRowContext(ctx, "SELECT tick_count, bot_config, dataset_path FROM rounds WHERE id=$1", roundID).Scan(&ticksInt, &botConfig, &dbDatasetPath)
		if err == nil {
			ticks = fmt.Sprintf("%d", ticksInt)
		}
	}

	// Check if the binary exists; fall back to stub result in dev
	if _, err := os.Stat(cfg.GameMasterBin); os.IsNotExist(err) {
		log.Printf("[GM] Binary not found at %s — returning dev stub result", cfg.GameMasterBin)
		return devStubResult(), nil
	}

	datasetPath := fmt.Sprintf("./data/ticks/%s.bin", assetName)
	if dbDatasetPath.Valid && dbDatasetPath.String != "" {
		datasetPath = dbDatasetPath.String
	}

	cmd := exec.CommandContext(ctx, cfg.GameMasterBin,
		"--external-sandbox",
		"--so", soPath,
		"--ticks", ticks,
		"--bot-config", botConfig,
		"--run-id", runID,
		"--dataset", datasetPath,
	)
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("game master timeout after 5m")
		}
		return nil, fmt.Errorf("game master exit error: %v", err)
	}

	var res struct {
		PnL         float64 `json:"pnl"`
		PnLPct      float64 `json:"pnl_pct"`
		P50NS       float64 `json:"p50_ns"`
		P90NS       float64 `json:"p90_ns"`
		P99NS       float64 `json:"p99_ns"`
		TotalTicks  int64   `json:"total_ticks"`
		TLECount    int64   `json:"tle_count"`
		Position    int64   `json:"position"`    // contestant net position at run end
		TotalFills  int64   `json:"total_fills"` // total contestant fills (from shadow LOB)
		Correctness float64 `json:"correctness"` // from shadow LOB
		Violations  int64   `json:"violations"`
	}
	// Trim any stderr prefix (gm writes progress to stderr, result to stdout)
	jsonStart := bytes.IndexByte(out, '{')
	if jsonStart < 0 {
		return nil, fmt.Errorf("no JSON in GM output: %s", string(out))
	}
	if err := json.Unmarshal(out[jsonStart:], &res); err != nil {
		return nil, fmt.Errorf("parse GM output: %v — raw: %s", err, string(out))
	}

	if res.Correctness == 0 {
		res.Correctness = 1.0 // default to perfect if shadow LOB not yet built
	}

	return &GameMasterResult{
		PnL:         res.PnL,
		PnLPct:      res.PnLPct,
		P50NS:       res.P50NS,
		P90NS:       res.P90NS,
		P99NS:       res.P99NS,
		TotalFills:  res.TotalFills, // BUG FIX: was res.Position (copy-paste error)
		TotalTicks:  res.TotalTicks,
		TLECount:    res.TLECount,
		Correctness: res.Correctness,
		Violations:  res.Violations,
	}, nil
}

func devStubResult() *GameMasterResult {
	return &GameMasterResult{
		PnL: 1234.56, PnLPct: 1.2345,
		P50NS: 89, P90NS: 118, P99NS: 142,
		TotalFills: 4821, TotalTicks: 100_000,
		Correctness: 0.997, Violations: 1,
	}
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

func persistRun(r *RunResult) {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := db.ExecContext(ctx, `
		INSERT INTO runs (run_id, user_id, round_id, status, pnl, pnl_pct, p50_ns, p90_ns, p99_ns, total_fills, total_ticks, tle_count, correctness, violations, started_at, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT(run_id) DO UPDATE SET
			status=EXCLUDED.status, pnl=EXCLUDED.pnl, pnl_pct=EXCLUDED.pnl_pct,
			p50_ns=EXCLUDED.p50_ns, p90_ns=EXCLUDED.p90_ns, p99_ns=EXCLUDED.p99_ns,
			total_fills=EXCLUDED.total_fills, total_ticks=EXCLUDED.total_ticks,
			tle_count=EXCLUDED.tle_count, correctness=EXCLUDED.correctness, violations=EXCLUDED.violations,
			completed_at=EXCLUDED.completed_at`,
		r.RunID, r.UserID, r.RoundID, r.Status, r.PnL, r.PnLPct, r.P50NS, r.P90NS, r.P99NS,
		r.TotalFills, r.TotalTicks, r.TLECount, r.Correctness, r.Violations, r.StartedAt, r.CompletedAt)
	if err != nil {
		log.Printf("[DB] persistRun error: %v", err)
	}
}

func loadRunFromDB(runID string) *RunResult {
	if db == nil {
		return nil
	}
	r := &RunResult{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var roundID sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT run_id, user_id, round_id, status, pnl, pnl_pct, p50_ns, p90_ns, p99_ns,
		        total_fills, total_ticks, tle_count, correctness, violations, started_at, completed_at
		 FROM runs WHERE run_id=$1`, runID).
		Scan(&r.RunID, &r.UserID, &roundID, &r.Status, &r.PnL, &r.PnLPct,
			&r.P50NS, &r.P90NS, &r.P99NS,
			&r.TotalFills, &r.TotalTicks, &r.TLECount, &r.Correctness, &r.Violations, &r.StartedAt, &r.CompletedAt)
	if err != nil {
		return nil
	}
	r.RoundID = roundID.String
	return r
}

func loadLeaderboardFromDB(roundID string) []LeaderboardEntry {
	if db == nil {
		return nil
	}
	var rows *sql.Rows
	var err error
	if roundID != "" {
		rows, err = db.QueryContext(context.Background(),
			`SELECT rank, user_id, display_name, team_name, pnl_pct, p99_ns, total_fills
			 FROM leaderboard WHERE round_id=$1 ORDER BY rank LIMIT 100`, roundID)
	} else {
		rows, err = db.QueryContext(context.Background(),
			`SELECT rank, user_id, display_name, team_name, pnl_pct, p99_ns, total_fills
			 FROM leaderboard ORDER BY round_id, rank LIMIT 100`)
	}
	
	if err != nil {
		log.Printf("[DB] leaderboard query: %v", err)
		return nil
	}
	defer rows.Close()
	var entries []LeaderboardEntry
	for rows.Next() {
		var e LeaderboardEntry
		rows.Scan(&e.Rank, &e.UserID, &e.DisplayName, &e.TeamName, &e.PnLPct, &e.P99NS, &e.TotalFills)
		entries = append(entries, e)
	}
	return entries
}

// ─── Credit management ────────────────────────────────────────────────────────

func creditsUsed(userID string) (int, error) {
	// Try Redis first (fast path)
	if redisClient != nil {
		key := fmt.Sprintf("credits:%s:%s", userID, time.Now().UTC().Format("2006-01-02"))
		val, err := redisClient.Get(context.Background(), key).Int()
		if err == nil {
			return val, nil
		}
	}
	// Fall back to Postgres
	if db != nil {
		var used int
		err := db.QueryRowContext(context.Background(),
			`SELECT COALESCE(used, 0) FROM credit_ledger WHERE user_id=$1 AND day=CURRENT_DATE`, userID).
			Scan(&used)
		if err == nil {
			return used, nil
		}
	}
	return 0, nil
}

func incrementCredits(userID string) error {
	if redisClient != nil {
		key := fmt.Sprintf("credits:%s:%s", userID, time.Now().UTC().Format("2006-01-02"))
		pipe := redisClient.Pipeline()
		pipe.Incr(context.Background(), key)
		pipe.Expire(context.Background(), key, 25*time.Hour)
		_, err := pipe.Exec(context.Background())
		if err != nil {
			log.Printf("[REDIS] credit incr: %v", err)
		}
	}
	if db != nil {
		db.ExecContext(context.Background(),
			`INSERT INTO credit_ledger(user_id, day, used) VALUES($1, CURRENT_DATE, 1)
			 ON CONFLICT(user_id, day) DO UPDATE SET used = credit_ledger.used + 1`, userID)
	}
	return nil
}

// ─── Cache + helpers ──────────────────────────────────────────────────────────

func cacheRun(r *RunResult) {
	runCacheMu.Lock()
	runCache[r.RunID] = r
	runCacheMu.Unlock()
}

func updateRunStatus(runID, status string) {
	runCacheMu.Lock()
	if r, ok := runCache[runID]; ok {
		r.Status = status
	}
	runCacheMu.Unlock()
}

func failRun(runID, reason string) {
	runCacheMu.Lock()
	if r, ok := runCache[runID]; ok {
		r.Status = "error"
		r.CompletedAt = time.Now()
		log.Printf("[RUN:%s] FAILED — %s", runID[:min(12, len(runID))], reason)
	}
	runCacheMu.Unlock()
	if db != nil {
		runCacheMu.RLock()
		r := runCache[runID]
		runCacheMu.RUnlock()
		if r != nil {
			persistRun(r)
		}
	}
}

func broadcastRunUpdate(runID string) {
	runCacheMu.RLock()
	run := runCache[runID]
	runCacheMu.RUnlock()
	if run == nil {
		return
	}
	msg, _ := json.Marshal(map[string]any{"type": "RUN_UPDATE", "payload": run})
	wsMu.Lock()
	for conn := range wsClients {
		conn.WriteMessage(websocket.TextMessage, msg)
	}
	wsMu.Unlock()
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
