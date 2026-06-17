// game-master/main.cpp
// Vidhi Arena Game Master — Cloud Phase (Bare Metal EPYC, Core 2)
// Dynamic tick loop: GM + 5 Bots (inline) + Persistent LOB + Contestant Sandbox
//
// Build: cmake -DCMAKE_BUILD_TYPE=Release && make -j4
// Run:   ./vidhi-gm --so /tmp/vidhi/so/<hash>.so --ticks 1000000 --run-id <id>

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <atomic>
#include <csignal>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <chrono>
#include <vector>

// Linux/POSIX
#include <sys/mman.h>    // mmap, shm_open
#include <sys/stat.h>
#include <sched.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/wait.h>    // waitpid
#include <sched.h>       // sched_setaffinity
#include <sys/prctl.h>
#include <x86intrin.h>   // __rdtscp, _mm_pause, _mm_sfence, _mm_stream_si64

// NUMA policy binding (P2-1)
// numaif.h provides mbind() — part of libnuma on Linux.
// On systems without NUMA, mbind() is a no-op (returns ENOSYS gracefully).
#if __has_include(<numaif.h>)
#  include <numaif.h>
#  include <cerrno>
#  define HAVE_NUMA 1
#else
#  define HAVE_NUMA 0
#endif

// Project headers
#include "rendezvous.hpp"
#include "persistent_lob.hpp"
#include "bot_fleet.hpp"
#include "telemetry.hpp"
#include "tsc_calibrate.hpp"
#include "shadow_lob.hpp"


// ─── Config ───────────────────────────────────────────────────────────────
struct Config {
    std::string so_path;
    std::string run_id;
    int64_t     max_ticks      = 1'000'000;
    int64_t     sandbox_core   = 3;
    int64_t     gm_core        = 2;
    int64_t     telemetry_core = 4;  // TelemetryWatchdog (HDR histogram + shadow LOB)
    int64_t     watchdog_core  = 5;  // FIX #9: SIGKILL watchdog gets its own isolated core
    double      starting_cash  = 100'000.0;
    int64_t     position_limit = 1000;
    int64_t     tle_ns         = 100'000;   // 100µs TLE
    std::string dataset_path;               // path to private_999k.bin
    bool        external_sandbox = false;   // run sandbox externally (e.g. via Docker Warm Pool)
    std::string bot_config       = "MM:1.0,MOM:1.0,MR:1.0,NOISE:1.0,SNIPER:1.0"; // dynamic bot configuration
};

#include "price_signal.hpp"
#include "pnl_tracker.hpp"
#include "position_limits.hpp"

// ─── Pin current thread to a CPU core ─────────────────────────────────────
static void pin_to_core(int core) {
    cpu_set_t mask; CPU_ZERO(&mask); CPU_SET(core, &mask);
    if (sched_setaffinity(0, sizeof(mask), &mask) != 0) {
        std::cerr << "[WARN] Could not pin to core " << core << std::endl;
    }
}

// ─── P2-2: Check that isolcpus covers the HFT cores ─────────────────────────
// Reads /sys/devices/system/cpu/isolated and warns if cores 2/3/4 are absent.
// A missing isolcpus means the OS scheduler can preempt the Game Master mid-tick,
// causing false TLEs and elevated p99 latency.
static void check_isolcpus(const Config& cfg) {
    std::ifstream f("/sys/devices/system/cpu/isolated");
    if (!f.good()) {
        std::cerr << "[WARN][ISOLCPUS] Cannot read /sys/devices/system/cpu/isolated — "
                     "running in VM/container without CPU isolation support.\n";
        return;
    }
    std::string line;
    std::getline(f, line);  // e.g. "2-4" or "2,3,4"
    if (line.empty()) {
        std::cerr << "[WARN][ISOLCPUS] No cores isolated (isolcpus= not set in GRUB). "
                     "Game Master on core " << cfg.gm_core << " will share time with OS.\n"
                  << "[WARN][ISOLCPUS] Add: isolcpus=managed_irq,domain,"
                  << cfg.gm_core << "-" << cfg.telemetry_core
                  << " to your GRUB_CMDLINE_LINUX_DEFAULT and reboot.\n";
        return;
    }
    // Quick check: are gm_core, sandbox_core, telemetry_core mentioned?
    for (int core : {cfg.gm_core, cfg.sandbox_core, cfg.telemetry_core}) {
        // crude string search — good enough for a startup warning
        if (line.find(std::to_string(core)) == std::string::npos) {
            std::cerr << "[WARN][ISOLCPUS] Core " << core
                      << " is NOT listed in isolated list (\"" << line << "\"). "
                         "Expect latency jitter on this core.\n";
        }
    }
    std::cerr << "[GM] isolcpus check: " << line << " ✓\n";
}

