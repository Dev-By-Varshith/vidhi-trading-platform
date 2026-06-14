// game-master/telemetry.hpp
// Non-temporal store ring buffer for latency telemetry
// NT stores used HERE (write-only from GM, read by Telemetry core 4)
// HDR Histogram double-buffer — no data race between record + read

#pragma once
#include <cstdint>
#include <cstring>
#include <atomic>
#include <utility>
#include <thread>
#include <x86intrin.h>
#include <sched.h>
#include "shadow_lob.hpp"

static constexpr int32_t RING_SIZE = 65536;  // power of 2

enum class TelemetryEventType : uint8_t {
    TICK_METRICS = 0,
    LIMIT_ADD    = 1,
    FILL         = 2,
    CANCEL       = 3,
};

struct alignas(64) TelemetryEvent {
    TelemetryEventType type;
    uint8_t  _pad0[7];
    int64_t  tick_id;
    union {
        struct {
            int64_t tick_ns;
            int64_t pnl_fp;
            int64_t position;
        } metrics;
        struct {
            bool    is_bid;
            int32_t participant;
            int64_t price_fp;
            int64_t volume;
            uint64_t order_id;
        } limit_add;
        struct {
            bool    taker_is_buy;
            int32_t taker_participant;
            int32_t maker_participant;
            int64_t price_fp;
            int64_t volume;
            uint64_t maker_order_id;
        } fill;
        struct {
            uint64_t order_id;
            bool    live_succeeded;
        } cancel;
    };
    uint64_t tsc_at_write;
};
static_assert(sizeof(TelemetryEvent) == 64, "TelemetryEvent must be 64 bytes");

// ─── HDR Histogram (O(1) Bitwise Hash, Double-Buffered) ───────────────────
struct HDRHistogram {
    static constexpr int BUCKETS = 2048; // Max latency up to 63 bits
    int64_t counts[BUCKETS] = {};
    int64_t total_count     = 0;

    static inline size_t get_hdr_bucket(uint64_t latency_ns) {
        if (latency_ns < 32) return latency_ns;
        uint64_t msb = 63 - __builtin_clzll(latency_ns);
        uint64_t shift = msb - 5;
        uint64_t sub_bucket = (latency_ns >> shift) & 0x1F;
        return (msb << 5) + sub_bucket;
    }

    static inline uint64_t bucket_to_ns(size_t bucket) {
        if (bucket < 32) return bucket;
        uint64_t msb = bucket >> 5;
        uint64_t sub_bucket = bucket & 0x1F;
        return (1ULL << msb) + (sub_bucket << (msb - 5));
    }

    void record(int64_t ns) {
        size_t bucket = get_hdr_bucket(std::max(static_cast<int64_t>(0), ns));
        counts[std::min(bucket, (size_t)BUCKETS - 1)]++;
        total_count++;
    }

    int64_t percentile(double p) const {
        if (total_count == 0) return 0;
        int64_t target = (int64_t)(total_count * p);
        int64_t running = 0;
        for (int i = 0; i < BUCKETS; ++i) {
            running += counts[i];
            if (running >= target) return bucket_to_ns(i);
        }
        return bucket_to_ns(BUCKETS - 1);
    }
};

// ─── Telemetry Ring ───────────────────────────────────────────────────────
class TelemetryRing {
public:
    TelemetryRing() {
        events = new TelemetryEvent[RING_SIZE];
        std::memset(events, 0, sizeof(TelemetryEvent) * RING_SIZE);
    }
    ~TelemetryRing() { delete[] events; }

    void wait_for_space() {
        while (write_head.load(std::memory_order_relaxed) - read_head.load(std::memory_order_acquire) >= RING_SIZE - 64) {
            _mm_pause();
        }
    }

