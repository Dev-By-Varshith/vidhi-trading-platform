// backend/worker/job_worker.go
// Redis BullMQ-style job queue worker for Vidhi Arena
//
// Architecture:
//   Control plane pushes RunJob structs to Redis list "vidhi:jobs:pending"
//   This worker BRPOP-s from that list, spawns the Game Master binary,
//   streams telemetry back via PostgreSQL COPY protocol, and updates the run record.
//
// Fault tolerance:
//   - Jobs are moved to "vidhi:jobs:active" with a visibility timeout (TTL key).
//   - If this worker crashes, a Reaper goroutine detects stale active jobs
//     (TTL expired) and re-enqueues them to "vidhi:jobs:pending".
//   - Because tick data is immutable + deterministic, replay is always safe.

package worker

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"vidhi-control/validator"
)

func resolveDatasetPath(stored string, ticks int64, preferFinal bool) string {
	candidates := []string{}
	fileName := strings.TrimSpace(stored)

	defaultName := "public_99k.bin"
	if preferFinal || ticks > 100000 {
		defaultName = "eval_1m.bin"
	}

	if fileName != "" {
		if strings.HasPrefix(fileName, "/") {
			candidates = append(candidates, fileName)
		}
		candidates = append(candidates,
			fileName,
			fmt.Sprintf("/app/data/ticks/%s", fileName),
			fmt.Sprintf("/app/data/ticks/%s", filepathBase(fileName)),
		)
	}

	candidates = append(candidates,
		fmt.Sprintf("/app/data/ticks/%s", defaultName),
		defaultName,
	)

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	return fmt.Sprintf("/app/data/ticks/%s", defaultName)
}

func filepathBase(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	parts := strings.Split(path, "/")
	return parts[len(parts)-1]
}

var (
	corePool     chan int
	corePoolOnce sync.Once
)

func initCorePool() {
	corePoolOnce.Do(func() {
		// Create 20 slots (starting from base 2: Slot 0 = 2,3; Slot 1 = 4,5, ..., Slot 19 = 40,41)
		corePool = make(chan int, 20)
		for i := 0; i < 20; i++ {
			corePool <- 2 + (i * 2) // gm_core
		}
	})
}

// ─── Queue key constants ──────────────────────────────────────────────────────
const (
	QueuePending    = "vidhi:jobs:pending"
	QueueActive     = "vidhi:jobs:active"
	ActiveTTLSuffix = ":heartbeat"
	ActiveTTL       = 6 * time.Minute   // GM should finish in < 5min
	ReaperInterval  = 30 * time.Second
	MaxRetries      = 3
)

// ─── RunJob is the payload pushed into Redis ──────────────────────────────────
type RunJob struct {
	RunID      string `json:"run_id"`
	UserID     string `json:"user_id"`
	SoPath     string `json:"so_path"`
	RoundID    string `json:"round_id"`
	BotConfig  string `json:"bot_config"` // Step 3: Custom bot config
	Retries    int    `json:"retries"`
	EnqueuedAt int64  `json:"enqueued_at"`
}

// ─── GameMasterResult from JSON stdout ────────────────────────────────────────
type GMResult struct {
	RunID             string  `json:"run_id"`
	Status            string  `json:"status"`
	PnL               float64 `json:"pnl"`
	PnLPct            float64 `json:"pnl_pct"`
	P50NS             float64 `json:"p50_ns"`
	P99NS             float64 `json:"p99_ns"`
	TotalTicks        int64   `json:"total_ticks"`
	TotalFills        int64   `json:"total_fills"`
	TLECount          int64   `json:"tle_count"`
	Position          int64   `json:"position"`
	Correctness       float64 `json:"correctness"`
	Violations        int64   `json:"violations"`
	FIFOViolations    int64   `json:"fifo_violations"`
	DoubleFillViolations int64 `json:"double_fill_violations"`
}

