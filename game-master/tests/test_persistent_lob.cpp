// game-master/tests/test_persistent_lob.cpp
// Rewritten for the pool-allocated flat LOB API (v5.0)
// Previous version used std::map-based API (lob.bids[price], lob.registry) — now gone.
// Run with: cmake --build build_tests && ./build_tests/test_lob

#define CATCH_CONFIG_MAIN
#include "catch2/catch.hpp"
#include "../persistent_lob.hpp"

// ─── Helper: init a fresh LOB with seed liquidity ─────────────────────────────
static PersistentLOB make_lob() {
    PersistentLOB lob;
    lob.init();
    return lob;
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Basic State After Init
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("LOB initializes to empty state", "[lob][init]") {
    auto lob = make_lob();

    REQUIRE(lob.best_bid() == 0);           // no bids → returns 0
    REQUIRE(lob.best_ask() == INT64_MAX);   // no asks → returns INT64_MAX
    REQUIRE(lob.bids.count == 0);
    REQUIRE(lob.asks.count == 0);
    REQUIRE(lob.pool.free_top == ORDER_POOL_SIZE); // all slots free
    REQUIRE(lob.last_trade_fp == 0);
    REQUIRE(lob.total_fills == 0);
    REQUIRE(lob.next_order_id == 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Limit Order Placement
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("add_limit creates price level and returns valid order ID", "[lob][add_limit]") {
    auto lob = make_lob();

    uint64_t id = lob.add_limit(true, to_fp(100.0), 50, CONTESTANT);
    REQUIRE(id != NULL_ORDER_ID);
    REQUIRE(lob.best_bid() == to_fp(100.0));
    REQUIRE(lob.bids.count == 1);
    REQUIRE(lob.bids.levels[0].total_volume == 50);
    REQUIRE(lob.bids.levels[0].count == 1);
}

TEST_CASE("add_limit on same price level accumulates volume (FIFO)", "[lob][add_limit][fifo]") {
    auto lob = make_lob();

    uint64_t id1 = lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    uint64_t id2 = lob.add_limit(true, to_fp(100.0), 20, BOT_MM);

    REQUIRE(id1 != id2);
    REQUIRE(lob.bids.count == 1);  // same price level
    REQUIRE(lob.bids.levels[0].total_volume == 30);
    REQUIRE(lob.bids.levels[0].count == 2);

    // FIFO: id1 is at head (placed first)
    uint32_t head_idx = lob.bids.levels[0].head;
    REQUIRE(lob.pool.get(head_idx).order_id == id1);
}

TEST_CASE("add_limit inserts multiple price levels in sorted order", "[lob][add_limit][sorted]") {
    auto lob = make_lob();

    lob.add_limit(true, to_fp(99.0),  10, CONTESTANT); // lower bid
    lob.add_limit(true, to_fp(101.0), 10, CONTESTANT); // highest bid
    lob.add_limit(true, to_fp(100.0), 10, CONTESTANT); // middle bid

    // Bids sorted descending: 101 > 100 > 99
    REQUIRE(lob.bids.count == 3);
    REQUIRE(lob.bids.levels[0].price_fp == to_fp(101.0));
    REQUIRE(lob.bids.levels[1].price_fp == to_fp(100.0));
    REQUIRE(lob.bids.levels[2].price_fp == to_fp(99.0));
    REQUIRE(lob.best_bid() == to_fp(101.0));
}

TEST_CASE("add_limit ask side sorted ascending", "[lob][add_limit][ask_sorted]") {
    auto lob = make_lob();

    lob.add_limit(false, to_fp(102.0), 5, BOT_MM);
    lob.add_limit(false, to_fp(100.5), 5, BOT_MM);
    lob.add_limit(false, to_fp(101.0), 5, BOT_MM);

    // Asks sorted ascending: 100.5 < 101 < 102
    REQUIRE(lob.asks.count == 3);
    REQUIRE(lob.asks.levels[0].price_fp == to_fp(100.5));
    REQUIRE(lob.asks.levels[1].price_fp == to_fp(101.0));
    REQUIRE(lob.asks.levels[2].price_fp == to_fp(102.0));
    REQUIRE(lob.best_ask() == to_fp(100.5));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Market Orders and FIFO Matching
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("market_order matches in FIFO order at same price level", "[lob][market][fifo]") {
    auto lob = make_lob();

    // Place two bid orders at same price — FIFO: id1 first
    uint64_t id1 = lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    uint64_t id2 = lob.add_limit(true, to_fp(100.0), 20, BOT_MM);

    // Market sell 15 — should fill id1 fully (10), then id2 partially (5)
    auto fills = lob.market_order(false, 15, BOT_SNIPER);

    REQUIRE(fills.size() == 2);

    // First fill: id1 (CONTESTANT), fully filled
    REQUIRE(fills[0].maker_order_id == id1);
    REQUIRE(fills[0].volume == 10);
    REQUIRE(fills[0].price_fp == to_fp(100.0));
    REQUIRE(fills[0].maker_participant == CONTESTANT);
    REQUIRE(fills[0].taker_participant == BOT_SNIPER);
    REQUIRE(fills[0].taker_is_buy == false);

    // Second fill: id2 (BOT_MM), partial
    REQUIRE(fills[1].maker_order_id == id2);
    REQUIRE(fills[1].volume == 5);
    REQUIRE(fills[1].maker_participant == BOT_MM);

    // Remaining volume at 100.0 = 20 - 5 = 15
    REQUIRE(lob.bids.levels[0].total_volume == 15);
    REQUIRE(lob.bids.levels[0].count == 1);  // id1 fully consumed
}

TEST_CASE("market_order sweeps multiple price levels", "[lob][market][multilevel]") {
    auto lob = make_lob();

    lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    lob.add_limit(true, to_fp(99.0),  10, CONTESTANT);
    lob.add_limit(true, to_fp(98.0),  10, CONTESTANT);

    REQUIRE(lob.best_bid() == to_fp(100.0));

    // Market sell 25 — sweeps 100 (10), 99 (10), partial 98 (5)
    auto fills = lob.market_order(false, 25, BOT_MOM);

    REQUIRE(fills.size() == 3);
    REQUIRE(fills[0].price_fp == to_fp(100.0)); REQUIRE(fills[0].volume == 10);
    REQUIRE(fills[1].price_fp == to_fp(99.0));  REQUIRE(fills[1].volume == 10);
    REQUIRE(fills[2].price_fp == to_fp(98.0));  REQUIRE(fills[2].volume == 5);

    // New best bid: 98.0, remaining volume 5
    REQUIRE(lob.best_bid() == to_fp(98.0));
    REQUIRE(lob.bids.levels[0].total_volume == 5);
    REQUIRE(lob.last_trade_fp == to_fp(98.0));
    REQUIRE(lob.total_fills == 3);
}

TEST_CASE("market_order against empty LOB returns no fills", "[lob][market][empty]") {
    auto lob = make_lob();

    auto fills = lob.market_order(true, 100, CONTESTANT);
    REQUIRE(fills.empty());
    REQUIRE(lob.total_fills == 0);
}

TEST_CASE("market_order partial when insufficient liquidity", "[lob][market][partial_depth]") {
    auto lob = make_lob();

    // Only 30 volume available on ask side
    lob.add_limit(false, to_fp(101.0), 30, BOT_MM);

    // Request 100 — only 30 can fill
    auto fills = lob.market_order(true, 100, CONTESTANT);

    REQUIRE(fills.size() == 1);
    REQUIRE(fills[0].volume == 30);
    REQUIRE(lob.asks.count == 0);  // ask level exhausted
    REQUIRE(lob.best_ask() == INT64_MAX);
}

TEST_CASE("market_buy contestant_is_taker flag set correctly", "[lob][market][flags]") {
    auto lob = make_lob();

    lob.add_limit(false, to_fp(101.0), 10, BOT_MM);
    auto fills = lob.market_order(true, 10, CONTESTANT);

    REQUIRE(fills.size() == 1);
    REQUIRE(fills[0].contestant_is_taker == true);
    REQUIRE(fills[0].contestant_is_maker == false);
    REQUIRE(fills[0].taker_is_buy == true);
}

TEST_CASE("contestant resting limit filled by bot market — contestant_is_maker", "[lob][market][maker_flag]") {
    auto lob = make_lob();

    lob.add_limit(true, to_fp(100.0), 20, CONTESTANT);
    auto fills = lob.market_order(false, 20, BOT_SNIPER);

    REQUIRE(fills.size() == 1);
    REQUIRE(fills[0].contestant_is_maker == true);
    REQUIRE(fills[0].contestant_is_taker == false);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Order Cancellation
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("cancel removes order, cleans up price level", "[lob][cancel]") {
    auto lob = make_lob();

    uint64_t id = lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    REQUIRE(lob.bids.count == 1);
    REQUIRE(lob.pool.free_top == ORDER_POOL_SIZE - 1);  // 1 allocated

    bool ok = lob.cancel(id);
    REQUIRE(ok == true);

    // Level removed (no orders remaining)
    REQUIRE(lob.bids.count == 0);
    REQUIRE(lob.best_bid() == 0);

    // Pool slot returned
    REQUIRE(lob.pool.free_top == ORDER_POOL_SIZE);

    // Order map cleared
    REQUIRE(lob.map_lookup(id) == NULL_IDX);
}

TEST_CASE("cancel middle order in FIFO queue preserves order", "[lob][cancel][fifo_preserve]") {
    auto lob = make_lob();

    uint64_t id1 = lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    uint64_t id2 = lob.add_limit(true, to_fp(100.0), 15, BOT_MM);
    uint64_t id3 = lob.add_limit(true, to_fp(100.0), 20, BOT_MR);

    // Cancel middle order id2
    REQUIRE(lob.cancel(id2) == true);

    REQUIRE(lob.bids.levels[0].count == 2);
    REQUIRE(lob.bids.levels[0].total_volume == 30);  // 10 + 20

    // FIFO: id1 still at head, id3 at tail
    uint32_t head_idx = lob.bids.levels[0].head;
    REQUIRE(lob.pool.get(head_idx).order_id == id1);
    uint32_t tail_idx = lob.bids.levels[0].tail;
    REQUIRE(lob.pool.get(tail_idx).order_id == id3);
}

TEST_CASE("double cancel returns false", "[lob][cancel][double]") {
    auto lob = make_lob();

    uint64_t id = lob.add_limit(true, to_fp(100.0), 10, CONTESTANT);
    REQUIRE(lob.cancel(id) == true);
    REQUIRE(lob.cancel(id) == false);  // already gone
}

TEST_CASE("cancel non-existent order ID returns false", "[lob][cancel][invalid]") {
    auto lob = make_lob();
    REQUIRE(lob.cancel(999999) == false);
    REQUIRE(lob.cancel(NULL_ORDER_ID) == false);
}

TEST_CASE("cancel partially-filled order removes remaining volume", "[lob][cancel][partial_fill]") {
    auto lob = make_lob();

    uint64_t id1 = lob.add_limit(true, to_fp(100.0), 20, CONTESTANT);
    uint64_t id2 = lob.add_limit(true, to_fp(100.0), 10, BOT_MM);

    // Partially fill id1 (take 5 out of 20)
    auto fills = lob.market_order(false, 5, BOT_SNIPER);
    REQUIRE(fills.size() == 1);
    REQUIRE(fills[0].volume == 5);

    // id1 still resting with 15 volume
    REQUIRE(lob.bids.levels[0].total_volume == 25);

    // Cancel remaining id1
    REQUIRE(lob.cancel(id1) == true);
    REQUIRE(lob.bids.levels[0].total_volume == 10);  // only id2 remains
    REQUIRE(lob.bids.levels[0].count == 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Pool Exhaustion
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("pool exhaustion returns NULL_ORDER_ID gracefully", "[lob][pool]") {
    auto lob = make_lob();

    int placed = 0;
    for (int i = 0; i < ORDER_POOL_SIZE + 10; ++i) {
        // Use different prices to avoid the same-level merge affecting pool, but limit to 200 levels
        int64_t price = to_fp(100.0) + (i % 200) * FIXED_POINT;  // 100.000001 increments
        uint64_t id = lob.add_limit(true, price, 1, CONTESTANT);
        if (id == NULL_ORDER_ID) break;
        placed++;
    }

    // Should have placed exactly ORDER_POOL_SIZE orders before pool ran out
    REQUIRE(placed == ORDER_POOL_SIZE);
    REQUIRE(lob.pool.free_top == 0);

    // After pool exhaustion, next add_limit returns NULL gracefully (no crash)
    uint64_t bad = lob.add_limit(true, to_fp(50.0), 1, CONTESTANT);
    REQUIRE(bad == NULL_ORDER_ID);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: mid(), spread(), fill_snapshot()
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("mid() and spread() computed correctly", "[lob][mid]") {
    auto lob = make_lob();

    lob.add_limit(true,  to_fp(99.0),  10, BOT_MM);
    lob.add_limit(false, to_fp(101.0), 10, BOT_MM);

    REQUIRE(lob.best_bid() == to_fp(99.0));
    REQUIRE(lob.best_ask() == to_fp(101.0));
    REQUIRE(lob.mid() == to_fp(100.0));
    REQUIRE(lob.spread() == to_fp(2.0));
}

TEST_CASE("fill_snapshot writes depth to SharedMem", "[lob][snapshot]") {
    auto lob = make_lob();

    // 3 bid levels, 2 ask levels
    lob.add_limit(true,  to_fp(100.0), 50, BOT_MM);
    lob.add_limit(true,  to_fp(99.5),  30, BOT_MR);
    lob.add_limit(true,  to_fp(99.0),  20, BOT_NOISE);
    lob.add_limit(false, to_fp(100.5), 40, BOT_MM);
    lob.add_limit(false, to_fp(101.0), 60, BOT_MR);

    SharedMem sm{};
    lob.fill_snapshot(&sm);

    REQUIRE(sm.bid_price_fp == to_fp(100.0));
    REQUIRE(sm.ask_price_fp == to_fp(100.5));
    REQUIRE(sm.bid_depth[0].volume == 50);
    REQUIRE(sm.bid_depth[1].volume == 30);
    REQUIRE(sm.bid_depth[2].volume == 20);
    REQUIRE(sm.bid_depth[3].volume == 0);  // only 3 bid levels
    REQUIRE(sm.ask_depth[0].volume == 40);
    REQUIRE(sm.ask_depth[1].volume == 60);
    REQUIRE(sm.ask_depth[2].volume == 0);
    REQUIRE(sm.spread_fp == to_fp(0.5));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: write_fills_to_shm
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("write_fills_to_shm only writes contestant fills", "[lob][fills]") {
    auto lob = make_lob();

    lob.add_limit(false, to_fp(101.0), 10, BOT_MM);  // ask
    lob.add_limit(false, to_fp(102.0), 10, BOT_MR);  // ask

    // Contestant buys 10 at market — hits BOT_MM ask
    auto fills = lob.market_order(true, 10, CONTESTANT);
    REQUIRE(fills.size() == 1);
    REQUIRE(fills[0].contestant_is_taker == true);

    // Non-contestant fill (bot vs bot scenario)
    MatchedFill bot_fill{};
    bot_fill.contestant_is_taker = false;
    bot_fill.contestant_is_maker = false;
    bot_fill.price_fp = to_fp(102.0);
    bot_fill.volume   = 5;
    bot_fill.taker_is_buy = true;

    std::vector<MatchedFill> all_fills = fills;
    all_fills.push_back(bot_fill);

    SharedMem sm{};
    lob.write_fills_to_shm(all_fills, &sm);

    // Only the contestant fill should be written
    REQUIRE(sm.fill_count == 1);
    REQUIRE(sm.fills[0] == 0);              // order_id
    REQUIRE(sm.fills[1] == to_fp(101.0));   // price_fp
    REQUIRE(sm.fills[2] == 10);              // volume
    REQUIRE(sm.fills[3] == 0);              // taker_is_buy == true, so side is 0
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: OrderPool alloc/free
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("OrderPool alloc and free are O(1) stack operations", "[pool]") {
    OrderPool pool;
    pool.init();

    REQUIRE(pool.free_top == ORDER_POOL_SIZE);

    uint32_t idx1 = pool.alloc();
    REQUIRE(idx1 != NULL_IDX);
    REQUIRE(pool.free_top == ORDER_POOL_SIZE - 1);

    uint32_t idx2 = pool.alloc();
    REQUIRE(idx2 != idx1);
    REQUIRE(pool.free_top == ORDER_POOL_SIZE - 2);

    pool.release(idx1);
    REQUIRE(pool.free_top == ORDER_POOL_SIZE - 1);
    // Next alloc should return idx1 (LIFO stack)
    uint32_t idx3 = pool.alloc();
    REQUIRE(idx3 == idx1);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Regression — bot order ring interaction
// ══════════════════════════════════════════════════════════════════════════════
TEST_CASE("rapid add+cancel cycle does not leak pool slots", "[lob][stress]") {
    auto lob = make_lob();

    // Simulate Market Maker posting and cancelling quotes 1000 times
    uint64_t bid_id = 0, ask_id = 0;
    for (int i = 0; i < 1000; ++i) {
        if (bid_id) lob.cancel(bid_id);
        if (ask_id) lob.cancel(ask_id);
        bid_id = lob.add_limit(true,  to_fp(99.0),  50, BOT_MM);
        ask_id = lob.add_limit(false, to_fp(101.0), 50, BOT_MM);
    }

    // After 1000 cycles: only 2 orders resting (the last bid + ask)
    // Pool should have returned all others → free_top = ORDER_POOL_SIZE - 2
    REQUIRE(lob.bids.count == 1);
    REQUIRE(lob.asks.count == 1);
    REQUIRE(lob.pool.free_top == ORDER_POOL_SIZE - 2);
}
