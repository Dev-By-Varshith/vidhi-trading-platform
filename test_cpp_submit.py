import requests
import json
import time

CPP_CODE = """
#include <cstdint>
#include "vidhi_sdk/cpp/vidhi.hpp"

extern "C" void on_tick__cfunc(int64_t tick_id, int64_t* md, int64_t* oo) {
    vidhi::MarketState state(md);
    vidhi::OrderBuffer orders(oo);

    int64_t& tick_count = orders.state(0);
    int64_t& sum_price = orders.state(1);

    tick_count++;
    sum_price += (int64_t)(state.mid_price() * vidhi::FIXED_POINT);

    double sma = (sum_price / (double)tick_count) / vidhi::FIXED_POINT;

    // A simple momentum / trend-following rule:
    // If current price is strictly above SMA, buy.
    // Else, sell.
    // Only place orders if we have no open orders to prevent LOB spam.
    if (orders.order_count() == 0) {
        if (state.mid_price() > sma) {
            orders.market_buy(10);
        } else if (state.mid_price() < sma) {
            orders.market_sell(10);
        }
    }
}
"""

def main():
    print("Submitting native C++ algorithm to Vidhi Backend...")
    payload = {
        "user_id": "test_cpp_bot_1",
        "round_id": "test_contest_alpha",
    }
    files = {
        "code": ("bot.cpp", CPP_CODE.strip())
    }

    try:
        res = requests.post("http://localhost:8080/api/submit", data=payload, files=files)
        res.raise_for_status()
        data = res.json()
        print("Submission OK:", data)
        run_id = data.get("run_id")
        
        # Poll for run status
        for _ in range(20):
            time.sleep(1.0)
            status_res = requests.get(f"http://localhost:8080/api/runs/{run_id}")
            if status_res.status_code == 200:
                s_data = status_res.json()
                print(f"Status: {s_data.get('status')} | PnL: {s_data.get('pnl')} | PnL%: {s_data.get('pnl_pct')}%")
                if s_data.get('status') in ('completed', 'failed'):
                    break
                    
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e.response.status_code}")
        print(f"Response Body: {e.response.text}")
    except Exception as e:
        print("Failed to submit:", e)

if __name__ == "__main__":
    main()