// ─── Worker ────────────────────────────────────────────────────────────────────
type Worker struct {
	redis     *redis.Client
	db        *sql.DB
	gmBin     string
	soCache   string
	concurrency int

	// Telemetry COPY writer (to TimescaleDB tick_telemetry hypertable)
	dbAddr  string  // host:port for raw TCP COPY
	dbConn  net.Conn
	dbMu    sync.Mutex

	wg sync.WaitGroup
}

func New(rdb *redis.Client, db *sql.DB, gmBin, soCache string, concurrency int) *Worker {
	initCorePool()
	return &Worker{
		redis:       rdb,
		db:          db,
		gmBin:       gmBin,
		soCache:     soCache,
		concurrency: concurrency,
	}
}

// ─── Enqueue a job (called from main.go handleSubmit) ────────────────────────
func Enqueue(rdb *redis.Client, job RunJob) error {
	ctx := context.Background()
	job.EnqueuedAt = time.Now().UnixMilli()
	payload, err := json.Marshal(job)
	if err != nil { return err }
	return rdb.LPush(ctx, QueuePending, payload).Err()
}

// ─── Start N worker goroutines + 1 reaper ────────────────────────────────────
func (w *Worker) Start(ctx context.Context) {
	log.Printf("[WORKER] Starting %d worker goroutine(s) + reaper", w.concurrency)
	for i := 0; i < w.concurrency; i++ {
		w.wg.Add(1)
		go w.loop(ctx, i)
	}
	go w.reaper(ctx)
}

func (w *Worker) Wait() { w.wg.Wait() }

// ─── Main poll loop (BRPOP blocks until a job arrives) ───────────────────────
func (w *Worker) loop(ctx context.Context, id int) {
	defer w.wg.Done()
	log.Printf("[WORKER-%d] Ready — polling %s", id, QueuePending)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Blocking pop with 5s timeout so we can check ctx cancellation
		res, err := w.redis.BRPop(ctx, 5*time.Second, QueuePending).Result()
		if err != nil {
			if err == redis.Nil { continue } // timeout — loop
			log.Printf("[WORKER-%d] BRPop error: %v", id, err)
			time.Sleep(time.Second)
			continue
		}

		// res = [key, value]
		if len(res) < 2 { continue }
		var job RunJob
		if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
			log.Printf("[WORKER-%d] Bad job payload: %v", id, err)
			continue
		}

		// Mark as active (heartbeat key with TTL)
		heartbeatKey := QueueActive + ":" + job.RunID + ActiveTTLSuffix
		w.redis.Set(ctx, heartbeatKey, res[1], ActiveTTL)
		w.redis.LPush(ctx, QueueActive, res[1])

		log.Printf("[WORKER-%d] Processing run=%s round=%s retry=%d",
			id, job.RunID[:min(12, len(job.RunID))], job.RoundID, job.Retries)

		err = w.processJob(ctx, job)
		if err != nil {
			log.Printf("[WORKER-%d] Job failed: %v (retry %d/%d)", id, err, job.Retries, MaxRetries)
			w.redis.LRem(ctx, QueueActive, 1, res[1])
			w.redis.Del(ctx, heartbeatKey)

			if job.Retries < MaxRetries {
				job.Retries++
				if enqErr := Enqueue(w.redis, job); enqErr != nil {
					log.Printf("[WORKER-%d] Re-enqueue failed: %v", id, enqErr)
				}
				w.updateRunStatus(job.RunID, "queued", nil)
			} else {
				log.Printf("[WORKER-%d] Max retries exhausted for %s — marking failed", id, job.RunID)
				w.updateRunStatus(job.RunID, "error", nil)
			}
			continue
		}

		// Remove from active queue
		w.redis.LRem(ctx, QueueActive, 1, res[1])
		w.redis.Del(ctx, heartbeatKey)
	}
}

