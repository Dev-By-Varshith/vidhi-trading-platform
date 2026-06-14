// game-master/pnl_tracker.hpp
#pragma once
#include <cstdint>
#include <algorithm>
#include "persistent_lob.hpp"

// Fixed-point safety wrapper to prevent adversarial overflow attacks
// Uses __int128 for internal cash balance tracking
//
// FIX #8: Position limit penalty is now charged ONCE per tick that the position
// first crosses the limit, not on every fill while over-limit.
// Call reset_tick_state() at the start of each tick in main.cpp.
class PnLTracker {
public:
    explicit PnLTracker(int64_t limit) : position_limit_(limit) {}

    // Must be called at the start of each tick (before processing any fills)
    void reset_tick_state() {
        penalty_charged_this_tick_ = false;
    }

    void apply_fill(const MatchedFill& f, bool contestant_is_taker) {
        int64_t sign = (contestant_is_taker ? f.taker_is_buy : !f.taker_is_buy) ? 1 : -1;
        position_ += sign * f.volume;
        cash_fp_  -= static_cast<__int128>(sign) * f.volume * f.price_fp;

        // FIX: Apply the 10% penalty only on the FIRST fill that crosses the limit
        // per tick. Subsequent fills while already over-limit do NOT add more penalties.
        // This matches the spec: "-10% PnL per violation" (one violation per tick).
        if (std::abs(position_) > position_limit_ && !penalty_charged_this_tick_) {
            cash_fp_ -= static_cast<__int128>(to_fp(100'000.0)) / 10;
            penalty_charged_this_tick_ = true;
        }
    }

    double pnl(int64_t last_price_fp) const {
        __int128 mark_to_market = cash_fp_ + static_cast<__int128>(position_) * last_price_fp;
        return static_cast<double>(mark_to_market) / FIXED_POINT - 100'000.0;
    }

    double pnl_pct(int64_t last_price_fp) const {
        return (pnl(last_price_fp) / 100'000.0) * 100.0;
    }

    int64_t position() const { return position_; }
    __int128 cash_fp() const { return cash_fp_; }

    // Safe int64 accessor for telemetry — clamped to avoid silent overflow
    // when cash is deeply negative (losses > $9.2 trillion in fixed-point)
    int64_t cash_fp_safe() const {
        static constexpr __int128 I64_MAX = static_cast<__int128>(INT64_MAX);
        static constexpr __int128 I64_MIN = static_cast<__int128>(INT64_MIN);
        if (cash_fp_ > I64_MAX) return INT64_MAX;
        if (cash_fp_ < I64_MIN) return INT64_MIN;
        return static_cast<int64_t>(cash_fp_);
    }

private:
    int64_t  position_              = 0;
    __int128 cash_fp_               = static_cast<__int128>(to_fp(100'000.0));
    int64_t  position_limit_        = 1000;
    bool     penalty_charged_this_tick_ = false;  // FIX #8: one penalty per tick
};
