// sandbox/sandbox_runner.cpp
// C++ wrapper running inside the isolated Docker container.
// Responsibilities:
// 1. mmap the /dev/shm IPC struct
// 2. dlopen the contestant's .so
// 3. Apply strict BPF seccomp filters
// 4. Spin in the tight 100µs tick loop invoking on_tick__cfunc

#include "game-master/rendezvous.hpp"
#include "seccomp_filter.hpp"

#include <iostream>
#include <fstream>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <unistd.h>
#include <dlfcn.h>
#include <cstdlib>
#include <cerrno>
#include <cstring>
#include <emmintrin.h>

// The signature of the Numba-compiled Python function
typedef void (*OnTickFunc)(int64_t tick_id, int64_t* market_data, int64_t* order_out);

// Dummy symbols to satisfy dlopen for Numba pycc compiled .so
// Since we never call the Python module init and run purely in nopython mode,
// these will never actually be executed.
extern "C" {
    void NRT_MemInfo_call_dtor() {}
    int PyArg_UnpackTuple() { return 0; }
    int PyErr_Occurred() { return 0; }
    void PyErr_SetString() {}
    void* PyExc_RuntimeError = nullptr;
    void* PyExc_TypeError = nullptr;
    void* PyExc_SystemError = nullptr;
    long long PyLong_AsLongLong() { return 0; }
    void* PyModule_Create2() { return nullptr; }
    void* PyNumber_Long() { return nullptr; }
    void Py_DecRef() {}
    void pycc_init_vidhi_trader() {}
}

int main() {
    // Sleep for 500ms to give Docker daemon time to setup namespaces
    usleep(500000);
    std::cout << "[SANDBOX] Booting..." << std::endl;

    // 1. Resolve IPC paths
    const char* env_run_id = std::getenv("VIDHI_RUN_ID");
    std::string run_id_str;
    if (env_run_id) {
        run_id_str = env_run_id;
    } else {
        std::ifstream ifs("/sandbox/run_id.txt");
        if (ifs.good()) {
            std::getline(ifs, run_id_str);
        }
    }

    if (run_id_str.empty()) {
        std::cerr << "[SANDBOX] Fatal: VIDHI_RUN_ID not set and /sandbox/run_id.txt missing" << std::endl;
        return 1;
    }
    std::string shm_name = "/vidhi_run_" + run_id_str;

    const char* so_path = std::getenv("VIDHI_SO_PATH");
    if (!so_path) {
        std::cerr << "[SANDBOX] Fatal: VIDHI_SO_PATH not set" << std::endl;
        return 1;
    }

    // 2. Map Shared Memory
    int shm_fd = -1;
    int retries = 500; // 5 seconds (500 * 10ms)
    while (retries-- > 0) {
        shm_fd = shm_open(shm_name.c_str(), O_RDWR, 0666);
        if (shm_fd >= 0) break;
        usleep(10000); // 10ms
    }
    
    if (shm_fd < 0) {
        std::cerr << "FATAL: Timeout waiting for Game Master to create shared memory " << shm_name << std::endl;
        perror("shm_open");
        return 1;
    }

    void* addr = mmap(NULL, sizeof(SharedMem), PROT_READ | PROT_WRITE, MAP_SHARED, shm_fd, 0);
    if (addr == MAP_FAILED) {
        std::cerr << "[SANDBOX] Fatal: mmap failed" << std::endl;
        return 1;
    }
    SharedMem* sm = static_cast<SharedMem*>(addr);

    // 3. Load contestant .so
    // Copy the .so to /tmp (tmpfs) to bypass potential noexec flags on the bind-mounted /sandbox directory
    std::cout << "[SANDBOX] Copying " << so_path << " to /tmp/trader.so..." << std::endl;
    std::ifstream src_so(so_path, std::ios::binary);
    std::ofstream dst_so("/tmp/trader.so", std::ios::binary);
    dst_so << src_so.rdbuf();
    src_so.close();
    dst_so.close();

    std::cout << "[SANDBOX] Loading /tmp/trader.so..." << std::endl;
    void* handle = dlopen("/tmp/trader.so", RTLD_LAZY | RTLD_LOCAL);
    if (!handle) {
        std::cerr << "[SANDBOX] Fatal: dlopen failed: " << dlerror() << std::endl;
        return 1;
    }

    OnTickFunc on_tick = (OnTickFunc)dlsym(handle, "on_tick__cfunc");
    if (!on_tick) {
        std::cerr << "[SANDBOX] Fatal: dlsym failed to find on_tick__cfunc: " << dlerror() << std::endl;
        return 1;
    }

    // 4. Apply no-new-privs (one-way: process + children can NEVER gain privileges)
    // This is a prerequisite for effective seccomp filtering — without it, a
    // privileged execve could bypass the filter. Must be set before seccomp.
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        std::cerr << "[SANDBOX] FATAL: PR_SET_NO_NEW_PRIVS failed: " << strerror(errno) << std::endl;
        return 1;
    }

    // 5. Apply Seccomp security (drops everything except read/write/exit)
    if (!apply_seccomp_filter()) {
        std::cerr << "[SANDBOX] Fatal: seccomp filter failed" << std::endl;
        return 1;
    }

    // 5. Signal GM that sandbox is ready (optional, GM doesn't actually wait for this before ticking)
    // sandbox_signal(sm, 1);

    // 6. Tick Loop
    uint64_t last_seen_gm_seq = 0;

    while (true) {
        // Spin-wait for GM to release new market data
        // If max_spins exceeded, we just TLE. But we loop infinitely here;
        // GM's watchdog will SIGKILL us if we are too slow.
        uint64_t current_gm_seq;
        while ((current_gm_seq = sm->gm_sequence.load(std::memory_order_acquire)) == last_seen_gm_seq) {
            _mm_pause();
        }

        last_seen_gm_seq = current_gm_seq;

        // Call user code. 
        // market_data array starts at offset 64 (bid_price_fp)
        // order_out array starts at offset 512 (order_count)
        int64_t* market_data = reinterpret_cast<int64_t*>(&sm->bid_price_fp);
        int64_t* order_out   = reinterpret_cast<int64_t*>(&sm->order_count);

        // tick_id is implicitly available or passed? We'll pass current_gm_seq - 1
        int64_t tick_id = (current_gm_seq - 1);

        on_tick(tick_id, market_data, order_out);

        // Signal completion back to GM with the exact sequence we just processed
        sandbox_signal(sm, current_gm_seq);
    }

    return 0;
}