// ─── Global: watchdog signals this to terminate on TLE ────────────────────
static std::atomic<bool> g_tle_flag{false};
static pid_t g_sandbox_pid = -1;

#include "watchdog.hpp"

// ─── Main tick loop ───────────────────────────────────────────────────────
int run_simulation(const Config& cfg) {

    // FIX #7: Use 2MB for hugepage backing (MAP_HUGETLB requires region ≥ 2MB).
    // The rendezvous struct is 1152B but we mmap 2MB so MADV_HUGEPAGE / MAP_HUGETLB can apply.
    static constexpr size_t SHM_SIZE = 2 * 1024 * 1024;  // 2MB
    std::string shm_name = "/tmp/vidhi_shm_" + cfg.run_id;
    int shm_fd = open(shm_name.c_str(), O_CREAT | O_RDWR, 0666);
    if (shm_fd == -1) { perror("open"); return 1; }
    if (ftruncate(shm_fd, SHM_SIZE) < 0) { perror("ftruncate"); return 1; }

    // Try MAP_HUGETLB (2MB hugepage); fall back to regular mmap on systems without it
    void* raw = mmap(nullptr, SHM_SIZE, PROT_READ | PROT_WRITE,
                     MAP_SHARED | MAP_HUGETLB, shm_fd, 0);
    if (raw == MAP_FAILED) {
        // Fallback: regular mmap without hugepage
        raw = mmap(nullptr, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, shm_fd, 0);
        if (raw == MAP_FAILED) { perror("mmap"); close(shm_fd); return 1; }
        std::cerr << "[GM] shm mmap: hugepage unavailable, using regular 4K pages\n";
    } else {
        std::cerr << "[GM] shm mmap: 2MB hugepage ✓\n";
    }
    close(shm_fd);

    // ── P2-1: NUMA binding — pin rendezvous page to NUMA node 0 ─────────
    // mbind() ensures that physical memory backing the shared page is allocated
    // on NUMA node 0 (where Core 2/3/4 live). Without this, the allocator may
    // place the page on a remote node, adding ~50ns QPI latency per tick.
#if HAVE_NUMA
    {
        unsigned long nodemask = 1UL;  // bit 0 = NUMA node 0
        int ret = mbind(raw, 4096,
                        MPOL_BIND,
                        &nodemask, /*maxnode=*/2, /*flags=*/0);
        if (ret != 0 && errno != ENOSYS) {
            std::cerr << "[WARN][NUMA] mbind() failed (errno=" << errno
                      << ") — shared memory may be on remote NUMA node.\n";
        } else if (ret == 0) {
            std::cerr << "[GM] NUMA mbind: rendezvous pinned to node 0 ✓\n";
        }
    }
#else
    std::cerr << "[GM] NUMA mbind: numaif.h not available — skipping (single-node or VM).\n";
#endif

    auto* sm  = new (raw) SharedMem{};

    // ── Spawn Contestant Sandbox (Child Process) ───────────────────────
    if (!cfg.so_path.empty() && !cfg.external_sandbox) {
        g_sandbox_pid = fork();
        if (g_sandbox_pid < 0) {
            perror("fork"); return 1;
        }
        if (g_sandbox_pid == 0) {
            // Child process: execute the vidhi-loader
            setenv("VIDHI_SO_PATH", cfg.so_path.c_str(), 1);
            setenv("VIDHI_RUN_ID", cfg.run_id.c_str(), 1);
            execl("./vidhi-loader", "vidhi-loader", nullptr);
            perror("execl");
            exit(1);
        }
        std::cerr << "[GM] Spawned sandbox process PID " << g_sandbox_pid << " for " << cfg.so_path << std::endl;
    } else {
        std::cerr << "[GM] No .so provided — running with null contestant (testing mode)" << std::endl;
    }

    // ── Init components ──────────────────────────────────────────────────
    PersistentLOB lob;  // pool-allocated flat LOB; init() called in constructor
    BotFleet            bots;
    bots.init(cfg.bot_config);
    TickDataset   sig;
    if (!cfg.dataset_path.empty()) {
        if (!sig.load(cfg.dataset_path)) {
            std::cerr << "[WARN] Failed to load dataset: " << cfg.dataset_path << ". Falling back to GBM.\n";
        }
    }
    PnLTracker        pnl(cfg.position_limit);
    TelemetryRing     telem;
    TelemetryWatchdog telem_watchdog{ telem };
    Watchdog          watchdog{ sm, cfg.tle_ns };
    // lob.telem is no longer needed: telemetry is recorded via telem.record_*() directly

    // TSC calibration
    double ns_per_tsc = calibrate_tsc_ns();
    std::cerr << "[GM] TSC calibrated: " << ns_per_tsc << " ns/tick" << std::endl;

    int64_t seed_bid = static_cast<int64_t>(100.00 * 1000000);
    int64_t seed_ask = static_cast<int64_t>(100.10 * 1000000);
    lob.add_limit(true,  seed_bid, 100, BOT_MM);
    lob.add_limit(false, seed_ask, 100, BOT_MM);

    uint64_t seq  = 1;
    int64_t  tle_count = 0;



    watchdog.start(cfg.watchdog_core);         // FIX #9: SIGKILL watchdog → Core 5
    telem_watchdog.start(cfg.telemetry_core);  // Telemetry + HDR histogram → Core 4

    // ════════════════════════════════════════════════════════════════════
    // MAIN TICK LOOP — 1,000,000 iterations
    // ════════════════════════════════════════════════════════════════════
    uint32_t tsc_aux;
    for (int64_t tick = 0; tick < cfg.max_ticks; ++tick) {

        uint64_t t0 = __rdtscp(&tsc_aux);

        // FIX #8: Reset per-tick state before processing any fills this tick
        pnl.reset_tick_state();

        // ── Step 1: Get price signal ───────────────────────────────────
        MarketSnapshot snap = sig.snapshot(tick, lob.best_bid(), lob.best_ask());

        // ── Step 2: All bots compute (inline, same core, ~10ns total) ──
        bots.step(lob, snap);

        // ── Step 3: Write market state to rendezvous struct ───────────
        lob.fill_snapshot(sm);
        sm->underlying_signal_fp = snap.fair_value_fp;
        sm->volatility_fp        = snap.volatility_fp;
        sm->contestant_position  = pnl.position();
        sm->contestant_pnl_fp    = to_fp(pnl.pnl(lob.last_trade_fp));  // ×1e6 fixed-point

        // ── Step 4: Signal contestant (release store) ──────────────────
        if (g_sandbox_pid > 0 || cfg.external_sandbox) {
            gm_signal(sm, seq);

            // ── Step 5: Wait for sandbox process response ─────────────────────
            if (!gm_wait_sandbox(sm, seq)) {
                tle_count++;
                std::cerr << "[GM] TLE at tick " << tick << std::endl;
                // TLE — treat as HOLD, continue
                sm->order_count = 0;
            }
        }

        // ── Step 6: Process contestant orders ─────────────────────────
        int64_t n_orders = std::min(sm->order_count, static_cast<int64_t>(ORDER_SLOTS));
        std::vector<MatchedFill> all_fills;

        for (int32_t i = 0; i < n_orders; ++i) {
            auto* o = &sm->orders[i * 4];
            int64_t type     = o[0];
            int64_t price_fp = o[1];
            int64_t volume   = o[2];
            int64_t order_id = o[3];
            
            switch (type) {
                case 1: { // LIMIT_BUY
                    lob.add_limit(true,  price_fp, volume, CONTESTANT);
                    break;
                }
                case 2: { // LIMIT_SELL
                    lob.add_limit(false, price_fp, volume, CONTESTANT);
                    break;
                }
                case 3: { // MARKET_BUY
                    auto f = lob.market_order(true,  volume, CONTESTANT);
                    all_fills.insert(all_fills.end(), f.begin(), f.end());
                    break;
                }
                case 4: { // MARKET_SELL
                    auto f = lob.market_order(false, volume, CONTESTANT);
                    all_fills.insert(all_fills.end(), f.begin(), f.end());
                    break;
                }
                case 5: { // CANCEL
                    lob.cancel(order_id);
                    break;
                }
                default: break;
            }
        }

        // ── Step 7: PnL update + fill notifications ────────────────────
        for (const auto& f : all_fills) {
            bool c_taker = (f.taker_participant == CONTESTANT);
            bool c_maker = (f.maker_participant == CONTESTANT);
            if (c_taker || c_maker) pnl.apply_fill(f, c_taker);
        }
        bots.distribute_fills(all_fills);

        // Write fills back to shm for next tick's contestant notification
        lob.write_fills_to_shm(all_fills, sm);

        // FIX #11: Use cash_fp_safe() to avoid silent __int128→int64 overflow
        if (tick % 1000 == 999) {
            telem_watchdog.shadow_.validate_contestant_state(
                pnl.position(),
                pnl.cash_fp_safe(),  // clamped, no overflow
                tick
            );
        }

        // ── Step 8: Telemetry ──────────────────────────────────────────
        uint64_t t1 = __rdtscp(&tsc_aux);
        int64_t tick_ns = static_cast<int64_t>((t1 - t0) * ns_per_tsc);
        telem.record_metrics(tick, tick_ns, pnl.pnl(lob.last_trade_fp), pnl.position());

        seq++;
    }
    // ════════════════════════════════════════════════════════════════════

    watchdog.stop();
    telem_watchdog.stop();

    // ── Final report (JSON to stdout for Go orchestrator) ───────────────
    double final_pnl     = pnl.pnl(lob.last_trade_fp);
    double final_pnl_pct = pnl.pnl_pct(lob.last_trade_fp);
    auto   [p50, p99]    = telem_watchdog.percentiles();
    double correctness   = telem_watchdog.get_correctness_score();

    std::cout << "{"
        << "\"run_id\":\""   << cfg.run_id    << "\","
        << "\"status\":\"complete\","
        << "\"pnl\":"        << final_pnl     << ","
        << "\"pnl_pct\":"    << final_pnl_pct << ","
        << "\"p50_ns\":"     << p50           << ","
        << "\"p99_ns\":"     << p99           << ","
        << "\"total_ticks\":"<< cfg.max_ticks << ","
        << "\"tle_count\":"  << tle_count     << ","
        << "\"position\":"   << pnl.position() << ","
        << "\"total_fills\":" << telem_watchdog.shadow_.contestant_fills_;
    telem_watchdog.shadow_.emit_json(std::cout);   // appends correctness + violation counts
    std::cout << "}" << std::endl;

    munmap(raw, SHM_SIZE);
    shm_unlink(shm_name.c_str());  // clean up the shm object
    if (g_sandbox_pid > 0) {
        kill(g_sandbox_pid, SIGTERM);
        waitpid(g_sandbox_pid, nullptr, 0);
    }
    return 0;
}

