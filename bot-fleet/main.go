// bot-fleet/main.go — Vidhi Arena Bot Fleet Service
// Lightweight HTTP service that orchestrates distributed bot load generators.
// Receives a job from the control plane (via Redis queue), spawns bots against
// the contestant's sandbox endpoint, streams telemetry back via WebSocket.
//
// In the hackathon demo this runs as a single process simulating N bots
// concurrently using goroutines. In a real deployment, this service would be
// horizontally scaled and each instance would pick jobs off the Redis queue.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// ─── Config ───────────────────────────────────────────────────────────────────
const (
	DefaultBotCount  = 50            // concurrent bots per job
	TicksPerBot      = 200_000       // ticks each bot generates
	BatchSize        = 500           // orders per HTTP request (REST mode)
	TelemetryFreqMs  = 200           // push telemetry every 200ms
)

// ─── Job ──────────────────────────────────────────────────────────────────────
type BotJob struct {
	RunID        string `json:"run_id"`
	SandboxURL   string `json:"sandbox_url"`   // http://sandbox:PORT
	BotCount     int    `json:"bot_count"`
	TargetTPS    int    `json:"target_tps"`    // desired orders/sec
	PhaseName    string `json:"phase"`         // "public" | "final"
}

// ─── Telemetry snapshot (pushed to control plane) ─────────────────────────────
type TelemetrySnap struct {
	RunID       string    `json:"run_id"`
	Timestamp   time.Time `json:"ts"`
	TotalOrders int64     `json:"total_orders"`
	TotalFills  int64     `json:"total_fills"`
	ErrorCount  int64     `json:"errors"`
	P50MS       float64   `json:"p50_ms"`
	P95MS       float64   `json:"p95_ms"`
	P99MS       float64   `json:"p99_ms"`
	CurrentTPS  float64   `json:"current_tps"`
	BotsSummary []BotStat `json:"bots"`
}

type BotStat struct {
	BotID   int     `json:"bot_id"`
	Type    string  `json:"type"`
	Orders  int64   `json:"orders"`
	Fills   int64   `json:"fills"`
	AvgMS   float64 `json:"avg_ms"`
}

// ─── Bot strategies ───────────────────────────────────────────────────────────
type BotType string
const (
	BotMM      BotType = "MARKET_MAKER"
	BotMOM     BotType = "MOMENTUM"
	BotMR      BotType = "MEAN_REVERSION"
	BotNoise   BotType = "NOISE"
	BotSniper  BotType = "SNIPER"
)

var botTypes = []BotType{BotMM, BotMOM, BotMR, BotNoise, BotSniper}

// ─── Order types ─────────────────────────────────────────────────────────────
type OrderSide  string
type OrderKind  string
const (
	SideBuy  OrderSide = "buy"
	SideSell OrderSide = "sell"
)
const (
	KindLimit  OrderKind = "limit"
	KindMarket OrderKind = "market"
	KindCancel OrderKind = "cancel"
)

type Order struct {
	Kind      OrderKind  `json:"kind"`
	Side      OrderSide  `json:"side"`
	Price     float64    `json:"price,omitempty"`
	Volume    int        `json:"volume"`
	BotID     int        `json:"bot_id"`
	Timestamp int64      `json:"ts_ns"`
}

// ─── Individual bot ───────────────────────────────────────────────────────────
type Bot struct {
	id          int
	botType     BotType
	rng         *rand.Rand
	inventory   int
	ema         float64
	basePrice   float64

	// telemetry
	orderCount  atomic.Int64
	fillCount   atomic.Int64
	errCount    atomic.Int64
	latencies   []float64
	latMu       sync.Mutex
}

func newBot(id int, seed int64) *Bot {
	return &Bot{
		id:        id,
		botType:   botTypes[id % len(botTypes)],
		rng:       rand.New(rand.NewSource(seed)),
		ema:       1500.0,
		basePrice: 1500.0,
	}
}

