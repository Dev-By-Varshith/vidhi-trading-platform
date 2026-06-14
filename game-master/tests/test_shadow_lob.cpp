// game-master/tests/test_shadow_lob.cpp
// Unit tests for shadow_lob.hpp correctness engine
// Tests: FIFO violations, double-fill detection, cancel tracking, cash integrity,
//        correctness_score accumulation.
//
// Run with: cmake --build build_tests && ./build_tests/test_shadow

#define CATCH_CONFIG_MAIN
#include "catch2/catch.hpp"
#include "../persistent_lob.hpp"
#include "../shadow_lob.hpp"

// ─── Helpers ──────────────────────────────────────────────────────────────────


static MatchedFill make_fill(bool taker_buy, int32_t taker_p, int32_t maker_p,
                              int64_t price_fp, int64_t vol, uint64_t maker_order_id) {
    MatchedFill f{};
    f.taker_is_buy       = taker_buy;
    f.taker_participant  = taker_p;
    f.maker_participant  = maker_p;
    f.price_fp           = price_fp;
    f.volume             = vol;
    f.contestant_is_taker = (taker_p == CONTESTANT);
    f.contestant_is_maker = (maker_p == CONTESTANT);
    return f;
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Basic state after init
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("ShadowLOB initializes clean", "[shadow][init]") {
    ShadowLOB s;

    REQUIRE(s.contestant_fills_ == 0);
    REQUIRE(s.violations_.empty());
    REQUIRE(s.shadow_best_bid_ == 0);
    REQUIRE(s.shadow_best_ask_ == INT64_MAX);
    REQUIRE(s.correctness_score() == Approx(1.0));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: on_limit_add updates shadow book state
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("on_limit_add tracks bid levels correctly", "[shadow][limit_add]") {
    ShadowLOB s;

    uint64_t id1 = 101;
    s.on_limit_add(true, to_fp(100.0), 50, CONTESTANT, id1, 0);

    REQUIRE(s.shadow_best_bid_ == to_fp(100.0));
    REQUIRE(s.orders_.count(id1) == 1);
    REQUIRE(s.orders_.at(id1).remaining_volume == 50);
}

TEST_CASE("on_limit_add tracks ask levels correctly", "[shadow][limit_add]") {
    ShadowLOB s;

    uint64_t id1 = 201;
    s.on_limit_add(false, to_fp(101.0), 30, BOT_MM, id1, 0);

    REQUIRE(s.shadow_best_ask_ == to_fp(101.0));
    REQUIRE(s.orders_.count(id1) == 1);
}

TEST_CASE("multiple bid levels update shadow_best_bid to highest", "[shadow][limit_add]") {
    ShadowLOB s;

    s.on_limit_add(true, to_fp(99.0),  10, BOT_MM, 1, 0);
    s.on_limit_add(true, to_fp(101.0), 10, BOT_MR, 2, 0);
    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 3, 0);

    REQUIRE(s.shadow_best_bid_ == to_fp(101.0));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: on_fill — correct FIFO fills don't trigger violations
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("on_fill correct FIFO fill: no violation", "[shadow][fill][fifo]") {
    ShadowLOB s;

    // id1 placed first (lower sequence)
    s.on_limit_add(true, to_fp(100.0), 20, CONTESTANT, 1001, 0);  // tick 0
    s.on_limit_add(true, to_fp(100.0), 10, BOT_MM,    1002, 1);   // tick 1

    // Fill id1 first — FIFO correct
    auto f = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 10, 1001);
    s.on_fill(f, 1001, 2);

    REQUIRE(s.violations_.empty());
    REQUIRE(s.contestant_fills_ == 1);
    REQUIRE(s.correctness_score() == Approx(1.0));
}

TEST_CASE("on_fill FIFO violation: older order skipped", "[shadow][fill][fifo_violation]") {
    ShadowLOB s;

    // Place id1 first, id2 second — both at same price
    s.on_limit_add(true, to_fp(100.0), 20, CONTESTANT, 1001, 0);  // tick 0
    s.on_limit_add(true, to_fp(100.0), 10, BOT_MM,    1002, 1);   // tick 1

    // Fill id2 BEFORE id1 — FIFO violation!
    auto f = make_fill(false, BOT_SNIPER, BOT_MM, to_fp(100.0), 10, 1002);
    s.on_fill(f, 1002, 2);

    // Should have at least one FIFO violation
    bool found_fifo = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::FIFO_PRIORITY_BREACH) { found_fifo = true; break; }
    }
    REQUIRE(found_fifo);
    REQUIRE(s.correctness_score() < 1.0);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Double-fill detection
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("on_fill double-fill detection: fill more than remaining volume", "[shadow][fill][double]") {
    ShadowLOB s;

    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 2001, 0);

    // First fill: 10 volume (complete fill)
    auto f1 = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 10, 2001);
    s.on_fill(f1, 2001, 1);

    // Second fill: attempt to fill again from same order (volume 0 remaining)
    auto f2 = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 5, 2001);
    s.on_fill(f2, 2001, 2);

    bool found_double = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::DOUBLE_FILL) { found_double = true; break; }
    }
    REQUIRE(found_double);
}