    // Called by GM (Core 2) — uses NT stores for write-only data
    void record_metrics(int64_t tick_id, int64_t tick_ns, double pnl, int64_t pos) {
        wait_for_space();
        int32_t slot = (int32_t)(write_head & (RING_SIZE - 1));
        auto* ev     = &events[slot];
        _mm_stream_si64((long long int*)&ev->type, (long long int)TelemetryEventType::TICK_METRICS);
        _mm_stream_si64((long long int*)&ev->tick_id,        (long long int)tick_id);
        _mm_stream_si64((long long int*)&ev->metrics.tick_ns,(long long int)tick_ns);
        _mm_stream_si64((long long int*)&ev->metrics.pnl_fp, (long long int)(pnl * 1'000'000)); // ×1e6 fixed-point — matches to_fp() and SharedMem convention
        _mm_stream_si64((long long int*)&ev->metrics.position,(long long int)pos);
        _mm_stream_si64((long long int*)&ev->tsc_at_write, (long long int)__rdtsc());
        _mm_sfence();
        write_head.fetch_add(1, std::memory_order_release);
    }

    void record_limit_add(int64_t tick_id, bool is_bid, int64_t price_fp, int64_t volume, int32_t participant, uint64_t order_id) {
        wait_for_space();
        int32_t slot = (int32_t)(write_head & (RING_SIZE - 1));
        auto* ev     = &events[slot];
        ev->type = TelemetryEventType::LIMIT_ADD;
        ev->tick_id = tick_id;
        ev->limit_add.is_bid = is_bid;
        ev->limit_add.participant = participant;
        ev->limit_add.price_fp = price_fp;
        ev->limit_add.volume = volume;
        ev->limit_add.order_id = order_id;
        _mm_sfence();
        write_head.fetch_add(1, std::memory_order_release);
    }

    void record_fill(int64_t tick_id, bool taker_buy, int32_t taker_p, int32_t maker_p, int64_t price_fp, int64_t vol, uint64_t maker_id) {
        wait_for_space();
        int32_t slot = (int32_t)(write_head & (RING_SIZE - 1));
        auto* ev     = &events[slot];
        ev->type = TelemetryEventType::FILL;
        ev->tick_id = tick_id;
        ev->fill.taker_is_buy = taker_buy;
        ev->fill.taker_participant = taker_p;
        ev->fill.maker_participant = maker_p;
        ev->fill.price_fp = price_fp;
        ev->fill.volume = vol;
        ev->fill.maker_order_id = maker_id;
        _mm_sfence();
        write_head.fetch_add(1, std::memory_order_release);
    }

    void record_cancel(int64_t tick_id, uint64_t order_id, bool succeeded) {
        wait_for_space();
        int32_t slot = (int32_t)(write_head & (RING_SIZE - 1));
        auto* ev     = &events[slot];
        ev->type = TelemetryEventType::CANCEL;
        ev->tick_id = tick_id;
        ev->cancel.order_id = order_id;
        ev->cancel.live_succeeded = succeeded;
        _mm_sfence();
        write_head.fetch_add(1, std::memory_order_release);
    }

    uint64_t get_write_head() const { return write_head.load(std::memory_order_acquire); }
    const TelemetryEvent& get_event(uint64_t index) const { return events[index & (RING_SIZE - 1)]; }
    
    void advance_read_head(uint64_t head) {
        read_head.store(head, std::memory_order_release);
    }

private:
    TelemetryEvent*           events;
    alignas(64) std::atomic<uint64_t> write_head{0};
    alignas(64) std::atomic<uint64_t> read_head{0};
};

// ─── Telemetry Watchdog Thread (Core 4) ───────────────────────────────────
class TelemetryWatchdog {
public:
    TelemetryWatchdog(TelemetryRing& ring) : ring_(ring) {}

    void start(int core) {
        running_ = true;
        thread_ = std::thread([this, core]() {
            // Pin to Core 4
            cpu_set_t mask; CPU_ZERO(&mask); CPU_SET(core, &mask);
            sched_setaffinity(0, sizeof(mask), &mask);
            this->run();
        });
    }

    void stop() {
        running_ = false;
        if (thread_.joinable()) thread_.join();
    }

    std::pair<int64_t, int64_t> percentiles() const {
        const auto* h = readable_hdr();
        return { h->percentile(0.50), h->percentile(0.99) };
    }

private:
    TelemetryRing& ring_;
    std::thread thread_;
    std::atomic<bool> running_{false};

    // Double-buffer HDR: one recording, one readable
    alignas(64) HDRHistogram  hdr_a{};
    alignas(64) HDRHistogram  hdr_b{};
    bool current_is_a = true;

