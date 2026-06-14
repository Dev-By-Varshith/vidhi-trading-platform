// game-master/tsc_calibrate.hpp
// TSC calibration — convert __rdtscp deltas to nanoseconds
// Checks CPUID for invariant TSC before relying on it
//
// FIX #14: IMPORTANT — call calibrate_tsc_ns() AFTER pinning the GM thread
// to its isolated core (pin_to_core(cfg.gm_core) in main.cpp).
// Calling it before pinning means the sleep_for may execute on a different
// core, introducing OS scheduler jitter of 10–100ms into the calibration,
// which causes a proportional error in ns/TSC conversion.

#pragma once
#include <cstdint>
#include <chrono>
#include <thread>
#include <x86intrin.h>
#include <cpuid.h>

// ─── Check CPUID: is TSC invariant? ───────────────────────────────────────
// CPUID[0x80000007].EDX bit 8 = Invariant TSC
// Without this, TSC frequency changes with CPU power states — unreliable
inline bool tsc_is_invariant() {
#if defined(__x86_64__)
    uint32_t eax, ebx, ecx, edx;
    __get_cpuid(0x80000007, &eax, &ebx, &ecx, &edx);
    return (edx >> 8) & 1;
#else
    return false;
#endif
}

// ─── Fast calibration via back-to-back CPUID serialization ────────────────
// Uses CPUID to serialize (drain the OoO pipeline) + sleep(0) to yield,
// then measure a 10ms reference window. Less accurate than 100ms sleep but
// immune to long jitter bursts since it uses multiple short samples.
// MUST be called AFTER the calling thread is pinned to its isolated core.
inline double calibrate_tsc_ns_fast(int samples = 5) {
    if (!tsc_is_invariant()) return 1.0 / 3.0;

    uint32_t aux;
    double total_ns_per_tick = 0.0;
    for (int s = 0; s < samples; ++s) {
        // CPUID serializes the instruction stream
        uint32_t eax, ebx, ecx, edx;
        __get_cpuid(0, &eax, &ebx, &ecx, &edx);
        uint64_t tsc0 = __rdtscp(&aux);
        auto t0 = std::chrono::high_resolution_clock::now();

        std::this_thread::sleep_for(std::chrono::milliseconds(10));

        __get_cpuid(0, &eax, &ebx, &ecx, &edx);
        uint64_t tsc1 = __rdtscp(&aux);
        auto t1 = std::chrono::high_resolution_clock::now();

        double elapsed_ns = std::chrono::duration<double, std::nano>(t1 - t0).count();
        total_ns_per_tick += elapsed_ns / static_cast<double>(tsc1 - tsc0);
    }
    return total_ns_per_tick / samples;
}

// ─── Calibrate TSC against wall clock (legacy, 100ms sleep) ───────────────
// Returns nanoseconds per TSC tick.
// NOTE: Call this AFTER pinning to the isolated core to avoid jitter.
// Prefer calibrate_tsc_ns_fast() for minimal startup latency.
inline double calibrate_tsc_ns(uint32_t calibrate_ms = 100) {
    if (!tsc_is_invariant()) {
        // Fallback: assume 3GHz (good enough for non-critical paths)
        return 1.0 / 3.0;
    }

    uint32_t aux;
    uint64_t tsc0 = __rdtscp(&aux);
    auto t0 = std::chrono::high_resolution_clock::now();

    std::this_thread::sleep_for(std::chrono::milliseconds(calibrate_ms));

    uint64_t tsc1 = __rdtscp(&aux);
    auto t1 = std::chrono::high_resolution_clock::now();

    double elapsed_ns = std::chrono::duration<double, std::nano>(t1 - t0).count();
    double tsc_delta  = static_cast<double>(tsc1 - tsc0);

    return elapsed_ns / tsc_delta;
}