// ─── Process a single job ─────────────────────────────────────────────────────
func (w *Worker) processJob(ctx context.Context, job RunJob) error {
	if _, err := os.Stat(job.SoPath); os.IsNotExist(err) {
		return fmt.Errorf("so file not found: %s", job.SoPath)
	}

	// ─── Static Security Validation (ELF Analysis) ────────────────────────────────
	if err := validator.ValidateContestantBinary(job.SoPath); err != nil {
		w.updateRunStatus(job.RunID, "error", nil)
		return fmt.Errorf("ELF validation failed: %w", err)
	}

	var ticksInt int64
	var roundBotConfig string
	var datasetPath sql.NullString
	var finalDatasetPath sql.NullString
	if w.db != nil {
		err := w.db.QueryRowContext(ctx, "SELECT tick_count, bot_config, dataset_path, final_dataset_path FROM rounds WHERE id=$1", job.RoundID).Scan(&ticksInt, &roundBotConfig, &datasetPath, &finalDatasetPath)
		if err != nil {
			ticksInt = 100000
			roundBotConfig = "MM:1.0"
		}
	} else {
		ticksInt = 100000
		roundBotConfig = "MM:1.0"
	}

	// Step 3: Use job.BotConfig if provided, otherwise fallback to round default
	actualBotConfig := roundBotConfig
	if job.BotConfig != "" {
		actualBotConfig = job.BotConfig
	}

	ticks := fmt.Sprintf("%d", ticksInt)

	actualDataset := resolveDatasetPath(datasetPath.String, ticksInt, false)
	if strings.Contains(job.RunID, "run_final_") {
		actualDataset = resolveDatasetPath(finalDatasetPath.String, ticksInt, true)
	}

	// Acquire a core pair from the allocator pool
	gmCore := <-corePool
	sandboxCore := fmt.Sprintf("%d", gmCore+1)
	defer func() {
		corePool <- gmCore // return to pool when job finishes
	}()

	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, w.gmBin,
		"--external-sandbox",
		"--ticks",  ticks,
		"--bot-config", actualBotConfig,
		"--dataset", actualDataset,
		"--run-id", job.RunID,
		"--gm-core", fmt.Sprintf("%d", gmCore),
	)

	// ── Spawn the Docker sandbox BEFORE starting GM (critical TLE fix) ───────
	// The GM's per-tick TLE window is only 100µs. Docker container boot takes
	// 2-10s. We must wait for the sandbox to be running and SHM-connected before
	// sending the GM's first tick signal.
	//
	// Flow:
	//  1. POST /spawn-async → container created+started in background, returns 202
	//  2. Poll GET /ready/{runID} until container is registered (started)
	//  3. Wait 3s for sandbox_runner to boot and connect to SHM
	//  4. Start GM binary — sandbox is ready to respond to tick signals
	log.Printf("[WORKER] Spawning sandbox for run=%s (async)...", job.RunID[:min(12, len(job.RunID))])
	spawnPayload, _ := json.Marshal(map[string]string{
		"so_path":      job.SoPath,
		"run_id":       job.RunID,
		"round_id":     job.RoundID,
		"sandbox_core": sandboxCore,
	})
	spawnReq, _ := http.NewRequest("POST", "http://vidhi_sandbox_manager:8081/spawn-async", bytes.NewReader(spawnPayload))
	spawnReq.Header.Set("Content-Type", "application/json")
	spawnResp, spawnErr := http.DefaultClient.Do(spawnReq)
	if spawnErr != nil {
		log.Printf("[WORKER] /spawn-async HTTP error for run=%s: %v — running GM without sandbox", job.RunID[:min(12, len(job.RunID))], spawnErr)
	} else {
		spawnResp.Body.Close()
		if spawnResp.StatusCode == 202 || spawnResp.StatusCode == 200 {
			// Poll /ready/{runID} for up to 30s until container is registered
			log.Printf("[WORKER] Polling /ready/%s...", job.RunID[:min(12, len(job.RunID))])
			readyCtx, readyCancel := context.WithTimeout(context.Background(), 30*time.Second)
			for {
				if readyCtx.Err() != nil {
					log.Printf("[WORKER] Sandbox /ready timed out for run=%s — starting GM anyway", job.RunID[:min(12, len(job.RunID))])
					break
				}
				readyReq, _ := http.NewRequestWithContext(readyCtx, "GET",
					"http://vidhi_sandbox_manager:8081/ready/"+job.RunID, nil)
				readyResp, readyErr := http.DefaultClient.Do(readyReq)
				if readyErr == nil {
					isReady := readyResp.StatusCode == 200
					readyResp.Body.Close()
					if isReady {
						log.Printf("[WORKER] Sandbox container started for run=%s", job.RunID[:min(12, len(job.RunID))])
						break
					}
				}
				time.Sleep(200 * time.Millisecond)
			}
			readyCancel()
			// Give sandbox_runner 3 more seconds to dlopen the .so and connect SHM
			log.Printf("[WORKER] Giving sandbox 3s to connect SHM for run=%s...", job.RunID[:min(12, len(job.RunID))])
			time.Sleep(3 * time.Second)
		}
	}

	// We need to stream stdout live for WebSockets, while accumulating it for DB flush.
	// Since GameMaster emits binary rows then JSON, we read chunks.
	pr, pw := io.Pipe()
	var stderr bytes.Buffer
	cmd.Stdout = pw
	cmd.Stderr = &stderr

	// Start reading stdout asynchronously
	var binaryTelemetry []byte
	var jsonResult []byte
	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()
		for {
			var packetType uint8
			if err := binary.Read(pr, binary.LittleEndian, &packetType); err != nil {
				break
			}
			
			if packetType == '{' {
				// Reached JSON
				rest, _ := io.ReadAll(pr)
				jsonResult = append([]byte{'{'}, rest...)
				break
			}
			
			binaryTelemetry = append(binaryTelemetry, packetType)
			
			if packetType == 0x01 {
				// TICK_METRICS is 80 bytes (76 bytes of data + 4 bytes padding)
				buf := make([]byte, 80)
				if _, err := io.ReadFull(pr, buf); err != nil { break }
				binaryTelemetry = append(binaryTelemetry, buf...)
				
				// Publish to Redis (WebSocket)
				// Struct must EXACTLY match C++ batch_row in telemetry.hpp (same field order + padding)
				var row struct {
					TickID     int64
					PnLFP      int64
					Pos        int64
					LatP50     int64
					LatP99     int64
					BidPrice   float64
					AskPrice   float64
					Spread     float64
					LastTrade  float64
					FillCount  int32
					Pad        [4]byte // C++ aligns to 8 bytes → total 80 bytes
				}
				reader := bytes.NewReader(buf)
				binary.Read(reader, binary.LittleEndian, &row)
				
				if w.redis != nil {
					msg, _ := json.Marshal(map[string]any{
						"tick_id":   row.TickID,
						"pnl":       float64(row.PnLFP) / 1_000_000.0, // ×1e6 fixed-point
						"pos":       row.Pos,
						"p50_ns":    row.LatP50,
						"p99_ns":    row.LatP99,
						"bid_price": row.BidPrice,   // live LOB best bid
						"ask_price": row.AskPrice,   // live LOB best ask
						"spread":    row.Spread,     // bid-ask spread
						"last_trade": row.LastTrade, // last matched trade price
						"fill_count": row.FillCount, // fills this tick (0-4)
					})
					w.redis.Publish(context.Background(), "telemetry:"+job.RunID, msg)
				}
			} else if packetType == 0x02 {
				// FILL is 40 bytes (33 bytes of data + 7 bytes padding)
				buf := make([]byte, 40)
				if _, err := io.ReadFull(pr, buf); err != nil { break }
				binaryTelemetry = append(binaryTelemetry, buf...)
			}
		}
	}()

	err := cmd.Start()
	if err != nil {
		return fmt.Errorf("spawn sb: %v", err)
	}
	w.updateRunStatus(job.RunID, "running", nil)

	// Wait for process to exit
	err = cmd.Wait()
	pw.Close()
	wg.Wait()

	// ── P0 FIX: Always stop the sandbox container after GM exits ─────────────
	// The sandbox_runner runs an infinite tick loop; without this call the
	// Docker container keeps running indefinitely after the GM binary exits.
	// This covers both normal completion AND TLE (5min cmdCtx timeout).
	go func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		payload := []byte(`{}`)
		req, _ := http.NewRequestWithContext(stopCtx, "POST",
			"http://vidhi_sandbox_manager:8081/stop/"+job.RunID, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Printf("[WORKER] /stop sandbox error for run=%s: %v", job.RunID[:min(12, len(job.RunID))], err)
			return
		}
		resp.Body.Close()
		log.Printf("[WORKER] Sandbox stopped for run=%s", job.RunID[:min(12, len(job.RunID))])
	}()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded || cmdCtx.Err() == context.DeadlineExceeded {
			w.updateRunStatus(job.RunID, "tle", nil)
			return fmt.Errorf("tle: GM timed out after 5 minutes")
		}
		return fmt.Errorf("gm exit: %v\nstderr: %s", err, stderr.String())
	}

	if len(jsonResult) == 0 {
		return fmt.Errorf("no JSON in GM stdout")
	}

	var result GMResult
	if err := json.Unmarshal(jsonResult, &result); err != nil {
		return fmt.Errorf("parse GM JSON: %v", err)
	}
	
	if result.Correctness < 0.99 {
		log.Printf("[WORKER] Low correctness detected. GM JSON output: %s", string(jsonResult))
	}

	w.updateRunStatus(job.RunID, "complete", &result)

	// Stream telemetry to TimescaleDB via COPY (async, best-effort)
	go w.streamTelemetryToDB(job.RunID, binaryTelemetry)

	return nil
}

