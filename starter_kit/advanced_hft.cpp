// starter_kit/advanced_hft.cpp
// Advanced Strategy: Native C++ — Avellaneda-Stoikov Market Maker (simplified)
//
// HOW THIS WORKS:
//   The Vidhi sandbox loads this as a shared library (.so) at runtime.
//   Your on_tick() function is called once per market tick (~111ns budget).
//   You read market state from the SharedMem struct and write orders back.
//
// BUILD (on the contest server):
//   g++ -O3 -march=native -fPIC -shared -o my_strategy.so advanced_hft.cpp
//
// RULES:
//   - Max 4 orders per tick (ORDER_SLOTS = 4)
//   - Position limit: ±1000 (breach = 10% PnL penalty)
//   - TLE: 100µs per tick → exceeding it = HOLD (orders discarded)
//   - No system calls (seccomp blocks everything except mmap/brk)
//
// STATE:
//   Persistent state lives in sm->persistent_state[0..15] (16 × int64_t slots).
//   These survive across ticks. Use fixed-point arithmetic (×1e6) for prices.

#include "../game-master/rendezvous.hpp"  // SharedMem, ORDER_SLOTS, to_fp(), from_fp()
#include <cmath>
#include <cstdint>

// ─── Persistent state layout (in sm->persistent_state[]) ──────────────────────
// Use slots 0-15 (int64_t each). Use fixed-point or bit-cast for doubles.
// Trick: use __int64 → double bit-cast via union to avoid UB.
static inline double i64_to_f64(int64_t v) {
    union { int64_t i; double d; } u; u.i = v; return u.d;
}
static inline int64_t f64_to_i64(double v) {
    union { int64_t i; double d; } u; u.d = v; return u.i;
}

// Slot assignments
#define SLOT_EMA_FAST  0   // fast EMA (double, bit-cast to int64)
#define SLOT_EMA_SLOW  1   // slow EMA
#define SLOT_TICK_CNT  2   // tick counter (int64)
#define SLOT_LAST_BID  3   // last bid price_fp
#define SLOT_LAST_ASK  4   // last ask price_fp
#define SLOT_INVENTORY 5   // shadow position tracker

