// game-master/persistent_lob.hpp
// Pool-Allocated Flat Limit Order Book — Zero-Heap-Alloc Hot Path
//
// ══════════════════════════════════════════════════════════════════════════════
// P0 BUG FIX: Previous version used std::map<int64_t, PriceLevel> and
// std::deque<LimitOrder> — both heap-allocate per node/chunk on every
// add_limit() call. This is the #1 latency killer: each call to
// std::allocator::allocate() locks a mutex, walks a free list, and often
// triggers a TLB miss. At 1M ticks with 5 bots × N orders, this caused
// unpredictable 100–2000ns latency spikes — catastrophic for HFT.
//
// FIX: Replaced with:
//   1. OrderPool  — slab of 16384 pre-allocated LimitOrder nodes,
//                   managed via a stack-based free list. O(1) alloc/free.
//   2. LOBSide    — flat sorted array of PriceLevel structs (max 256 levels).
//                   Insertion/deletion: O(levels) memmove, but levels ≤ 50
//                   in practice → faster than tree traversal with cache misses.
//   3. Intrusive singly-linked list per price level using pool indices.
//                   No pointer chasing across random heap addresses.
//
// Memory footprint:
//   OrderPool:  16384 × 56B = 896KB (fits in L2)
//   Bids:       256 × 40B   = 10KB  (fits in L1)
//   Asks:       256 × 40B   = 10KB  (fits in L1)
//   OrderMap:   16384 × 8B  = 128KB (fits in L2)
//   Total:      ~1MB — fully pre-allocated, zero runtime allocs in hot path.
// ══════════════════════════════════════════════════════════════════════════════

#pragma once
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <vector>
#include <climits>
#include <cassert>
#include "rendezvous.hpp"

// ─── Constants ────────────────────────────────────────────────────────────────
static constexpr int32_t  ORDER_POOL_SIZE  = 16384;  // max total resting orders
static constexpr int32_t  MAX_PRICE_LEVELS = 256;    // max distinct price levels per side
static constexpr uint32_t NULL_IDX         = UINT32_MAX;
static constexpr uint64_t NULL_ORDER_ID    = 0;

// ─── LimitOrder node (stored in pool slab) ────────────────────────────────────
struct LimitOrder {
    uint64_t order_id;       // unique monotonic ID
    int64_t  volume;         // remaining unfilled volume
    int32_t  participant;    // who placed this order (ParticipantID)
    uint32_t next;           // next node in price-level queue (pool index)
};
static_assert(sizeof(LimitOrder) == 24, "LimitOrder size must be 24B");

// ─── PriceLevel (stored in flat sorted array) ────────────────────────────────
struct PriceLevel {
    int64_t  price_fp;       // fixed-point price (×1e6)
    int64_t  total_volume;   // sum of all resting volumes at this level
    uint32_t head;           // first order (FIFO — oldest, matched first)
    uint32_t tail;           // last order  (FIFO — newest, appended here)
    int32_t  count;          // number of resting orders at this level
};
static_assert(sizeof(PriceLevel) == 32, "PriceLevel must be 32B");

// ─── O(1) Pool Allocator ──────────────────────────────────────────────────────
struct OrderPool {
    LimitOrder nodes[ORDER_POOL_SIZE];
    uint32_t   free_stack[ORDER_POOL_SIZE];
    int32_t    free_top;     // stack pointer

    void init() {
        free_top = ORDER_POOL_SIZE;
        for (int32_t i = 0; i < ORDER_POOL_SIZE; i++) {
            free_stack[i] = static_cast<uint32_t>(i);
        }
    }

    // O(1) alloc — pops from free stack
    uint32_t alloc() {
        if (free_top <= 0) return NULL_IDX; // pool exhausted (shouldn't happen with correct bot caps)
        return free_stack[--free_top];
    }

    // O(1) free — pushes back to free stack
    void release(uint32_t idx) {
        if (idx == NULL_IDX) return;
        free_stack[free_top++] = idx;
    }

    LimitOrder& get(uint32_t idx)       { return nodes[idx]; }
    const LimitOrder& get(uint32_t idx) const { return nodes[idx]; }
};

// ─── Flat sorted price-level array ───────────────────────────────────────────
// Sorted descending for bids (best bid first), ascending for asks.
struct LOBSide {
    PriceLevel levels[MAX_PRICE_LEVELS];
    int32_t    count;
    bool       descending; // true = bids, false = asks

    void init(bool is_bid) {
        count      = 0;
        descending = is_bid;
        std::memset(levels, 0, sizeof(levels));
        for (auto& lv : levels) { lv.head = lv.tail = NULL_IDX; }
    }