// ─── Reaper: re-enqueue stale active jobs ────────────────────────────────────
func (w *Worker) reaper(ctx context.Context) {
	ticker := time.NewTicker(ReaperInterval)
	defer ticker.Stop()
	log.Println("[REAPER] Started — monitoring active queue for stale jobs")

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.reapStale(ctx)
		}
	}
}

func (w *Worker) reapStale(ctx context.Context) {
	// Get all items from active queue
	items, err := w.redis.LRange(ctx, QueueActive, 0, -1).Result()
	if err != nil || len(items) == 0 { return }

	for _, item := range items {
		var job RunJob
		if err := json.Unmarshal([]byte(item), &job); err != nil { continue }

		heartbeatKey := QueueActive + ":" + job.RunID + ActiveTTLSuffix
		exists, _ := w.redis.Exists(ctx, heartbeatKey).Result()
		if exists == 0 {
			// Heartbeat expired — worker crashed mid-job
			log.Printf("[REAPER] Stale job detected: %s — re-enqueueing (retry %d)", job.RunID, job.Retries+1)
			w.redis.LRem(ctx, QueueActive, 1, item)
			if job.Retries < MaxRetries {
				job.Retries++
				Enqueue(w.redis, job)
			} else {
				log.Printf("[REAPER] %s exhausted retries — discarding", job.RunID)
				w.updateRunStatus(job.RunID, "error", nil)
			}
		}
	}
}