// ─── Order submission helpers ─────────────────────────────────────────────────
// Writes into sm->orders[slot * 4] in the correct layout:
//   [type, price_fp, volume, order_id]  (4 × int64_t per order)
static inline void submit_limit_buy(SharedMem* sm, int slot, int64_t price_fp, int64_t vol) {
    if (slot >= ORDER_SLOTS) return;
    int64_t* o = &sm->orders[slot * 4];
    o[0] = 1;        // LIMIT_BUY
    o[1] = price_fp;
    o[2] = vol;
    o[3] = 0;
}
static inline void submit_limit_sell(SharedMem* sm, int slot, int64_t price_fp, int64_t vol) {
    if (slot >= ORDER_SLOTS) return;
    int64_t* o = &sm->orders[slot * 4];
    o[0] = 2;        // LIMIT_SELL
    o[1] = price_fp;
    o[2] = vol;
    o[3] = 0;
}
static inline void submit_market_buy(SharedMem* sm, int slot, int64_t vol) {
    if (slot >= ORDER_SLOTS) return;
    int64_t* o = &sm->orders[slot * 4];
    o[0] = 3;  // MARKET_BUY
    o[1] = 0; o[2] = vol; o[3] = 0;
}
static inline void submit_market_sell(SharedMem* sm, int slot, int64_t vol) {
    if (slot >= ORDER_SLOTS) return;
    int64_t* o = &sm->orders[slot * 4];
    o[0] = 4;  // MARKET_SELL
    o[1] = 0; o[2] = vol; o[3] = 0;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
extern "C" void on_tick(SharedMem* sm) {
    // ── Read market state ──────────────────────────────────────────────────────
    const int64_t bid_fp  = sm->bid_price_fp;  // Best bid (fixed-point ×1e6)
    const int64_t ask_fp  = sm->ask_price_fp;  // Best ask
    const int64_t pos     = sm->contestant_position;  // Our net position

    // Sanity check: no market data yet (first tick)
    if (bid_fp == 0 || ask_fp == 0) {
        sm->order_count = 0;
        return;
    }

    const double bid      = from_fp(bid_fp);
    const double ask      = from_fp(ask_fp);
    const double mid      = (bid + ask) / 2.0;

    // ── Load persistent state ─────────────────────────────────────────────────
    int64_t tick_count = sm->persistent_state[SLOT_TICK_CNT];
    double  ema_fast   = tick_count == 0 ? mid : i64_to_f64(sm->persistent_state[SLOT_EMA_FAST]);
    double  ema_slow   = tick_count == 0 ? mid : i64_to_f64(sm->persistent_state[SLOT_EMA_SLOW]);

    // ── Update EMAs ───────────────────────────────────────────────────────────
    // Fast EMA: α = 0.05 (20-tick halflife)
    // Slow EMA: α = 0.005 (200-tick halflife)
    ema_fast = ema_fast * 0.95 + mid * 0.05;
    ema_slow = ema_slow * 0.995 + mid * 0.005;

    const double signal   = ema_fast - ema_slow;  // positive = bullish
    const double spread   = ask - bid;
    const double half_sp  = spread / 2.0;

    // ── Avellaneda-Stoikov: inventory-adjusted quotes ─────────────────────────
    // Skew the quotes toward reducing position risk.
    // inventory_skew ∈ [-1, 1] based on position vs limit (±1000)
    const double inv_frac = static_cast<double>(pos) / 1000.0;  // ∈ [-1, 1]
    const double gamma    = 0.10;   // risk aversion (tune higher = tighter hedge)
    const double sigma    = 0.005;  // estimated volatility per tick

    // Reservation price = mid - gamma × inventory × sigma²
    const double reserve  = mid - gamma * inv_frac * sigma * sigma;

    // Optimal spread (simplified: 2 × gamma × sigma²)
    const double opt_half = gamma * sigma * sigma + half_sp;

    // Quoted bid/ask
    double q_bid = reserve - opt_half;
    double q_ask = reserve + opt_half;

    // Apply momentum signal: shift quotes up/down
    q_bid += signal * 0.002;
    q_ask += signal * 0.002;

    // Convert to fixed-point (round to 1-cent tick = ×100 after ×1e6)
    const int64_t TICK_FP = 10000; // 0.01 USD in fixed-point ×1e6
    int64_t q_bid_fp = (to_fp(q_bid) / TICK_FP) * TICK_FP;
    int64_t q_ask_fp = (to_fp(q_ask) / TICK_FP) * TICK_FP;

    // Don't cross the spread — ensure bid < ask
    if (q_bid_fp >= q_ask_fp) q_ask_fp = q_bid_fp + TICK_FP;

    // ── Submit orders (max 4 slots) ───────────────────────────────────────────
    int n = 0;
    sm->order_count = 0;

    // Position limits: don't widen the position beyond ±900
    const bool can_buy  = pos < 900;
    const bool can_sell = pos > -900;

    // Market taker order: aggressively take the other side on strong signal
    if (signal > 0.05 && can_buy && tick_count > 10) {
        submit_market_buy(sm, n++, 10);
    } else if (signal < -0.05 && can_sell && tick_count > 10) {
        submit_market_sell(sm, n++, 10);
    }

    // Limit maker orders: passive quotes
    if (can_buy && n < ORDER_SLOTS) {
        submit_limit_buy(sm, n++, q_bid_fp, 20);
    }
    if (can_sell && n < ORDER_SLOTS) {
        submit_limit_sell(sm, n++, q_ask_fp, 20);
    }

    sm->order_count = n;

    // ── Save persistent state ─────────────────────────────────────────────────
    sm->persistent_state[SLOT_EMA_FAST] = f64_to_i64(ema_fast);
    sm->persistent_state[SLOT_EMA_SLOW] = f64_to_i64(ema_slow);
    sm->persistent_state[SLOT_TICK_CNT] = tick_count + 1;
    sm->persistent_state[SLOT_LAST_BID] = bid_fp;
    sm->persistent_state[SLOT_LAST_ASK] = ask_fp;
    sm->persistent_state[SLOT_INVENTORY] = pos;
}
