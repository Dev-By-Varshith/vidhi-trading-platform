#pragma once

#include <cstdint>

namespace vidhi {

constexpr double FIXED_POINT = 1000000.0;

// Market Data Indices
enum MarketDataIdx {
    BID_PRICE = 0,
    ASK_PRICE = 1,
    MID_PRICE = 2,
    SPREAD = 3,
    BID_VOLUME = 4,
    ASK_VOLUME = 5,
    LAST_TRADE_PRICE = 6,
    UNDERLYING_SIGNAL = 7,
    POSITION = 8,
    CASH = 9,
    PNL = 10,
    FILL_COUNT = 11,
    // fills start at 12
};

// Order Out Indices
enum OrderOutIdx {
    ORDER_COUNT = 0,
    // o0
    O0_TYPE = 1,
    O0_PRICE = 2,
    O0_VOLUME = 3,
    O0_ID = 4,
    // o1
    O1_TYPE = 5,
    O1_PRICE = 6,
    O1_VOLUME = 7,
    O1_ID = 8,
    // o2
    O2_TYPE = 9,
    O2_PRICE = 10,
    O2_VOLUME = 11,
    O2_ID = 12,
    // o3
    O3_TYPE = 13,
    O3_PRICE = 14,
    O3_VOLUME = 15,
    O3_ID = 16,
    
    // Persistent state
    STATE_0 = 48,
    STATE_1 = 49,
    STATE_2 = 50,
    STATE_3 = 51,
};

enum OrderType {
    HOLD = 0,
    LIMIT_BUY = 1,
    LIMIT_SELL = 2,
    MARKET_BUY = 3,
    MARKET_SELL = 4,
    CANCEL = 5,
};

class MarketState {
    int64_t* md_;
public:
    MarketState(int64_t* md) : md_(md) {}
    
    double bid_price() const { return md_[BID_PRICE] / FIXED_POINT; }
    double ask_price() const { return md_[ASK_PRICE] / FIXED_POINT; }
    double mid_price() const { return md_[MID_PRICE] / FIXED_POINT; }
    double spread() const { return md_[SPREAD] / FIXED_POINT; }
    
    int64_t position() const { return md_[POSITION]; }
    double cash() const { return md_[CASH] / 100.0; } // PnL/Cash is 1e2
    double pnl() const { return md_[PNL] / 100.0; }
};

class OrderBuffer {
    int64_t* oo_;
    int count_;
public:
    OrderBuffer(int64_t* oo) : oo_(oo), count_(0) {
        oo_[ORDER_COUNT] = 0;
    }
    
    void limit_buy(double price, int64_t volume) {
        if (count_ >= 4) return;
        int base = 1 + (count_ * 4);
        oo_[base] = LIMIT_BUY;
        oo_[base+1] = static_cast<int64_t>(price * FIXED_POINT);
        oo_[base+2] = volume;
        oo_[base+3] = 0;
        oo_[ORDER_COUNT] = ++count_;
    }
    
    void limit_sell(double price, int64_t volume) {
        if (count_ >= 4) return;
        int base = 1 + (count_ * 4);
        oo_[base] = LIMIT_SELL;
        oo_[base+1] = static_cast<int64_t>(price * FIXED_POINT);
        oo_[base+2] = volume;
        oo_[base+3] = 0;
        oo_[ORDER_COUNT] = ++count_;
    }
    
    void market_buy(int64_t volume) {
        if (count_ >= 4) return;
        int base = 1 + (count_ * 4);
        oo_[base] = MARKET_BUY;
        oo_[base+1] = 0;
        oo_[base+2] = volume;
        oo_[base+3] = 0;
        oo_[ORDER_COUNT] = ++count_;
    }

    void market_sell(int64_t volume) {
        if (count_ >= 4) return;
        int base = 1 + (count_ * 4);
        oo_[base] = MARKET_SELL;
        oo_[base+1] = 0;
        oo_[base+2] = volume;
        oo_[base+3] = 0;
        oo_[ORDER_COUNT] = ++count_;
    }

    void cancel(uint64_t order_id) {
        if (count_ >= 4) return;
        int base = 1 + (count_ * 4);
        oo_[base] = CANCEL;
        oo_[base+1] = 0;
        oo_[base+2] = 0;
        oo_[base+3] = order_id;
        oo_[ORDER_COUNT] = ++count_;
    }

    int order_count() const {
        return count_;
    }

    int64_t& state(int index) {
        return oo_[48 + index];
    }
};

} // namespace vidhi
