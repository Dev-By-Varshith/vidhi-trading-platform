// game-master/rendezvous.hpp
// Shared memory layout between Game Master (Core 2) and Contestant Sandbox (Core 3)
// v5.0: Extended to 1024 bytes — includes LOB depth, fill notifications, persistent state
//
// CRITICAL DESIGN RULES:
//   1. Every field lives on its own 64-byte cache line (zero false sharing)
//   2. GM writes with regular stores (NOT NT stores) — MESI coherence handles it
//   3. Contestant reads after acquiring on gm_sequence (acquire load)
//   4. NT stores (_mm_stream_si64) ONLY on the telemetry ring (write-only data)
//   5. Padding is not a suggestion — it's load-bearing

#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <emmintrin.h>

static constexpr int32_t FILL_SLOTS    = 4;
static constexpr int32_t ORDER_SLOTS   = 4;
static constexpr int32_t STATE_SLOTS   = 16;
static constexpr int32_t DEPTH_LEVELS  = 5;
static constexpr int64_t FIXED_POINT   = 1'000'000;   // 1e6 — double × FP = int64

// Fixed-point helpers
inline int64_t to_fp(double v)  { return static_cast<int64_t>(v * FIXED_POINT); }
inline double  from_fp(int64_t v){ return static_cast<double>(v) / FIXED_POINT; }

// ─── Participant IDs ────────────────────────────────────────────────────────
// Must be stable — written into fills and order records across all headers.
// 0 = contestant, 1-5 = bots, 6+ reserved
using ParticipantID = int32_t;
static constexpr ParticipantID CONTESTANT  = 0;
static constexpr ParticipantID BOT_MM      = 1;  // Market Maker (Avellaneda-Stoikov)
static constexpr ParticipantID BOT_MOM     = 2;  // Momentum Trader (EMA crossover)
static constexpr ParticipantID BOT_MR      = 3;  // Mean Reversion
static constexpr ParticipantID BOT_NOISE   = 4;  // Noise Trader (xorshift)
static constexpr ParticipantID BOT_SNIPER  = 5;  // Sniper / Arbitrageur

// ─── Fill notification (48 bytes → padded to 64) ───────────────────────────
struct alignas(8) Fill {
    int64_t  order_id;         // which order was filled
    int64_t  fill_price_fp;    // fixed-point price × 1e6
    int64_t  fill_volume;      // shares filled
    int32_t  side;             // 0 = buy filled, 1 = sell filled
    int32_t  participant_id;   // 0 = contestant, 1-5 = bots
    uint8_t  _pad[16];
    // Total: 48 bytes
};
static_assert(sizeof(Fill) == 48, "Fill struct size mismatch");

// ─── Limit Order from contestant (32 bytes) ────────────────────────────────
struct alignas(8) Order {
    int64_t  type;        // 0=HOLD 1=LIM_BUY 2=LIM_SELL 3=MKT_BUY 4=MKT_SELL 5=CANCEL
    int64_t  price_fp;    // fixed-point × 1e6 (for limit orders)
    int64_t  volume;      // shares
    int64_t  order_id;    // for CANCEL orders
    // Total: 32 bytes
};
static_assert(sizeof(Order) == 32, "Order struct size mismatch");

// ─── LOB level (16 bytes) ─────────────────────────────────────────────────
struct alignas(8) LOBLevel {
    int64_t price_fp;   // fixed-point × 1e6
    int64_t volume;     // total volume at this level
};

// ─── Main shared memory struct ────────────────────────────────────────────
struct alignas(64) SharedMem {

    // ═══ CACHE LINE 0: Game Master → Contestant signal ════════════════════
    alignas(64) std::atomic<uint64_t> gm_sequence{0};
    uint8_t _pad0[56];
    // Total CL0: 64 bytes ✓

    // ═══ CACHE LINES 1-8: Market Snapshot Block (GM writes, Contestant reads)
    // Exactly 512 bytes (64 int64_t slots)
    alignas(64)
    int64_t  bid_price_fp;         // [0] best bid (fixed-point)
    int64_t  ask_price_fp;         // [1] best ask
    int64_t  mid_price_fp;         // [2] mid
    int64_t  spread_fp;            // [3] ask - bid
    int64_t  last_trade_price_fp;  // [4] last matched trade price
    int64_t  last_trade_volume;    // [5] volume of last matched trade
    int64_t  underlying_signal_fp; // [6] fair value reference
    int64_t  volatility_fp;        // [7] realized vol estimate
    