// ─── Update run record in Postgres ────────────────────────────────────────────
func (w *Worker) updateRunStatus(runID, status string, result *GMResult) {
	if w.db == nil { return }
	ctx := context.Background()

	if result == nil {
		w.db.ExecContext(ctx, `UPDATE runs SET status=$1 WHERE run_id=$2`, status, runID)
		return
	}

	_, err := w.db.ExecContext(ctx, `
		UPDATE runs SET
			status=$1, pnl=$2, pnl_pct=$3, p50_ns=$4, p99_ns=$5,
			total_ticks=$6, tle_count=$7, violations=$8, correctness=$9, total_fills=$10, completed_at=NOW()
		WHERE run_id=$11`,
		status, result.PnL, result.PnLPct, result.P50NS, result.P99NS,
		result.TotalTicks, result.TLECount, result.Violations, result.Correctness, result.TotalFills, runID,
	)
	if err != nil {
		log.Printf("[DB] updateRunStatus error: %v", err)
	}

	// Refresh materialized leaderboard view (rate-limited: at most 1/5s)
	workerMaybeRefreshLeaderboard(w.db)

	// Fire Discord Webhook if PnL is extremely high (e.g., > 5%) or positive
	if result.PnLPct > 0.0 {
		go w.triggerDiscordWebhook(runID, result.PnLPct)
	}
}