// Generate orders based on bot strategy and market state
func (b *Bot) generateOrders(midPrice, bid, ask float64) []Order {
	orders := make([]Order, 0, 4)
	switch b.botType {

	case BotMM:
		// Market maker: quote both sides, skew by inventory
		skew := float64(b.inventory) * 0.002
		spread := math.Max(0.02, (ask-bid)*0.8)
		bPrice := math.Round((midPrice-spread/2-skew)*100) / 100
		aPrice := math.Round((midPrice+spread/2-skew)*100) / 100
		orders = append(orders,
			Order{Kind: KindLimit, Side: SideBuy,  Price: bPrice, Volume: 50, BotID: b.id},
			Order{Kind: KindLimit, Side: SideSell, Price: aPrice, Volume: 50, BotID: b.id},
		)

	case BotMOM:
		// Momentum: follow EMA
		b.ema = 0.97*b.ema + 0.03*midPrice
		diff := midPrice - b.ema
		if diff > 0.03 {
			orders = append(orders, Order{Kind: KindMarket, Side: SideBuy,  Volume: 30, BotID: b.id})
		} else if diff < -0.03 {
			orders = append(orders, Order{Kind: KindMarket, Side: SideSell, Volume: 30, BotID: b.id})
		}

	case BotMR:
		// Mean reversion: fade large moves
		dev := midPrice - b.basePrice
		if dev > 0.05 {
			orders = append(orders, Order{Kind: KindLimit, Side: SideSell, Price: midPrice - 0.01, Volume: 80, BotID: b.id})
		} else if dev < -0.05 {
			orders = append(orders, Order{Kind: KindLimit, Side: SideBuy,  Price: midPrice + 0.01, Volume: 80, BotID: b.id})
		}

	case BotNoise:
		// Random noise: sporadic orders
		if b.rng.Float64() > 0.6 {
			offset := float64(b.rng.Intn(5)-2) * 0.01
			vol := 10 + b.rng.Intn(30)
			if b.rng.Float64() > 0.5 {
				orders = append(orders, Order{Kind: KindLimit, Side: SideBuy,  Price: bid + offset, Volume: vol, BotID: b.id})
			} else {
				orders = append(orders, Order{Kind: KindLimit, Side: SideSell, Price: ask + offset, Volume: vol, BotID: b.id})
			}
		}

	case BotSniper:
		// Sniper/arb: hit mispriced quotes aggressively
		if ask < b.basePrice-0.01 {
			orders = append(orders, Order{Kind: KindMarket, Side: SideBuy,  Volume: 100, BotID: b.id})
		} else if bid > b.basePrice+0.01 {
			orders = append(orders, Order{Kind: KindMarket, Side: SideSell, Volume: 100, BotID: b.id})
		}
	}

	for i := range orders {
		orders[i].Timestamp = time.Now().UnixNano()
	}
	return orders
}

func (b *Bot) recordLatency(ms float64) {
	b.latMu.Lock()
	b.latencies = append(b.latencies, ms)
	if len(b.latencies) > 1000 {
		b.latencies = b.latencies[len(b.latencies)-1000:]
	}
	b.latMu.Unlock()
}

func (b *Bot) stat() BotStat {
	b.latMu.Lock()
	var avg float64
	if len(b.latencies) > 0 {
		sum := 0.0
		for _, l := range b.latencies { sum += l }
		avg = sum / float64(len(b.latencies))
	}
	b.latMu.Unlock()
	return BotStat{
		BotID:  b.id,
		Type:   string(b.botType),
		Orders: b.orderCount.Load(),
		Fills:  b.fillCount.Load(),
		AvgMS:  math.Round(avg*100) / 100,
	}
}

// ─── Fleet runner ─────────────────────────────────────────────────────────────
type Fleet struct {
	job     BotJob
	bots    []*Bot
	client  *http.Client

	totalOrders atomic.Int64
	totalFills  atomic.Int64
	totalErrors atomic.Int64

	allLatencies []float64
	latMu        sync.Mutex

	done    chan struct{}
	cancel  context.CancelFunc
}

