// game-master/watchdog.hpp
#pragma once
#include <atomic>
#include <thread>
#include <chrono>
#include <csignal>
#include <iostream>
#include <unistd.h>
#include <sched.h>
#include <x86intrin.h>
#include "rendezvous.hpp"

// External globals for watchdog
extern std::atomic<bool> g_tle_flag;
extern pid_t             g_sandbox_pid;

inline void pin_watchdog_core(int core) {
    cpu_set_t mask; CPU_ZERO(&mask); CPU_SET(core, &mask);
    if (sched_setaffinity(0, sizeof(mask), &mask) != 0) {
        std::cerr << "[WARN] Watchdog could not pin to core " << core << "\n";
    }
}

struct Watchdog {
    SharedMem*        sm;
    int64_t           tle_ns;
    std::thread       thd;
    std::atomic<bool> running{false};

    void start(int core) {
        running = true;
        thd = std::thread([this, core]() {
            pin_watchdog_core(core);
            while (running) {
                uint64_t gm_seq = sm->gm_sequence.load(std::memory_order_acquire);
                uint64_t sb_seq = sm->sb_sequence.load(std::memory_order_acquire);
                if (gm_seq != sb_seq) {
                    // CLOCK_MONOTONIC accurate polling
                    auto t0 = std::chrono::steady_clock::now();
                    while (sm->sb_sequence.load(std::memory_order_acquire) != gm_seq && running) {
                        auto t1 = std::chrono::steady_clock::now();
                        int64_t elapsed_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
                        if (elapsed_ns > tle_ns) {
                            g_tle_flag = true;
                            if (g_sandbox_pid > 0) {
                                kill(g_sandbox_pid, SIGKILL);
                                std::cerr << "[WATCHDOG] TLE (" << elapsed_ns << "ns) — SIGKILL sent to sandbox " << g_sandbox_pid << "\n";
                            }
                            break;
                        }
                        _mm_pause();
                    }
                }
                _mm_pause();
            }
        });
    }

    void stop() {
        running = false;
        if (thd.joinable()) thd.join();
    }
};