TEST_CASE("on_fill partial fill then remaining fill: no double-fill", "[shadow][fill][partial]") {
    ShadowLOB s;

    s.on_limit_add(true, to_fp(100.0), 20, CONTESTANT, 3001, 0);

    // Partial fill: 10 of 20
    auto f1 = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 10, 3001);
    s.on_fill(f1, 3001, 1);

    REQUIRE(s.violations_.empty());
    REQUIRE(s.orders_.at(3001).remaining_volume == 10);

    // Remaining fill: 10 of 10
    auto f2 = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 10, 3001);
    s.on_fill(f2, 3001, 2);

    REQUIRE(s.violations_.empty());
    REQUIRE(s.orders_.count(3001) == 0);
    REQUIRE(s.contestant_fills_ == 2);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: on_cancel
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("on_cancel cancel_succeeded=true matches live LOB", "[shadow][cancel]") {
    ShadowLOB s;

    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 4001, 0);
    s.on_cancel(4001, true, 1);

    // Cancelled order should be marked is_cancelled
    REQUIRE(s.orders_.count(4001) == 0);
    REQUIRE(s.violations_.empty());
}

TEST_CASE("on_cancel cancel_succeeded=false when order doesn't exist in shadow", "[shadow][cancel]") {
    ShadowLOB s;

    // Cancel an unknown order — if live said it failed, shadow should agree
    s.on_cancel(9999, false, 1);

    // Shadow has no record of 9999 (never added) and live also failed — no violation
    REQUIRE(s.violations_.empty());
}

TEST_CASE("on_cancel mismatch: live says succeeded but order already filled", "[shadow][cancel][mismatch]") {
    ShadowLOB s;

    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 5001, 0);

    // Fully fill the order
    auto f = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(100.0), 10, 5001);
    s.on_fill(f, 5001, 1);

    // Now live reports cancel_succeeded=true on a fully-filled order — violation
    s.on_cancel(5001, true, 2);

    bool found_cancel = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::STALE_CANCEL) { found_cancel = true; break; }
    }
    REQUIRE(found_cancel);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Cash integrity via validate_contestant_state
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("validate_contestant_state: matching position+cash = no violation", "[shadow][cash]") {
    ShadowLOB s;

    // Shadow tracks no contestant activity — expect initial state
    // Live reports position=0, cash=to_fp(100000) → should match
    s.validate_contestant_state(0, to_fp(100'000.0), 999);

    REQUIRE(s.violations_.empty());
}

TEST_CASE("validate_contestant_state: cash mismatch triggers CASH_INTEGRITY_MISMATCH", "[shadow][cash][mismatch]") {
    ShadowLOB s;

    // Shadow expects initial cash = to_fp(100000)
    // Live incorrectly reports cash = to_fp(200000)
    s.validate_contestant_state(0, to_fp(200'000.0), 999);

    bool found_cash = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::CASH_INTEGRITY_MISMATCH) { found_cash = true; break; }
    }
    REQUIRE(found_cash);
}

TEST_CASE("validate_contestant_state: position mismatch triggers POSITION_MISMATCH", "[shadow][position][mismatch]") {
    ShadowLOB s;

    // Shadow has no contestant fills, so tracks position=0
    // Live incorrectly reports position=100
    s.validate_contestant_state(100, to_fp(100'000.0), 999);

    bool found_pos = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::POSITION_INTEGRITY_MISMATCH) { found_pos = true; break; }
    }
    REQUIRE(found_pos);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Correctness score accumulation
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("correctness_score starts at 1.0 and decreases with violations", "[shadow][score]") {
    ShadowLOB s;

    REQUIRE(s.correctness_score() == Approx(1.0));

    // Trigger a FIFO violation
    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 6001, 0);
    s.on_limit_add(true, to_fp(100.0), 10, BOT_MM, 6002, 1);

    auto f = make_fill(false, BOT_SNIPER, BOT_MM, to_fp(100.0), 5, 6002);
    s.on_fill(f, 6002, 2);

    double score = s.correctness_score();
    REQUIRE(score < 1.0);
    REQUIRE(score >= 0.0);
}

TEST_CASE("correctness_score never goes below 0.0", "[shadow][score][clamp]") {
    ShadowLOB s;

    // Trigger many violations
    for (int i = 0; i < 1000; ++i) {
        s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 7000+i, i);
        s.on_limit_add(true, to_fp(100.0), 10, BOT_MM, 8000+i, i+1);
        auto f = make_fill(false, BOT_SNIPER, BOT_MM, to_fp(100.0), 5, 8000+i);
        s.on_fill(f, 8000+i, i+2);
    }

    REQUIRE(s.correctness_score() >= 0.0);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Price-cross validation
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("on_fill fill above bid price triggers PRICE_CROSS violation", "[shadow][fill][price]") {
    ShadowLOB s;

    // Contestant posts a bid at 100.0
    s.on_limit_add(true, to_fp(100.0), 10, CONTESTANT, 9001, 0);

    // Fill at 98.0 — price below best bid is a violation for a sell taker
    auto f = make_fill(false, BOT_SNIPER, CONTESTANT, to_fp(98.0), 10, 9001);
    s.on_fill(f, 9001, 1);

    bool found_price = false;
    for (const auto& v : s.violations_) {
        if (v.type == ViolationType::FILL_PRICE_INVALID) { found_price = true; break; }
    }
    REQUIRE(found_price);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: emit_json doesn't crash
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("emit_json produces valid partial JSON for zero violations", "[shadow][emit]") {
    ShadowLOB s;

    std::ostringstream oss;
    s.emit_json(oss);

    std::string out = oss.str();
    REQUIRE(out.find("\"correctness\"") != std::string::npos);
    REQUIRE(out.find("\"violations\"") != std::string::npos);
    REQUIRE(out.find("\"correctness\":1") != std::string::npos);  // score = 1.0
}