func newFleet(job BotJob) *Fleet {
	count := job.BotCount
	if count <= 0 { count = DefaultBotCount }
	bots := make([]*Bot, count)
	for i := range bots {
		bots[i] = newBot(i, time.Now().UnixNano()+int64(i))
	}
	return &Fleet{
		job:    job,
		bots:   bots,
		client: &http.Client{Timeout: 5 * time.Second},
		done:   make(chan struct{}),
	}
}

func (f *Fleet) sendOrders(orders []Order) (int, error) {
	body, _ := json.Marshal(orders)
	req, _ := http.NewRequest("POST", f.job.SandboxURL+"/orders", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Run-ID", f.job.RunID)

	t0 := time.Now()
	resp, err := f.client.Do(req)
	latMs := float64(time.Since(t0).Microseconds()) / 1000.0

	f.latMu.Lock()
	f.allLatencies = append(f.allLatencies, latMs)
	if len(f.allLatencies) > 5000 {
		f.allLatencies = f.allLatencies[len(f.allLatencies)-5000:]
	}
	f.latMu.Unlock()

	if err != nil { return 0, err }
	defer resp.Body.Close()

	var result struct { Fills int `json:"fills"` }
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Fills, nil
}

func (f *Fleet) percentiles() (p50, p95, p99 float64) {
	f.latMu.Lock()
	lats := make([]float64, len(f.allLatencies))
	copy(lats, f.allLatencies)
	f.latMu.Unlock()
	if len(lats) == 0 { return }

	// Simple sort (insertion sort sufficient for <5000 elems)
	for i := 1; i < len(lats); i++ {
		for j := i; j > 0 && lats[j] < lats[j-1]; j-- {
			lats[j], lats[j-1] = lats[j-1], lats[j]
		}
	}
	p50 = lats[int(float64(len(lats))*0.50)]
	p95 = lats[int(float64(len(lats))*0.95)]
	p99 = lats[int(float64(len(lats))*0.99)]
	return
}

func (f *Fleet) run(ctx context.Context, telemetryCh chan<- TelemetrySnap) {
	var wg sync.WaitGroup
	tickInterval := time.Duration(1000/max(f.job.TargetTPS/len(f.bots), 1)) * time.Millisecond

	for _, bot := range f.bots {
		wg.Add(1)
		go func(b *Bot) {
			defer wg.Done()
			ticker := time.NewTicker(tickInterval)
			defer ticker.Stop()
			midPrice, bid, ask := 1500.0, 1499.95, 1500.05

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					orders := b.generateOrders(midPrice, bid, ask)
					if len(orders) == 0 { continue }
					fills, err := f.sendOrders(orders)
					if err != nil {
						b.errCount.Add(1)
						f.totalErrors.Add(1)
					} else {
						b.orderCount.Add(int64(len(orders)))
						b.fillCount.Add(int64(fills))
						f.totalOrders.Add(int64(len(orders)))
						f.totalFills.Add(int64(fills))
						// Simple price walk
						midPrice += (rand.Float64() - 0.5) * 0.02
						bid = midPrice - 0.05
						ask = midPrice + 0.05
					}
				}
			}
		}(bot)
	}

	// Telemetry ticker
	go func() {
		t := time.NewTicker(TelemetryFreqMs * time.Millisecond)
		defer t.Stop()
		var lastOrders int64
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				cur := f.totalOrders.Load()
				tps := float64(cur-lastOrders) / (float64(TelemetryFreqMs) / 1000.0)
				lastOrders = cur
				p50, p95, p99 := f.percentiles()
				stats := make([]BotStat, len(f.bots))
				for i, b := range f.bots { stats[i] = b.stat() }
				telemetryCh <- TelemetrySnap{
					RunID:       f.job.RunID,
					Timestamp:   time.Now(),
					TotalOrders: cur,
					TotalFills:  f.totalFills.Load(),
					ErrorCount:  f.totalErrors.Load(),
					P50MS:       p50, P95MS: p95, P99MS: p99,
					CurrentTPS:  tps,
					BotsSummary: stats,
				}
			}
		}
	}()

	wg.Wait()
	close(f.done)
}