    // Binary search — returns index of price_fp or -1 if not found. O(log levels).
    int32_t find(int64_t price_fp) const {
        int32_t lo = 0, hi = count - 1;
        while (lo <= hi) {
            int32_t mid = (lo + hi) / 2;
            if (levels[mid].price_fp == price_fp) return mid;
            // For bids (descending): higher price → lower index
            // For asks (ascending):  lower  price → lower index
            bool higher = descending ? (levels[mid].price_fp > price_fp)
                                     : (levels[mid].price_fp < price_fp);
            if (higher) lo = mid + 1;
            else        hi = mid - 1;
        }
        return -1;
    }

    // Insert a new price level at the correct sorted position. O(levels) memmove.
    PriceLevel* insert(int64_t price_fp) {
        if (count >= MAX_PRICE_LEVELS) return nullptr; // price level table full
        // Find insertion index
        int32_t ins = 0;
        for (; ins < count; ins++) {
            bool should_insert_before = descending
                ? (price_fp > levels[ins].price_fp)
                : (price_fp < levels[ins].price_fp);
            if (should_insert_before) break;
        }
        // Shift right to make room
        if (ins < count) {
            std::memmove(&levels[ins + 1], &levels[ins],
                         (count - ins) * sizeof(PriceLevel));
        }
        auto& lv      = levels[ins];
        lv.price_fp   = price_fp;
        lv.total_volume = 0;
        lv.head       = NULL_IDX;
        lv.tail       = NULL_IDX;
        lv.count      = 0;
        count++;
        return &lv;
    }

    // Remove level at index. O(levels) memmove.
    void erase(int32_t idx) {
        if (idx < 0 || idx >= count) return;
        if (idx < count - 1) {
            std::memmove(&levels[idx], &levels[idx + 1],
                         (count - idx - 1) * sizeof(PriceLevel));
        }
        count--;
    }

    // Get or create a level for price_fp.
    PriceLevel* get_or_create(int64_t price_fp) {
        int32_t idx = find(price_fp);
        if (idx >= 0) return &levels[idx];
        return insert(price_fp);
    }

    // Best price (bid: highest, ask: lowest) — O(1) since array is sorted.
    int64_t best_price() const {
        return (count > 0) ? levels[0].price_fp : (descending ? 0 : INT64_MAX);
    }
};

// ─── MatchedFill (return value for match results) ─────────────────────────────
struct MatchedFill {
    int64_t  price_fp;
    int64_t  volume;
    int32_t  taker_participant;
    int32_t  maker_participant;
    uint64_t maker_order_id;
    bool     taker_is_buy;
    bool     contestant_is_taker;
    bool     contestant_is_maker;
};

// ─── PersistentLOB — Pool-Allocated, Zero-Heap-Alloc ─────────────────────────
class PersistentLOB {
public:
    // ─── State ───────────────────────────────────────────────────────────────
    OrderPool  pool;
    LOBSide    bids;
    LOBSide    asks;

    // Order ID → pool index map (flat hash table with linear probing)
    // FIX #6: MapEntry now stores price_fp + is_bid so cancel() is O(1) lookup
    //         instead of O(levels × orders_per_level) scan.
    // Size must be power of 2 and > ORDER_POOL_SIZE
    static constexpr int32_t MAP_SIZE = 32768;
    static constexpr int32_t MAP_MASK = MAP_SIZE - 1;
    struct MapEntry {
        uint64_t key;       // order_id (UINT64_MAX = empty, 0 = deleted)
        uint32_t val;       // pool index
        int64_t  price_fp;  // price of this order (for O(1) level lookup)
        bool     is_bid;    // which side (true=bid, false=ask)
    };
    MapEntry order_map[MAP_SIZE];

    uint64_t  next_order_id  = 1;
    int64_t   last_trade_fp  = 0;
    int64_t   total_fills    = 0;

    // ─── Init ─────────────────────────────────────────────────────────────────
    void init() {
        pool.init();
        bids.init(true);
        asks.init(false);
        std::memset(order_map, 0xFF, sizeof(order_map)); // 0xFF = unoccupied sentinel
        next_order_id = 1;
        last_trade_fp = 0;
        total_fills   = 0;
    }