// ─── Leaderboard refresh rate limiter (worker-side) ──────────────────────────
var (
	workerLastRefresh   time.Time
	workerRefreshMu     sync.Mutex
	workerRefreshMinGap = 5 * time.Second
)

func workerMaybeRefreshLeaderboard(db *sql.DB) {
	if db == nil { return }
	workerRefreshMu.Lock()
	if time.Since(workerLastRefresh) < workerRefreshMinGap {
		workerRefreshMu.Unlock()
		return
	}
	workerLastRefresh = time.Now()
	workerRefreshMu.Unlock()
	go func() {
		if _, err := db.ExecContext(context.Background(), "SELECT refresh_leaderboard()"); err != nil {
			log.Printf("[DB] worker refresh_leaderboard error: %v", err)
		}
	}()
}

// ─── Discord Webhook Integration ──────────────────────────────────────────────
func (w *Worker) triggerDiscordWebhook(runID string, pnlPct float64) {
	webhookURL := os.Getenv("DISCORD_WEBHOOK_URL")
	if webhookURL == "" {
		return // Webhook not configured
	}

	payload := map[string]interface{}{
		"content": nil,
		"embeds": []map[string]interface{}{
			{
				"title":       "🚀 New High Score Achieved!",
				"description": fmt.Sprintf("A contestant just completed a simulation with a **%.2f%%** PnL!", pnlPct),
				"color":       3066993, // Green
				"fields": []map[string]interface{}{
					{"name": "Run ID", "value": runID, "inline": true},
				},
			},
		},
	}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(webhookURL, "application/json", bytes.NewBuffer(body))
	if err == nil {
		resp.Body.Close()
	}
}