    // ── LOB depth (5 levels each side) ──────────────────────────────────
    LOBLevel bid_depth[DEPTH_LEVELS];   // [8..17] 5 × 16 = 80 bytes
    LOBLevel ask_depth[DEPTH_LEVELS];   // [18..27] 5 × 16 = 80 bytes
    
    int64_t  timestamp_tsc;        // [28] __rdtscp at time of snapshot
    int64_t  contestant_position;  // [29] net position (shares)
    int64_t  contestant_cash_fp;   // [30] cash in fixed-point × 1e6 (microdollars, same as all prices)
    int64_t  contestant_pnl_fp;    // [31] mark-to-market PnL × 1e6 (microdollars)
    int64_t  open_order_count;     // [32] number of resting limit orders
    int64_t  fill_count;           // [33] how many fills this tick (0-4)

    // ─── Fill Notifications ──────────────────────────────────────────────
    // 4 Fills * 4 int64s = 16 int64s [34..49]
    // For each fill: [order_id, price_fp, volume, side (0=buy, 1=sell)]
    int64_t  fills[16];            // [34..49]

    int64_t  _md_pad[14];          // [50..63] (Total 64 int64_t = 512 bytes)

    // ═══ CACHE LINE 9: Contestant → Game Master signal ════════════════════
    alignas(64) std::atomic<uint64_t> sb_sequence{0};
    uint8_t _pad3[56];
    // Total CL9: 64 bytes ✓

    // ═══ CACHE LINES 10-17: Order Zone & Persistent State (Contestant writes)
    // Exactly 512 bytes (64 int64_t slots)
    alignas(64)
    int64_t order_count;          // [0]
    
    // 4 Orders * 4 int64s = 16 int64s [1..16]
    // For each order: [type, price_fp, volume, order_id]
    int64_t orders[16];           // [1..16]
    
    int64_t _oo_pad[31];          // [17..47]
    
    int64_t persistent_state[STATE_SLOTS]; // [48..63] (Total 64 int64_t = 512 bytes)
};

// Compile-time sanity: struct must fit perfectly in 1152 bytes (18 * 64 cache lines)
static_assert(sizeof(SharedMem) == 1152, "SharedMem size mismatch. Must be 1152 bytes.");

// ─── Sequence protocol helpers ─────────────────────────────────────────────

// GM: write market data → release gm_sequence
inline void gm_signal(SharedMem* sm, uint64_t seq) {
    sm->gm_sequence.store(seq, std::memory_order_release);
}

// Contestant: spin-wait for GM signal (with pause, max_spins budget)
// Returns false if TLE (exceeded spin budget)
inline bool sandbox_wait(SharedMem* sm, uint64_t expected_seq, int max_spins = 100'000) {
    for (int i = 0; i < max_spins; ++i) {
        if (sm->gm_sequence.load(std::memory_order_acquire) == expected_seq)
            return true;
        _mm_pause();  // SSE2 pause — saves power, improves hyper-thread throughput
    }
    return false; // TLE
}

// Contestant: write orders → release sb_sequence
inline void sandbox_signal(SharedMem* sm, uint64_t seq) {
    sm->sb_sequence.store(seq, std::memory_order_release);
}

// GM: spin-wait for sandbox response (with watchdog fallback)
// max_spins = 20k: _mm_pause ≈5ns on 5GHz server → 20k × 5ns = 100µs TLE budget.
// The Watchdog thread enforces the hard wall-clock deadline via SIGKILL independently.
// Setting this too high (e.g. 500k) blocks the GM loop for 5× the TLE budget.
inline bool gm_wait_sandbox(SharedMem* sm, uint64_t expected_seq, int max_spins = 20'000) {
    for (int i = 0; i < max_spins; ++i) {
        if (sm->sb_sequence.load(std::memory_order_acquire) == expected_seq)
            return true;
        _mm_pause();
    }
    return false; // TLE — watchdog will SIGKILL sandbox via HTTP to Sandbox Manager
}