func max(a, b int) int {
	if a > b { return a }
	return b
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
var (
	activeFleets = make(map[string]*Fleet)
	fleetsMu     sync.RWMutex
	wsUpgrader   = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	telemetryCh  = make(chan TelemetrySnap, 256)
	wsClients    = make(map[*websocket.Conn]bool)
	wsClientsMu  sync.Mutex
)

func handleLaunch(w http.ResponseWriter, r *http.Request) {
	var job BotJob
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if job.RunID == "" || job.SandboxURL == "" {
		http.Error(w, "run_id and sandbox_url required", 400)
		return
	}
	if job.BotCount  == 0 { job.BotCount  = DefaultBotCount }
	if job.TargetTPS == 0 { job.TargetTPS = job.BotCount * 10 }

	fleet := newFleet(job)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	fleet.cancel = cancel

	fleetsMu.Lock()
	activeFleets[job.RunID] = fleet
	fleetsMu.Unlock()

	go fleet.run(ctx, telemetryCh)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "launched",
		"run_id": job.RunID,
	})
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	runID := mux.Vars(r)["run_id"]
	fleetsMu.Lock()
	f, ok := activeFleets[runID]
	if ok {
		f.cancel()
		delete(activeFleets, runID)
	}
	fleetsMu.Unlock()
	if !ok {
		http.Error(w, "fleet not found", 404)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	runID := mux.Vars(r)["run_id"]
	fleetsMu.RLock()
	f, ok := activeFleets[runID]
	fleetsMu.RUnlock()
	if !ok {
		http.Error(w, "not found", 404)
		return
	}
	p50, p95, p99 := f.percentiles()
	json.NewEncoder(w).Encode(map[string]any{
		"run_id":       runID,
		"total_orders": f.totalOrders.Load(),
		"total_fills":  f.totalFills.Load(),
		"errors":       f.totalErrors.Load(),
		"p50_ms": p50, "p95_ms": p95, "p99_ms": p99,
	})
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil { return }
	defer conn.Close()
	wsClientsMu.Lock()
	wsClients[conn] = true
	wsClientsMu.Unlock()
	for { if _, _, err := conn.ReadMessage(); err != nil { break } }
	wsClientsMu.Lock()
	delete(wsClients, conn)
	wsClientsMu.Unlock()
}

// Telemetry broadcast goroutine
func broadcastTelemetry() {
	for snap := range telemetryCh {
		msg, _ := json.Marshal(snap)
		wsClientsMu.Lock()
		for conn := range wsClients {
			conn.WriteMessage(websocket.TextMessage, msg)
		}
		wsClientsMu.Unlock()
	}
}

func main() {
	go broadcastTelemetry()

	r := mux.NewRouter()
	r.HandleFunc("/health",                handleHealth).Methods("GET")
	r.HandleFunc("/fleet/launch",          handleLaunch).Methods("POST")
	r.HandleFunc("/fleet/{run_id}/stop",   handleStop).Methods("POST")
	r.HandleFunc("/fleet/{run_id}/status", handleStatus).Methods("GET")
	r.HandleFunc("/ws/telemetry",          handleWS)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST"},
		AllowedHeaders: []string{"Content-Type"},
	}).Handler(r)

	port := os.Getenv("PORT")
	if port == "" { port = "9090" }
	log.Printf("[BOT-FLEET] Starting on :%s — %d bot strategies ready", port, len(botTypes))
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	fleetsMu.RLock()
	active := len(activeFleets)
	fleetsMu.RUnlock()
	json.NewEncoder(w).Encode(map[string]any{
		"status":        "ok",
		"active_fleets": active,
		"bot_strategies": len(botTypes),
	})
}
