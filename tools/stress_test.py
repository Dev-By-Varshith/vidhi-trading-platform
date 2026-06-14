import sys
import time
import requests
import argparse
import threading
import concurrent.futures

# Dummy algorithm code
CODE = """
from vidhi_sdk import *

def on_tick(state, orders):
    if state.tick_count == 0:
        state.ema_fast = state.mid_price
        state.ema_slow = state.mid_price

    state.ema_fast = 0.95 * state.ema_fast + 0.05 * state.mid_price
    state.ema_slow = 0.99 * state.ema_slow + 0.01 * state.mid_price
    
    signal = state.ema_fast - state.ema_slow
    
    if signal > 0.05 and state.position < 100:
        orders.market_buy(10)
    elif signal < -0.05 and state.position > -100:
        orders.market_sell(10)
"""

def submit_and_wait(user_id, api_url):
    print(f"[{user_id}] Submitting...")
    start_time = time.time()
    
    try:
        res = requests.post(
            f"{api_url}/api/submit",
            files={"code": ("trader.py", CODE.encode('utf-8'))},
            data={"user_id": user_id, "phase": "public", "round_id": "round1"},
            timeout=10
        )
        res.raise_for_status()
        run_id = res.json()["run_id"]
        print(f"[{user_id}] Got run_id: {run_id}. Polling...")
        
        while True:
            time.sleep(1.0)
            poll_res = requests.get(f"{api_url}/api/runs/{run_id}", timeout=5)
            if poll_res.status_code != 200:
                continue
                
            data = poll_res.json()
            status = data.get("status")
            
            if status == "complete":
                elapsed = time.time() - start_time
                pnl = data.get("pnl_pct", 0)
                print(f"[{user_id}] SUCCESS in {elapsed:.1f}s | PnL: {pnl:.2f}% | p50: {data.get('p50_ns')}ns")
                return True
            elif status in ["error", "tle"]:
                print(f"[{user_id}] FAILED: {status} | {data.get('error_msg')}")
                return False
                
            if time.time() - start_time > 120:
                print(f"[{user_id}] TIMEOUT")
                return False

    except Exception as e:
        print(f"[{user_id}] EXCEPTION: {e}")
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=10, help="Number of concurrent users")
    parser.add_argument("--url", type=str, default="http://localhost:8080", help="API URL")
    args = parser.parse_args()
    
    print(f"Starting Stress Test: {args.concurrency} concurrent submissions against {args.url}")
    t0 = time.time()
    
    success_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = []
        for i in range(args.concurrency):
            user_id = f"stress_user_{i}"
            futures.append(executor.submit(submit_and_wait, user_id, args.url))
            
        for future in concurrent.futures.as_completed(futures):
            if future.result():
                success_count += 1
                
    total_time = time.time() - t0
    print(f"\n--- STRESS TEST COMPLETE ---")
    print(f"Total time: {total_time:.1f}s")
    print(f"Success rate: {success_count}/{args.concurrency} ({(success_count/args.concurrency)*100:.1f}%)")
    
if __name__ == "__main__":
    main()