// ─── CLI entry point ─────────────────────────────────────────────────────
int main(int argc, char** argv) {
    Config cfg;
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--so" && i+1 < argc) {
            cfg.so_path = argv[++i];
        } else if (arg == "--ticks" && i+1 < argc) {
            cfg.max_ticks = std::atoll(argv[++i]);
        } else if (arg == "--run-id" && i+1 < argc) {
            cfg.run_id = argv[++i];
        } else if (arg == "--dataset" && i+1 < argc) {
            cfg.dataset_path = argv[++i];
        } else if (arg == "--bot-config" && i+1 < argc) {
            cfg.bot_config = argv[++i];
        } else if (arg == "--gm-core" && i+1 < argc) {
            cfg.gm_core = std::atoll(argv[++i]);
        } else if (arg == "--watchdog-core" && i+1 < argc) {  // FIX #9
            cfg.watchdog_core = std::atoll(argv[++i]);
        } else if (arg == "--external-sandbox") {
            cfg.external_sandbox = true;
        }
    }

    // ── Deep Ultrathink: Pin memory to RAM to prevent page faults ──
    // Disabled for AWS Fargate compatibility
    // if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
    //     perror("[WARNING] mlockall failed (run as root for extreme latency guarantees)");
    // }

    pin_to_core(cfg.gm_core);
    std::cerr << "[GM] Vidhi Arena v5.0 — " << cfg.run_id << std::endl;
    std::cerr << "[GM] Ticks: " << cfg.max_ticks << " | .so: " << cfg.so_path << std::endl;

    // ── P2-2: Check isolcpus at startup ─────────────────────────────────
    check_isolcpus(cfg);

    int ret = run_simulation(cfg);
    return ret;
}

