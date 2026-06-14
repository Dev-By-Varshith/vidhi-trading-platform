import requests
import json
import time
import os
import sys

API_URL = "http://localhost:8080"
DUMMY_STRATEGY = os.path.join(os.path.dirname(__file__), "../backend/vidhi_sdk/dummy.py")

def register_user(user_id, display_name):
    print(f"\n--- Registering user: {user_id} ---")
    data = {
        "user_id": user_id,
        "display_name": display_name,
        "team_name": "Team Alpha",
        "label": "Final Contest Key"
    }
    r = requests.post(f"{API_URL}/api/apikey", json=data)
    r.raise_for_status()
    resp = r.json()
    print(f"Got API Key: {resp.get('api_key')}")
    return resp.get("api_key")

def create_contest(headers):
    print("\n--- Creating Final Contest ---")
    data = {
        "name": "IICPC Final Global Contest",
        "tick_count": 0,
        "phase": "finals"
    }
    r = requests.post(f"{API_URL}/api/contests", json=data, headers=headers)
    r.raise_for_status()
    resp = r.json()
    contest_id = resp.get("id")
    print(f"Created Contest ID: {contest_id}")
    return contest_id

def create_round(headers, contest_id, name, asset_name, tick_count):
    print(f"\n--- Creating Round: {name} ({tick_count} ticks) ---")
    data = {
        "contest_id": contest_id,
        "name": name,
        "asset_name": asset_name,
        "bot_config": "MM:1.0,MOM:1.0,MR:1.0,NOISE:1.0,SNIPER:1.0",
        "tick_count": tick_count,
        "position_limit": 1000
    }
    r = requests.post(f"{API_URL}/api/rounds", json=data, headers=headers)
    r.raise_for_status()
    resp = r.json()
    round_id = resp.get("round_id")
    print(f"Created Round ID: {round_id}")
    return round_id

def submit_code(headers, round_id, user_id):
    print(f"\n--- Submitting code to Round: {round_id} ---")
    with open(DUMMY_STRATEGY, "rb") as f:
        files = {"code": ("dummy.py", f, "text/x-python")}
        # the api /api/submit now takes user_id from X-API-Key, but we pass round_id in data
        data = {"round_id": round_id}
        r = requests.post(f"{API_URL}/api/submit", files=files, data=data, headers=headers)
        
    if r.status_code != 202:
        print(f"Submit failed: {r.status_code} {r.text}")
        sys.exit(1)
        
    run_id = r.json().get("run_id")
    print(f"Submitted successfully. Run ID: {run_id}")
    return run_id

def poll_run(headers, run_id):
    print(f"Polling for run {run_id} completion...")
    for _ in range(120): # Max 2 mins
        r = requests.get(f"{API_URL}/api/runs/{run_id}", headers=headers)
        if r.status_code == 200:
            data = r.json()
            status = data.get("status")
            print(f"Status: {status} | PnL: {data.get('pnl_pct')}%")
            if status in ["complete", "failed"]:
                return data
        else:
            print(f"Polling error: {r.status_code} {r.text}")
        time.sleep(2)
    print("Timeout waiting for run.")
    sys.exit(1)

def run_e2e_contest_flow():
    # 1. Get API Key
    user_id = "pro_trader_1"
    api_key = register_user(user_id, "Pro Trader")
    headers = {"X-API-Key": api_key}
    
    # 2. Create Contest
    contest_id = create_contest(headers)
    
    # 3. Create Public Round (99.9k ticks)
    public_round_id = create_round(headers, contest_id, "Public Phase", "public_99k", 99900)
    
    # 4. Create Private Round (999.99k ticks)
    private_round_id = create_round(headers, contest_id, "Private Phase (Finals)", "private_999k", 999990)
    
    # 5. Submit to Public Round
    print("\n==============================================")
    print("STAGE 1: TESTING ON PUBLIC DATA (99.9k ticks)")
    print("==============================================")
    pub_run_id = submit_code(headers, public_round_id, user_id)
    pub_result = poll_run(headers, pub_run_id)
    
    print("\n>>> PUBLIC ROUND RESULTS <<<")
    print(f"PnL %: {pub_result.get('pnl_pct')}%")
    print(f"P99 Latency: {pub_result.get('p99_ns')} ns")
    print(f"Correctness: {pub_result.get('correctness')}")
    print(f"Total Fills: {pub_result.get('total_fills')}")
    
    # 6. Submit to Private Round
    print("\n==============================================")
    print("STAGE 2: TESTING ON PRIVATE DATA (999.99k ticks)")
    print("==============================================")
    priv_run_id = submit_code(headers, private_round_id, user_id)
    priv_result = poll_run(headers, priv_run_id)
    
    print("\n>>> PRIVATE ROUND (FINAL) RESULTS <<<")
    print(f"PnL %: {priv_result.get('pnl_pct')}%")
    print(f"P99 Latency: {priv_result.get('p99_ns')} ns")
    print(f"Correctness: {priv_result.get('correctness')}")
    print(f"Total Fills: {priv_result.get('total_fills')}")
    
    print("\n--- CONTEST SIMULATION COMPLETE ---")

if __name__ == "__main__":
    # Wait a moment to ensure backend is accessible if needed, but here we just run it directly.
    try:
        requests.get(f"{API_URL}/api/health")
    except:
        print("Backend is not running at http://localhost:8080. Please start the backend/docker-compose first.")
        sys.exit(1)
        
    run_e2e_contest_flow()