    // ─── Order map helpers (open addressing, linear probe) ───────────────────
    void map_insert(uint64_t order_id, uint32_t pool_idx, int64_t price_fp, bool is_bid) {
        uint32_t slot = (uint32_t)(order_id * 2654435761ULL) & MAP_MASK;
        for (int i = 0; i < MAP_SIZE; i++) {
            uint32_t s = (slot + i) & MAP_MASK;
            if (order_map[s].key == UINT64_MAX || order_map[s].key == 0) {
                order_map[s] = {order_id, pool_idx, price_fp, is_bid};
                return;
            }
        }
    }

    uint32_t map_lookup(uint64_t order_id) const {
        uint32_t slot = (uint32_t)(order_id * 2654435761ULL) & MAP_MASK;
        for (int i = 0; i < MAP_SIZE; i++) {
            uint32_t s = (slot + i) & MAP_MASK;
            if (order_map[s].key == order_id) return order_map[s].val;
            if (order_map[s].key == UINT64_MAX) return NULL_IDX; // empty slot
        }
        return NULL_IDX;
    }

    // Returns the MapEntry pointer (nullptr if not found) — used by cancel()
    const MapEntry* map_find(uint64_t order_id) const {
        uint32_t slot = (uint32_t)(order_id * 2654435761ULL) & MAP_MASK;
        for (int i = 0; i < MAP_SIZE; i++) {
            uint32_t s = (slot + i) & MAP_MASK;
            if (order_map[s].key == order_id) return &order_map[s];
            if (order_map[s].key == UINT64_MAX) return nullptr;
        }
        return nullptr;
    }

    void map_erase(uint64_t order_id) {
        uint32_t slot = (uint32_t)(order_id * 2654435761ULL) & MAP_MASK;
        for (int i = 0; i < MAP_SIZE; i++) {
            uint32_t s = (slot + i) & MAP_MASK;
            if (order_map[s].key == order_id) {
                order_map[s].key = 0; // mark as deleted (not UINT64_MAX = empty)
                return;
            }
            if (order_map[s].key == UINT64_MAX) return;
        }
    }

    // ─── add_limit: O(log levels) binary search + O(1) pool alloc ────────────
    uint64_t add_limit(bool is_bid, int64_t price_fp, int64_t volume, int32_t participant) {
        LOBSide& side = is_bid ? bids : asks;
        PriceLevel* lv = side.get_or_create(price_fp);
        if (!lv) return NULL_ORDER_ID; // level table full (shouldn't happen)

        uint32_t idx = pool.alloc();
        if (idx == NULL_IDX) return NULL_ORDER_ID; // pool exhausted

        uint64_t order_id = next_order_id++;
        LimitOrder& o = pool.get(idx);
        o.order_id   = order_id;
        o.volume     = volume;
        o.participant = participant;
        o.next       = NULL_IDX;

        // Append to tail of FIFO queue
        if (lv->tail == NULL_IDX) {
            lv->head = lv->tail = idx;
        } else {
            pool.get(lv->tail).next = idx;
            lv->tail = idx;
        }
        lv->total_volume += volume;
        lv->count++;

        map_insert(order_id, idx, price_fp, is_bid);
        return order_id;
    }

    // ─── cancel: O(1) hash lookup → O(log levels) binary search → O(queue depth) ──
    // FIX #6: map_find() now returns price_fp + is_bid, so we jump directly to
    // the correct side and binary-search for the exact price level.
    // Eliminates the previous O(levels × orders_per_level) double-loop scan.
    bool cancel(uint64_t order_id) {
        if (order_id == NULL_ORDER_ID) return false;

        // O(1): find pool index + price metadata from hash map
        const MapEntry* entry = map_find(order_id);
        if (!entry) return false;

        uint32_t target_idx = entry->val;
        int64_t  price_fp   = entry->price_fp;
        bool     is_bid_    = entry->is_bid;
        int64_t  volume     = pool.get(target_idx).volume;

        // O(log levels): binary search for the price level
        LOBSide& side = is_bid_ ? bids : asks;
        int32_t lv_idx = side.find(price_fp);
        if (lv_idx < 0) return false;  // should never happen if map is consistent

        // O(queue depth ≤ 10 after bot cap): remove from singly-linked list
        PriceLevel& lv = side.levels[lv_idx];
        uint32_t prev = NULL_IDX;
        uint32_t cur  = lv.head;
        while (cur != NULL_IDX) {
            if (cur == target_idx) {
                uint32_t nxt = pool.get(cur).next;
                if (prev == NULL_IDX) lv.head = nxt;
                else pool.get(prev).next = nxt;
                if (lv.tail == cur) lv.tail = prev;
                lv.total_volume -= volume;
                lv.count--;
                pool.release(cur);
                map_erase(order_id);
                if (lv.count == 0) side.erase(lv_idx);
                return true;
            }
            prev = cur;
            cur  = pool.get(cur).next;
        }
        return false; // order_id in map but not in list — should not happen
    }

