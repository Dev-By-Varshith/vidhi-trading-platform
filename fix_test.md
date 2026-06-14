# Vidhi Platform — Fix Guide (All Audit Issues)

## 🔴 CRITICAL

| # | File | Fix |
|---|---|---|
| 1 | `tests/test_persistent_lob.cpp` | Rewrite all 4 test cases using current pool-LOB API (`lob.best_bid()`, `lob.asks.count`, `lob.cancel(id)`). Old `lob.bids[price]` map API is gone. |
| 2 | `simulation.worker.js` | Add `else if (order.type === 'cancel')` branch in the tick loop calling `lob.cancelOrder(...)`. |
| 3 | `simulation.worker.js` | Add `OrderRing` class (capacity 8/6) to `MeanReversionBot` and `NoiseTrader` JS classes; cancel evicted order before placing new one. |
| 4 | `simulation.worker.js` | In `PersistentLOB`, maintain `_bestBid` and `_bestAsk` as tracked fields instead of `Math.max(...keys())` — O(1) lookups. |
| 5 | `backend/main.go` | After the per-hash goroutine finishes, delete the entry from `hashLocks`. Use a deferred cleanup. |
| 6 | `persistent_lob.hpp` | Store `price_fp` and `is_bid` inside the `MapEntry` alongside `val` (pool index). Then `cancel()` can do O(1) level lookup via the map instead of scanning all levels. |

## 🟠 MEDIUM

| # | File | Fix |
|---|---|---|
| 7 | `main.cpp` | Change `ftruncate(shm_fd, 4096)` → `ftruncate(shm_fd, 2*1024*1024)` and `mmap(..., 2*1024*1024, ...)` with `MAP_HUGETLB` flag; add `MAP_HUGE_2MB` fallback. |
| 8 | `pnl_tracker.hpp` | Add `bool was_over_limit_` field; apply the 10% penalty only on the first fill that *crosses* the limit per tick, not every subsequent fill. Track with a `reset_tick_state()` call at start of each tick. |
| 9 | `main.cpp` | Add `watchdog_core` field to `Config` (default `telemetry_core + 1`, e.g. Core 5). Start `Watchdog` on `watchdog_core`, `TelemetryWatchdog` on `telemetry_core`. |
| 10 | `shadow_lob.hpp` + `telemetry.hpp` | Instead of GM calling `shadow_.validate_contestant_state()` directly, emit a `VALIDATE` telemetry event with position + cash; let Core 4 perform the validation from its own thread — no cross-core mutex. |
| 11 | `main.cpp` | Replace `static_cast<int64_t>(pnl.cash_fp())` with a checked clamp; or pass `__int128` via two `int64_t` fields in the telemetry event and reconstruct on Core 4. |
| 12 | `backend/forge/scanner.py` | Add `'type'` to `BANNED_BUILTINS`. Also add `'vars'` check for attribute access on `type` objects. |

## 🟡 LOW

| # | File | Fix |
|---|---|---|
| 13 | `bot_fleet.hpp` | Replace `virtual compute/on_fill` with CRTP (Curiously Recurring Template Pattern) or just direct struct calls in `BotFleet::step()` — no base class needed since `BotFleet` owns all 5 concrete types. |
| 14 | `tsc_calibrate.hpp` | Move `calibrate_tsc_ns()` call to *after* `pin_to_core()` in `main()`, or use a CPUID-serialized pair of `__rdtscp` instead of `sleep_for`. |
| 15 | `rendezvous.hpp` | Add `order_id` field to the fill notification encoding (currently uses 4-slot int64 tuple; change slot 3 to `order_id` and add a 5th slot for `side` — or repurpose the `_md_pad` region). |
