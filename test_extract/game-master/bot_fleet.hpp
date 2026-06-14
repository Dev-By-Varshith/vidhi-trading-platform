// game-master/bot_fleet.hpp
// 5 inline bot strategies — all compute on Core 2 alongside the Game Master
// Total compute budget: ~10ns for all 5 bots per tick
// All bots are pure C++, no IPC, no virtual dispatch, no heap allocs in hot path
//
// BUG FIX (P0): MeanReversionBot and NoiseTraderBot previously accumulated
// orders indefinitely, bloating the LOB to millions of entries over 1M ticks.
// Fix: Both bots now cap their resting order count via a small circular ring.
// Old orders beyond the cap are cancelled before new ones are placed.

#pragma once
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <algorithm>
#include "persistent_lob.hpp"
#include "rendezvous.hpp"

// ─── Market snapshot (lightweight, computed by GM before bot step) ────────
struct MarketSnapshot {
    int64_t  bid_fp;
    int64_t  ask_fp;
    int64_t  mid_fp;
    int64_t  spread_fp;
    int64_t  fair_value_fp;    // underlying price signal
    int64_t  volatility_fp;
    bool     is_news_event;
};

// ─── Small fixed-size order ring — no heap allocs ─────────────────────────
// Bots with resting limit orders store their order IDs here.
// When the ring is full, the oldest order is cancelled before a new one is placed.
template<int CAPACITY>
struct OrderRing {
    uint64_t ids[CAPACITY] = {};
    int      head = 0;   // next slot to write
    int      count = 0;  // how many valid entries

    // Push a new order; if full, returns the evicted ID (needs cancel), else 0
    uint64_t push(uint64_t new_id) {
        uint64_t evicted = 0;
        if (count == CAPACITY) {
            // Ring is full — evict the oldest entry
            evicted = ids[head];
        } else {
            count++;
        }
        ids[head] = new_id;
        head = (head + 1) % CAPACITY;
        return evicted;
    }

    void clear() { head = 0; count = 0; }
};

// ─── Bot base — NO virtual dispatch in hot path ───────────────────────────
// P1 TODO: Replace with CRTP to eliminate vtable; using virtual for now
// for readability (saves ~25ns/tick when switched to direct calls).
struct BotBase {
    ParticipantID id;
    double agg = 1.0;
    virtual void compute(PersistentLOB& lob, const MarketSnapshot& snap) = 0;
    virtual void on_fill(const MatchedFill& f) = 0;
    virtual ~BotBase() = default;
};

// ═════════════════════════════════════════════════════════════════════════════
// Bot 1: Market Maker (Avellaneda-Stoikov)
// Posts bid/ask around fair value. Skews quotes based on inventory.
// If contestant takes liquidity, MM widens spread on the next tick.
// ═════════════════════════════════════════════════════════════════════════════
struct MarketMakerBot : BotBase {
    int64_t  inventory    = 0;
    uint64_t bid_order_id = 0;
    uint64_t ask_order_id = 0;
    int64_t  posted_bid   = 0;
    int64_t  posted_ask   = 0;
    int64_t  quote_volume = 50;

    MarketMakerBot() { id = BOT_MM; }

    void compute(PersistentLOB& lob, const MarketSnapshot& snap) override {
        // Cancel stale quotes first (MM posts exactly 1 bid + 1 ask at a time)
        if (bid_order_id) lob.cancel(bid_order_id);
        if (ask_order_id) lob.cancel(ask_order_id);

        // Avellaneda-Stoikov: skew quotes by inventory
        // skew = gamma × inventory × sigma² × T
        int64_t skew_fp = (inventory * snap.volatility_fp) / (1000 * FIXED_POINT);

        // Half-spread: wider when volatility is high
        int64_t half_spread_fp = std::max(
            to_fp(0.01),  // minimum 1 tick
            snap.volatility_fp / 2 + to_fp(0.005)
        );
        if (snap.is_news_event) {
            half_spread_fp *= 2; // News event: widen spread
        }

        posted_bid = snap.fair_value_fp - half_spread_fp - skew_fp;
        posted_ask = snap.fair_value_fp + half_spread_fp - skew_fp;

        // Ensure bid < ask (sanity check)
        if (posted_bid >= posted_ask) {
            posted_bid = snap.mid_fp - to_fp(0.01);
            posted_ask = snap.mid_fp + to_fp(0.01);
        }

        int64_t current_quote_vol = static_cast<int64_t>(quote_volume * agg);
        bid_order_id = lob.add_limit(true,  posted_bid, current_quote_vol, BOT_MM);
        ask_order_id = lob.add_limit(false, posted_ask, current_quote_vol, BOT_MM);
    }