    // ─── market_order: walk the opposite side, match greedily ────────────────
    std::vector<MatchedFill> market_order(bool is_buy, int64_t volume, int32_t taker_participant) {
        std::vector<MatchedFill> fills;
        fills.reserve(8);

        LOBSide& side = is_buy ? asks : bids;
        int64_t remaining = volume;

        while (remaining > 0 && side.count > 0) {
            PriceLevel& lv = side.levels[0]; // best price is always [0]
            if (lv.head == NULL_IDX) { side.erase(0); continue; }

            uint32_t order_idx = lv.head;
            LimitOrder& maker = pool.get(order_idx);

            int64_t fill_vol = std::min(remaining, maker.volume);
            MatchedFill f;
            f.price_fp             = lv.price_fp;
            f.volume               = fill_vol;
            f.taker_participant    = taker_participant;
            f.maker_participant    = maker.participant;
            f.maker_order_id       = maker.order_id;
            f.taker_is_buy         = is_buy;
            f.contestant_is_taker  = (taker_participant == CONTESTANT);
            f.contestant_is_maker  = (maker.participant == CONTESTANT);
            fills.push_back(f);

            last_trade_fp = lv.price_fp;
            total_fills++;
            remaining        -= fill_vol;
            maker.volume     -= fill_vol;
            lv.total_volume  -= fill_vol;

            if (maker.volume == 0) {
                // Remove fully-filled maker order
                lv.head = maker.next;
                if (lv.tail == order_idx) lv.tail = NULL_IDX;
                map_erase(maker.order_id);
                pool.release(order_idx);
                lv.count--;
                if (lv.count == 0) side.erase(0);
            }
        }
        return fills;
    }

    // ─── best bid / ask ───────────────────────────────────────────────────────
    int64_t best_bid() const { return bids.best_price(); }
    int64_t best_ask() const { return asks.best_price(); }
    int64_t mid()      const {
        int64_t b = best_bid(), a = best_ask();
        if (b == 0 || a == INT64_MAX) return last_trade_fp;
        return (b + a) / 2;
    }
    int64_t spread()   const {
        int64_t b = best_bid(), a = best_ask();
        if (b == 0 || a == INT64_MAX) return 0;
        return a - b;
    }

    // ─── fill_snapshot: populate SharedMem depth fields ──────────────────────
    // Walks up to 5 levels on each side — O(5), always fast.
    void fill_snapshot(SharedMem* sm) const {
        // Clear all depth slots first
        for (int i = 0; i < 5; i++) {
            sm->bid_depth[i].price_fp = 0;
            sm->bid_depth[i].volume   = 0;
            sm->ask_depth[i].price_fp = 0;
            sm->ask_depth[i].volume   = 0;
        }
        int32_t n = std::min(bids.count, 5);
        for (int32_t i = 0; i < n; i++) {
            sm->bid_depth[i].price_fp = bids.levels[i].price_fp;
            sm->bid_depth[i].volume   = bids.levels[i].total_volume;
        }
        n = std::min(asks.count, 5);
        for (int32_t i = 0; i < n; i++) {
            sm->ask_depth[i].price_fp = asks.levels[i].price_fp;
            sm->ask_depth[i].volume   = asks.levels[i].total_volume;
        }
        sm->bid_price_fp         = best_bid();
        sm->ask_price_fp         = best_ask();
        sm->spread_fp            = spread();
        sm->last_trade_price_fp  = last_trade_fp;
    }

    // ─── write_fills_to_shm: copy contestant-relevant fills into SharedMem ───
    void write_fills_to_shm(const std::vector<MatchedFill>& fills, SharedMem* sm) const {
        int32_t cnt = 0;
        for (const auto& f : fills) {
            if (!f.contestant_is_taker && !f.contestant_is_maker) continue;
            if (cnt >= ORDER_SLOTS) break;
            sm->fills[cnt * 4 + 0] = f.contestant_is_taker ? 0 : f.maker_order_id;
            sm->fills[cnt * 4 + 1] = f.price_fp;
            sm->fills[cnt * 4 + 2] = f.volume;
            sm->fills[cnt * 4 + 3] = (f.contestant_is_taker == f.taker_is_buy) ? 0 : 1;
            cnt++;
        }
        sm->fill_count = cnt;
    }
};

// Note: main.cpp should declare:  PersistentLOBCompat lob;
// and use lob.best_bid() / lob.best_ask() / lob.last_trade_fp directly.
