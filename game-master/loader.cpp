/*
 * game-master/loader.cpp
 * Vidhi Sandbox Loader — runs inside the isolated contestant container.
 *
 * This binary:
 *   1. Reads run_id from VIDHI_RUN_ID env or /sandbox/run_id.txt
 *   2. Opens /vidhi_run_{run_id} via shm_open (with 30s retry)
 *   3. Maps it to SharedMem* (defined in rendezvous.hpp)
 *   4. dlopen()s the contestant's compiled .so
 *   5. Calls on_tick__cfunc via lock-free atomic sequence IPC
 */
#include <iostream>
#include <fstream>
#include <cstdlib>
#include <csignal>
#include <unistd.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <cstring>
#include <thread>
#include <chrono>
#include <emmintrin.h> // For _mm_pause

#include "rendezvous.hpp"
#include "seccomp_filter.hpp"

typedef void (*on_tick_fn)(int64_t tick_id, int64_t* market_data, int64_t* order_out);

static volatile std::sig_atomic_t g_stop = 0;
static void sigterm_handler(int) { g_stop = 1; }

int main() {
    std::signal(SIGTERM, sigterm_handler);
    std::signal(SIGINT,  sigterm_handler);

    // ── Load .so ───────────────────────────────────────────────────────────
    const char* so_path = std::getenv("VIDHI_SO_PATH");
    if (!so_path) { std::cerr << "[LOADER] VIDHI_SO_PATH not set\n"; return 1; }

    void* handle = dlopen(so_path, RTLD_NOW | RTLD_LOCAL);
    if (!handle) { std::cerr << "[LOADER] dlopen failed: " << dlerror() << "\n"; return 1; }

    on_tick_fn on_tick = reinterpret_cast<on_tick_fn>(dlsym(handle, "on_tick__cfunc"));
    if (!on_tick) { std::cerr << "[LOADER] dlsym failed: " << dlerror() << "\n"; return 1; }

    // ── Map POSIX Shared Memory ────────────────────────────────────────────
    // CRITICAL: GM creates shm with name "/vidhi_run_{run_id}" — loader MUST use same name.
    // 1. Try VIDHI_RUN_ID env var (set by fallback container creation in spawner.go)
    // 2. Try /sandbox/run_id.txt (set by warm pool in spawner.go ClaimSandbox path)
    const char* run_id_env = std::getenv("VIDHI_RUN_ID");
    std::string run_id_str;
    
    if (run_id_env && run_id_env[0] != '\0') {
        run_id_str = run_id_env;
    } else {
        // Warm pool path: spawner writes run_id.txt to the bind-mounted /sandbox dir
        std::ifstream rid_file("/sandbox/run_id.txt");
        if (rid_file.is_open()) {
            std::getline(rid_file, run_id_str);
        }
    }
    
    // POSIX shared memory name — MUST match what the GM creates in main.cpp.
    // GM uses shm_open("/vidhi_shm_" + run_id) → /dev/shm, NOT /tmp.
    std::string shm_name;
    if (!run_id_str.empty()) {
        shm_name = "/vidhi_shm_" + run_id_str;
    } else {
        shm_name = "/vidhi_arena"; // last-resort fallback for local testing
    }
    std::cerr << "[LOADER] Connecting to POSIX SHM: " << shm_name << "\n";
    
    static constexpr size_t SHM_SIZE = 2 * 1024 * 1024; // MUST match GM's 2MB mmap

    // Retry shm_open for up to 30 seconds — GM may create SHM after sandbox starts
    int fd = -1;
    for (int attempt = 0; attempt < 300; ++attempt) {
        fd = shm_open(shm_name.c_str(), O_RDWR, 0);
        if (fd >= 0) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    if (fd < 0) {
        std::cerr << "[LOADER] shm_open(" << shm_name << ") failed after 30s: " << strerror(errno) << "\n";
        return 1;
    }
    std::cerr << "[LOADER] POSIX SHM connected: " << shm_name << " ✓\n";

    void* ptr = mmap(nullptr, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (ptr == MAP_FAILED) {
        std::cerr << "[LOADER] mmap failed: " << strerror(errno) << "\n";
        return 1;
    }


    SharedMem* sm = reinterpret_cast<SharedMem*>(ptr);
    
    // Arrays for C-style FFI boundary
    alignas(64) int64_t market_data[64] = {};
    alignas(64) int64_t order_out[64]   = {};

    // Apply strict BPF filtering (5-Layer Security Phase 5)
    Seccomp::apply_strict_mode();

    std::cerr << "[LOADER] Entering strict Lock-Free synchronization loop\n";

    uint64_t last_seen_gm_seq = 0;

    while (!g_stop) {
        // Spin-wait for Game Master signal with dynamic sequence tracking
        uint64_t current_gm_seq;
        int spins = 0;
        while ((current_gm_seq = sm->gm_sequence.load(std::memory_order_acquire)) == last_seen_gm_seq) {
            _mm_pause();
            if (++spins > 100'000) break;
        }

        if (current_gm_seq == last_seen_gm_seq) {
            // GM might have finished or we really TLE'd
            continue; 
        }

        last_seen_gm_seq = current_gm_seq;
        uint64_t seq = current_gm_seq;

        // Pack market_data for the C API signature
        market_data[0]  = sm->bid_price_fp;
        market_data[1]  = sm->ask_price_fp;
        market_data[2]  = sm->mid_price_fp;
        market_data[3]  = sm->spread_fp;
        market_data[4]  = sm->bid_depth[0].volume;
        market_data[5]  = sm->ask_depth[0].volume;
        market_data[6]  = sm->last_trade_price_fp;
        market_data[7]  = sm->underlying_signal_fp;
        market_data[8]  = sm->contestant_position;
        market_data[9]  = sm->contestant_cash_fp;
        market_data[10] = sm->contestant_pnl_fp;
        market_data[11] = sm->fill_count;
        
        // fills[] is a flat int64_t[16] in SharedMem.
        // Layout per fill (4 int64 slots): [order_id, price_fp, volume, side]
        for (int i = 0; i < sm->fill_count && i < 4; ++i) {
            int base = i * 4;
            market_data[12 + i * 6] = sm->fills[base + 1]; // fill_price_fp (slot 1)
            market_data[14 + i * 6] = sm->fills[base + 2]; // fill_volume (slot 2)
            market_data[16 + i * 6] = sm->fills[base + 3]; // side (slot 3)
        }

        for (int i = 0; i < DEPTH_LEVELS; ++i) {
            market_data[32 + i] = sm->bid_depth[i].volume;
            market_data[37 + i] = sm->ask_depth[i].volume;
        }

        std::memcpy(market_data + 48, sm->persistent_state, STATE_SLOTS * sizeof(int64_t));

        std::memset(order_out, 0, 17 * sizeof(int64_t));

        // ── Call untrusted contestant code ──────────────────────────────────────
        on_tick(seq - 1, market_data, order_out); // tick ID is 0-indexed like GM loop

        // Save persistent state back
        std::memcpy(sm->persistent_state, order_out + 48, STATE_SLOTS * sizeof(int64_t));

        // Send orders back to GM via flat int64_t orders[16] array.
        // order_count is a separate int64_t field; orders[] is laid out as
        // [type, price_fp, volume, order_id] for each slot (4 int64_t per order).
        int32_t o_count = 0;
        sm->order_count = 0;
        for (int i = 0; i < ORDER_SLOTS; ++i) {
            int64_t type = order_out[1 + i * 4];
            if (type == 0) continue;
            int base = o_count * 4;
            sm->orders[base + 0] = type;                       // type
            sm->orders[base + 1] = order_out[1 + i * 4 + 1];  // price_fp
            sm->orders[base + 2] = order_out[1 + i * 4 + 2];  // volume
            sm->orders[base + 3] = order_out[1 + i * 4 + 3];  // order_id
            o_count++;
        }
        sm->order_count = o_count;

        // Signal Game Master that execution is complete
        sandbox_signal(sm, seq);
    }

    dlclose(handle);
    munmap(ptr, SHM_SIZE);
    return 0;
}
