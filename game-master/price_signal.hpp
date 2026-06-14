// price_signal.hpp — mmap VIDHI flat tick tape (zero-copy, hugepage hint)
#pragma once

#include "bot_fleet.hpp"
#include "rendezvous.hpp"

#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#pragma pack(push, 1)
struct TickRecord {
    int64_t tick_id;
    double  bid_price;
    double  ask_price;
    double  mid_price;
    double  fair_value;
    double  spread;
    double  volatility;
    double  bid_vol;
    double  ask_vol;
    double  last_trade_px;
    double  is_news_flag;
};
#pragma pack(pop)

static constexpr size_t  TICK_RECORD_BYTES = sizeof(TickRecord);
static constexpr size_t  VIDHI_BIN_HEADER  = 16;  // magic(8) + n_ticks(8)

// GBM fallback when no dataset file is present
struct PriceSignalGBM {
    double   price    = 1500.0;
    double   vol      = 0.0003;
    double   mean_rev = 0.001;
    uint64_t rng      = 0x12345678ABCDEFULL;

    uint64_t xorshift() {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        return rng;
    }
    double randn() {
        const double u1 = ((xorshift() & 0xFFFFFF) + 1.0) / 0x1000001;
        const double u2 = (xorshift() & 0xFFFFFF) / (double)0x1000000;
        return std::sqrt(-2.0 * std::log(u1)) * std::cos(2.0 * M_PI * u2);
    }

    MarketSnapshot next(int64_t tick_id, int64_t cur_bid_fp, int64_t cur_ask_fp) {
        const double drift = -mean_rev * (price - 1500.0);
        const double news  = (tick_id % 10000 == 0) ? randn() * 2.0 : 0.0;
        price += drift + vol * price * randn() + news;
        price = std::max(1050.0, std::min(1950.0, price));
        return MarketSnapshot{
            .bid_fp        = cur_bid_fp,
            .ask_fp        = cur_ask_fp,
            .mid_fp        = (cur_bid_fp + cur_ask_fp) / 2,
            .spread_fp     = cur_ask_fp - cur_bid_fp,
            .fair_value_fp = to_fp(price),
            .volatility_fp = to_fp(vol * price),
            .is_news_event = (news != 0.0),
        };
    }
};

class TickDataset {
public:
    bool load(const std::string& path) {
        if (path.empty()) return false;
        const int fd = open(path.c_str(), O_RDONLY);
        if (fd < 0) return false;

        char magic[8] = {};
        int64_t n = 0;
        if (read(fd, magic, 8) != 8 || read(fd, &n, 8) != 8) {
            close(fd);
            return false;
        }
        if (std::memcmp(magic, "VIDHI", 5) != 0 || n <= 0) {
            close(fd);
            return false;
        }

        map_len_ = VIDHI_BIN_HEADER + static_cast<size_t>(n) * TICK_RECORD_BYTES;
        void* raw = mmap(nullptr, map_len_, PROT_READ, MAP_PRIVATE, fd, 0);
        close(fd);
        if (raw == MAP_FAILED) return false;

        madvise(raw, map_len_, MADV_SEQUENTIAL);
        madvise(raw, map_len_, MADV_HUGEPAGE);

        mapped_  = raw;
        n_ticks_ = n;
        rows_    = reinterpret_cast<const TickRecord*>(
            static_cast<const char*>(raw) + VIDHI_BIN_HEADER);
        loaded_  = true;
        std::cerr << "[DATASET] mmap " << path << " ticks=" << n_ticks_ << "\n";
        return true;
    }

    ~TickDataset() { unmap(); }

    bool     loaded() const { return loaded_; }
    int64_t  size()   const { return n_ticks_; }

    MarketSnapshot snapshot(int64_t tick, int64_t cur_bid_fp, int64_t cur_ask_fp) {
        if (!loaded_ || tick < 0 || tick >= n_ticks_)
            return gbm_.next(tick, cur_bid_fp, cur_ask_fp);

        const TickRecord& r = rows_[tick];
        const int64_t bid_fp = to_fp(r.bid_price);
        const int64_t ask_fp = to_fp(r.ask_price);
        const int64_t mid_fp = to_fp(r.mid_price);
        return MarketSnapshot{
            .bid_fp        = bid_fp > 0 ? bid_fp : cur_bid_fp,
            .ask_fp        = ask_fp > 0 ? ask_fp : cur_ask_fp,
            .mid_fp        = mid_fp > 0 ? mid_fp : (cur_bid_fp + cur_ask_fp) / 2,
            .spread_fp     = to_fp(r.spread),
            .fair_value_fp = to_fp(r.fair_value),
            .volatility_fp = to_fp(r.volatility),
            .is_news_event = r.is_news_flag >= 0.5,
        };
    }

private:
    void unmap() {
        if (mapped_ != MAP_FAILED) {
            munmap(mapped_, map_len_);
            mapped_ = MAP_FAILED;
        }
        loaded_ = false;
        rows_   = nullptr;
    }

    void*              mapped_  = MAP_FAILED;
    size_t             map_len_ = 0;
    int64_t            n_ticks_ = 0;
    const TickRecord*  rows_    = nullptr;
    bool               loaded_  = false;
    PriceSignalGBM     gbm_;
};