// ─── TimescaleDB COPY binary protocol stream ──────────────────────────────────
// Streams telemetry rows directly via PostgreSQL COPY binary protocol.
// Much faster than individual INSERTs — avoids parser + planner overhead.
func (w *Worker) streamTelemetryToDB(runID string, binaryTelemetry []byte) {
	if w.db == nil || len(binaryTelemetry) == 0 { return }

	type TickRow struct {
		TickID     int64
		PnLFP      int64
		Pos        int64
		LatP50     int64
		LatP99     int64
		BidPrice   float64
		AskPrice   float64
		Spread     float64
		LastTrade  float64
		FillCount  int32
		Pad        [4]byte // C++ aligns struct to 8-byte boundary → sizeof=80
	}

	type FillRow struct {
		TickID           int64
		Price            float64
		Volume           int64
		MakerParticipant int32
		TakerParticipant int32
		TakerIsBuy       bool
		Pad              [7]byte // C++ pads bool to 8-byte alignment → sizeof=40
	}

	var ticks []TickRow
	var fills []FillRow

	reader := bytes.NewReader(binaryTelemetry)
	for {
		var packetType uint8
		if err := binary.Read(reader, binary.LittleEndian, &packetType); err != nil {
			break
		}

		if packetType == 0x01 {
			var row TickRow
			if err := binary.Read(reader, binary.LittleEndian, &row); err != nil {
				break
			}
			ticks = append(ticks, row)
		} else if packetType == 0x02 {
			var row FillRow
			if err := binary.Read(reader, binary.LittleEndian, &row); err != nil {
				break
			}
			fills = append(fills, row)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("[COPY] Begin tx failed: %v", err)
		return
	}
	defer tx.Rollback()

	if len(ticks) > 0 {
		stmtTick, err := tx.PrepareContext(ctx, pq.CopyIn("tick_telemetry", "run_id", "tick_id", "ts", "pnl", "position", "tick_ns", "bid_price", "ask_price", "spread", "last_trade", "fill_count"))
		if err != nil {
			log.Printf("[COPY] Prepare tick_telemetry failed: %v", err)
			return
		}
		for _, row := range ticks {
			pnl := float64(row.PnLFP) / 1_000_000.0 // ×1e6 fixed-point (matches C++ to_fp() convention)
			_, err = stmtTick.ExecContext(ctx, runID, row.TickID, time.Now(), pnl, row.Pos, row.LatP99, row.BidPrice, row.AskPrice, row.Spread, row.LastTrade, row.FillCount)
			if err != nil {
				log.Printf("[COPY] ExecContext tick failed: %v", err)
				return
			}
		}
		if _, err := stmtTick.ExecContext(ctx); err != nil {
			log.Printf("[COPY] stmtTick flush failed: %v", err)
			return
		}
		stmtTick.Close()
	}

	if len(fills) > 0 {
		stmtFill, err := tx.PrepareContext(ctx, pq.CopyIn("fills", "run_id", "tick_id", "ts", "price", "volume", "maker_bot", "taker_bot", "is_buy"))
		if err != nil {
			log.Printf("[COPY] Prepare fills failed: %v", err)
			return
		}
		for _, row := range fills {
			_, err = stmtFill.ExecContext(ctx, runID, row.TickID, time.Now(), row.Price, row.Volume, row.MakerParticipant, row.TakerParticipant, row.TakerIsBuy)
			if err != nil {
				log.Printf("[COPY] ExecContext fill failed: %v", err)
				return
			}
		}
		if _, err := stmtFill.ExecContext(ctx); err != nil {
			log.Printf("[COPY] stmtFill flush failed: %v", err)
			return
		}
		stmtFill.Close()
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[COPY] Commit failed: %v", err)
		return
	}
	log.Printf("[COPY] Telemetry batch flush complete for run=%s (ticks=%d, fills=%d)", runID[:min(12, len(runID))], len(ticks), len(fills))
}

// ─── PostgreSQL COPY binary format writer ─────────────────────────────────────
// Used when bulk-streaming thousands of tick rows from the GM pipe output.
// Implements: https://www.postgresql.org/docs/current/sql-copy.html#id-1.9.3.55.9.4
type CopyWriter struct {
	buf bytes.Buffer
}

func newCopyWriter() *CopyWriter {
	cw := &CopyWriter{}
	// Signature: PGCOPY\n\377\r\n\0
	cw.buf.Write([]byte("PGCOPY\n\xff\r\n\x00"))
	// Flags field (32-bit, 0 = no OIDs)
	cw.writeInt32(0)
	// Header extension area length (32-bit, 0)
	cw.writeInt32(0)
	return cw
}

func (cw *CopyWriter) writeInt16(v int16) {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, uint16(v))
	cw.buf.Write(b)
}

func (cw *CopyWriter) writeInt32(v int32) {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, uint32(v))
	cw.buf.Write(b)
}

func (cw *CopyWriter) writeInt64(v int64) {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(v))
	cw.buf.Write(b)
}

func (cw *CopyWriter) writeFloat64(v float64) {
	cw.writeInt64(int64(math.Float64bits(v)))
}

// WriteRow appends a tick_telemetry row
func (cw *CopyWriter) WriteRow(runID string, tickID, tickNS int64, pnl float64, position int64) {
	cw.writeInt16(5) // field count
	// run_id (text)
	cw.writeInt32(int32(len(runID)))
	cw.buf.WriteString(runID)
	// tick_id (int8)
	cw.writeInt32(8); cw.writeInt64(tickID)
	// tick_ns (int8)
	cw.writeInt32(8); cw.writeInt64(tickNS)
	// pnl (float8)
	cw.writeInt32(8); cw.writeFloat64(pnl)
	// position (int8)
	cw.writeInt32(8); cw.writeInt64(position)
}

func (cw *CopyWriter) Finish() io.Reader {
	cw.writeInt16(-1) // file trailer
	return &cw.buf
}

// Helper
func (cw *CopyWriter) writeFloat64Real(v float64) {
	bits := *(*uint64)(unsafe.Pointer(&v))
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, bits)
	cw.buf.Write(b)
}