    HDRHistogram* current_hdr()  { return current_is_a ? &hdr_a : &hdr_b; }
    const HDRHistogram* readable_hdr() const { return current_is_a ? &hdr_b : &hdr_a; }

    void swap_hdr() {
        if (current_is_a) { hdr_b = HDRHistogram{}; current_is_a = false; }
        else              { hdr_a = HDRHistogram{}; current_is_a = true;  }
    }

    void run() {
        uint64_t read_head = 0;
        int64_t last_swap_tick = -1;

        while (running_.load(std::memory_order_relaxed) || read_head < ring_.get_write_head()) {
            uint64_t write_head = ring_.get_write_head();
            while (read_head < write_head) {
                const auto& ev = ring_.get_event(read_head);

                if (ev.type == TelemetryEventType::TICK_METRICS) {
                    current_hdr()->record(ev.metrics.tick_ns);

                    // Binary batch flush to stdout for TimescaleDB every 1000 ticks
                    if (ev.tick_id > last_swap_tick && ev.tick_id % 1000 == 999) {
                        swap_hdr();
                        last_swap_tick = ev.tick_id;

                        // Dump binary struct to stdout for Go job_worker to pipe into PG COPY
                        uint8_t packet_type = 0x01; // TICK_METRICS
                        std::fwrite(&packet_type, 1, 1, stdout);
                        struct {
                            int64_t tick_id;
                            int64_t pnl_fp;
                            int64_t pos;
                            int64_t lat_p50;
                            int64_t lat_p99;
                            double  bid_price;
                            double  ask_price;
                            double  spread;
                            double  last_trade;
                            int32_t fill_count;
                        } batch_row = {
                            ev.tick_id,
                            ev.metrics.pnl_fp,
                            ev.metrics.position,
                            readable_hdr()->percentile(0.50),
                            readable_hdr()->percentile(0.99),
                            static_cast<double>(shadow_.shadow_best_bid_) / 1000000.0,
                            static_cast<double>(shadow_.shadow_best_ask_) / 1000000.0,
                            static_cast<double>(shadow_.shadow_best_ask_ - shadow_.shadow_best_bid_) / 1000000.0,
                            static_cast<double>(shadow_.shadow_last_trade_fp_) / 1000000.0,
                            shadow_.contestant_fills_
                        };
                        std::fwrite(&batch_row, sizeof(batch_row), 1, stdout);
                        std::fflush(stdout);
                    }
                } else if (ev.type == TelemetryEventType::LIMIT_ADD) {
                    shadow_.on_limit_add(ev.limit_add.is_bid, ev.limit_add.price_fp, ev.limit_add.volume,
                                         ev.limit_add.participant, ev.limit_add.order_id, ev.tick_id);
                } else if (ev.type == TelemetryEventType::FILL) {
                    MatchedFill f{};
                    f.taker_is_buy = ev.fill.taker_is_buy;
                    f.taker_participant = ev.fill.taker_participant;
                    f.maker_participant = ev.fill.maker_participant;
                    f.price_fp = ev.fill.price_fp;
                    f.volume = ev.fill.volume;
                    shadow_.on_fill(f, ev.fill.maker_order_id, ev.tick_id);

                    // Export individual fills to stdout
                    uint8_t packet_type = 0x02; // FILL
                    std::fwrite(&packet_type, 1, 1, stdout);
                    struct {
                        int64_t tick_id;
                        double  price;
                        int64_t volume;
                        int32_t maker_participant;
                        int32_t taker_participant;
                        bool    taker_is_buy;
                    } fill_row = {
                        ev.tick_id,
                        static_cast<double>(f.price_fp) / 1000000.0,
                        f.volume,
                        f.maker_participant,
                        f.taker_participant,
                        f.taker_is_buy
                    };
                    std::fwrite(&fill_row, sizeof(fill_row), 1, stdout);
                } else if (ev.type == TelemetryEventType::CANCEL) {
                    shadow_.on_cancel(ev.cancel.order_id, ev.cancel.live_succeeded, ev.tick_id);
                }
                read_head++;
            }
            ring_.advance_read_head(read_head);
            _mm_pause(); // Avoid thrashing while catching up
        }
    }
public:
    double get_correctness_score() const { return shadow_.correctness_score(); }
    ShadowLOB shadow_;
};