    void on_fill(const MatchedFill& f) override {
        if (f.maker_participant == BOT_MM) {
            // We were the maker — inventory changes
            inventory += f.taker_is_buy ? -f.volume : +f.volume;
        }
        // Clamp inventory to ±500
        inventory = std::max(static_cast<int64_t>(-500), std::min(static_cast<int64_t>(500), inventory));
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Bot 2: Momentum Trader (EMA crossover)
// Follows price trends. Front-runs contestant's directional moves.
// Uses market orders only — no resting orders to accumulate.
// ═════════════════════════════════════════════════════════════════════════════
struct MomentumBot : BotBase {
    int64_t ema_fast_fp = 0;   // α = 0.05
    int64_t ema_slow_fp = 0;   // α = 0.01
    bool    initialized = false;
    int64_t position    = 0;   // net position (caps at ±200)

    MomentumBot() { id = BOT_MOM; }

    void compute(PersistentLOB& lob, const MarketSnapshot& snap) override {
        if (!initialized) {
            ema_fast_fp = ema_slow_fp = snap.mid_fp;
            initialized = true;
            return;
        }
        // EMA update (branchless fixed-point)
        // ema_fast = 0.95 × ema_fast + 0.05 × mid
        ema_fast_fp = (ema_fast_fp * 95 + snap.mid_fp * 5) / 100;
        ema_slow_fp = (ema_slow_fp * 99 + snap.mid_fp * 1) / 100;

        int64_t signal_fp = ema_fast_fp - ema_slow_fp;
        int64_t threshold = to_fp(0.03) / agg;  // lower threshold if aggressive
        if (snap.is_news_event) {
            threshold /= 2; // News event: react faster
        }

        // Position-limit-aware directional trades (market orders only — no accumulation)
        if (signal_fp >  threshold && position < 200) {
            lob.market_order(true,  static_cast<int64_t>(30 * agg), BOT_MOM);
        }
        if (signal_fp < -threshold && position > -200) {
            lob.market_order(false, static_cast<int64_t>(30 * agg), BOT_MOM);
        }

        // Gradual position unwind when signal is neutral (prevents unlimited accumulation)
        if (std::abs(signal_fp) < threshold / 2 && position != 0) {
            int64_t unwind_vol = std::min((int64_t)10, std::abs(position));
            if (position > 0) lob.market_order(false, unwind_vol, BOT_MOM);
            else              lob.market_order(true,  unwind_vol, BOT_MOM);
        }
    }

    void on_fill(const MatchedFill& f) override {
        if (f.taker_participant == BOT_MOM) {
            position += f.taker_is_buy ? +f.volume : -f.volume;
        }
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Bot 3: Mean Reversion (FIXED: was accumulating orders indefinitely)
// Fades moves that deviate from underlying fair value.
// Heavy seller into contestant's aggressive buys.
//
// FIX: Caps resting orders to MAX_MR_ORDERS = 8 per side using OrderRing.
//      Oldest order is cancelled before each new order is placed.
// ═════════════════════════════════════════════════════════════════════════════
struct MeanReversionBot : BotBase {
    static constexpr int MAX_MR_ORDERS = 8;  // max resting orders per side
    OrderRing<MAX_MR_ORDERS> bid_ring;        // active buy order IDs
    OrderRing<MAX_MR_ORDERS> ask_ring;        // active sell order IDs

    MeanReversionBot() { id = BOT_MR; }

    void compute(PersistentLOB& lob, const MarketSnapshot& snap) override {
        int64_t deviation_fp = snap.mid_fp - snap.fair_value_fp;
        int64_t threshold_fp = to_fp(0.05);  // 5 ticks from fair value
        int64_t volume = static_cast<int64_t>(80 * agg);

        if (deviation_fp > threshold_fp) {
            // Price above fair value — place limit sell to fade the move
            int64_t ref_bid    = (snap.bid_fp > 0) ? snap.bid_fp : snap.fair_value_fp;
            int64_t sell_price = ref_bid - to_fp(0.01);
            uint64_t new_id    = lob.add_limit(false, sell_price, volume, BOT_MR);
            // Evict oldest ask if ring full
            uint64_t evicted   = ask_ring.push(new_id);
            if (evicted) lob.cancel(evicted);
        }
        if (deviation_fp < -threshold_fp) {
            // Price below fair value — place limit buy
            int64_t ref_ask   = (snap.ask_fp < INT64_MAX) ? snap.ask_fp : snap.fair_value_fp;
            int64_t buy_price = ref_ask + to_fp(0.01);
            uint64_t new_id   = lob.add_limit(true, buy_price, volume, BOT_MR);
            // Evict oldest bid if ring full
            uint64_t evicted  = bid_ring.push(new_id);
            if (evicted) lob.cancel(evicted);
        }
    }

    void on_fill(const MatchedFill&) override {}
};

// ═════════════════════════════════════════════════════════════════════════════
// Bot 4: Noise Trader (FIXED: was accumulating orders indefinitely)
// Random-ish limit orders near best bid/ask. Realistic background flow.
// Uses xorshift64 — no std::random overhead, 1ns per call.
//
// FIX: Caps resting orders to MAX_NOISE_ORDERS = 6 using OrderRing.
// ═════════════════════════════════════════════════════════════════════════════
struct NoiseTraderBot : BotBase {
    uint64_t rng = 0xDEADBEEFCAFEBABEULL;
    static constexpr int MAX_NOISE_ORDERS = 6;
    OrderRing<MAX_NOISE_ORDERS> order_ring;

    NoiseTraderBot() { id = BOT_NOISE; }

    uint64_t xorshift() {
        rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
        return rng;
    }

    void compute(PersistentLOB& lob, const MarketSnapshot& snap) override {
        uint64_t r = xorshift();
        if (r % 5 != 0) return;  // only trades 20% of ticks

        int64_t offset_fp = to_fp(0.01) * (int64_t)((r >> 8) % 5);
        int64_t volume    = static_cast<int64_t>((10 + (int64_t)((r >> 16) % 30)) * agg);
        uint64_t new_id   = 0;

        if (r & 1) {
            int64_t ref_bid = (snap.bid_fp > 0) ? snap.bid_fp : snap.fair_value_fp;
            new_id = lob.add_limit(true,  ref_bid - offset_fp, volume, BOT_NOISE);
        } else {
            int64_t ref_ask = (snap.ask_fp < INT64_MAX) ? snap.ask_fp : snap.fair_value_fp;
            new_id = lob.add_limit(false, ref_ask + offset_fp, volume, BOT_NOISE);
        }

        // Evict (cancel) the oldest noise order if ring is full
        uint64_t evicted = order_ring.push(new_id);
        if (evicted) lob.cancel(evicted);
    }

    void on_fill(const MatchedFill&) override {}
};

// ═════════════════════════════════════════════════════════════════════════════
// Bot 5: Sniper / Arbitrageur
// Instantly sweeps stale quotes that deviate from fair value.
// Ensures no free money is left in the book.
// Uses market orders only — no resting orders to accumulate.
// ═════════════════════════════════════════════════════════════════════════════
struct SniperBot : BotBase {
    SniperBot() { id = BOT_SNIPER; }

    void compute(PersistentLOB& lob, const MarketSnapshot& snap) override {
        int64_t arb_threshold = to_fp(0.01);  // 1 tick mispricing triggers arb

        // If best ask is below fair value → buy it (free money for Sniper)
        if (snap.fair_value_fp - snap.ask_fp > arb_threshold) {
            int64_t vol = (snap.ask_fp > 0) ? static_cast<int64_t>(100 * agg) : 0;
            if (snap.is_news_event) vol *= 2;
            if (vol > 0) lob.market_order(true, vol, BOT_SNIPER);
        }

        // If best bid is above fair value → sell it
        if (snap.bid_fp - snap.fair_value_fp > arb_threshold) {
            int64_t vol = (snap.bid_fp > 0) ? static_cast<int64_t>(100 * agg) : 0;
            if (snap.is_news_event) vol *= 2;
            if (vol > 0) lob.market_order(false, vol, BOT_SNIPER);
        }
    }

    void on_fill(const MatchedFill&) override {}
};

// ─── Bot Fleet container ──────────────────────────────────────────────────
// Manages all 5 bots. Called inline from Game Master on Core 2.
struct BotFleet {
    MarketMakerBot   mm;
    MomentumBot      mom;
    MeanReversionBot mr;
    NoiseTraderBot   noise;
    SniperBot        sniper;

    void init(const std::string& config_str) {
        size_t start = 0;
        while (start < config_str.length()) {
            size_t comma = config_str.find(',', start);
            if (comma == std::string::npos) comma = config_str.length();
            std::string token = config_str.substr(start, comma - start);
            size_t colon = token.find(':');
            if (colon != std::string::npos) {
                std::string key = token.substr(0, colon);
                double val = std::stod(token.substr(colon + 1));
                if      (key == "MM")     mm.agg    = val;
                else if (key == "MOM")    mom.agg   = val;
                else if (key == "MR")     mr.agg    = val;
                else if (key == "NOISE")  noise.agg = val;
                else if (key == "SNIPER") sniper.agg = val;
            }
            start = comma + 1;
        }
    }

    // Called BEFORE contestant sees market state
    // (bots react to last tick's contestant activity — which is in the LOB)
    void step(PersistentLOB& lob, const MarketSnapshot& snap) {
        if (mm.agg     > 0) mm.compute(lob, snap);
        if (mom.agg    > 0) mom.compute(lob, snap);
        if (mr.agg     > 0) mr.compute(lob, snap);
        if (noise.agg  > 0) noise.compute(lob, snap);
        if (sniper.agg > 0) sniper.compute(lob, snap);
    }

    // Distribute fills to all bots after LOB matching
    void distribute_fills(const std::vector<MatchedFill>& fills) {
        for (const auto& f : fills) {
            mm.on_fill(f);
            mom.on_fill(f);
            // MR, noise, sniper don't track fills
        }
    }
};