// ─── WebAssembly exports (Emscripten browser phase) ──────────────────────
// These are compiled only when building with emcmake (WASM_BUILD=1).
// The JS web worker calls these via ccall/cwrap.
#ifdef WASM_BUILD
#include <emscripten/emscripten.h>

// Static result buffer for JS to read after simulation completes
static char g_result_buf[2048] = {};
static Config g_wasm_cfg;

// Called from JS: run_simulation_wasm(maxTicks, onTickJsCallback)
// In WASM mode, on_tick_fn is null — simulation runs with contestant code
// already compiled into the WASM module via emcc linking.
extern "C" EMSCRIPTEN_KEEPALIVE
int run_simulation_wasm(int64_t max_ticks, int64_t gm_core) {
    g_wasm_cfg.max_ticks    = max_ticks;
    g_wasm_cfg.gm_core      = gm_core;
    g_wasm_cfg.run_id       = "wasm_run";
    g_wasm_cfg.sandbox_core = 0;        // no pinning in WASM

    // In WASM, dlopen is not available — on_tick_fn must be linked directly
    // The browser phase links contestant's transpiled JS via Web Worker messaging
    int ret = run_simulation(g_wasm_cfg);

    // Result is already written to stdout (captured by JS via Module.print)
    return ret;
}

// Called from JS after run_simulation_wasm completes
extern "C" EMSCRIPTEN_KEEPALIVE
const char* get_result_json() {
    return g_result_buf;
}

// Arrow dataset loader: called once to load the public_99k.bin into memory
// JS passes the ArrayBuffer data pointer + length
extern "C" EMSCRIPTEN_KEEPALIVE
void load_tick_data(const uint8_t* data, int32_t length) {
    // In WASM, the C++ PriceSignal is replaced by the preloaded dataset.
    // This stub stores the pointer for the simulation to use.
    // The actual dataset reading replaces PriceSignal::next() calls.
    (void)data; (void)length;
    // TODO: integrate with PriceSignal to replay Arrow data instead of GBM
}

#endif // WASM_BUILD
