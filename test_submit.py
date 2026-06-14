#!/usr/bin/env python3
"""Quick E2E test: submit aggressive_bot.py and poll the result."""
import requests
import time
import sys
import json
import random
import string

API = "http://localhost:3000/api"

def test():
    # Use a unique user per run to avoid hitting daily rate limit
    uid = "e2e_" + ''.join(random.choices(string.ascii_lowercase, k=8))
    display = "E2E Test " + uid

    # Provision API key — server generates and returns the key
    prov = requests.post(f"{API}/apikey", json={
        "user_id": uid,
        "display_name": display,
        "team_name": "DevTest",
        "label": "e2e"
    })
    if not prov.ok:
        print(f"Key provision failed: {prov.status_code} {prov.text[:200]}")
        return False
    
    prov_data = prov.json()
    api_key = prov_data.get("api_key") or prov_data.get("key")
    if not api_key:
        print(f"No api_key in response: {prov_data}")
        return False
    print(f"Provisioned user={uid} key={api_key[:20]}...")

    headers = {"X-API-Key": api_key}

    # Register contestant (may already exist from apikey call)
    reg = requests.post(f"{API}/contestants", json={
        "user_id": uid, "display_name": display, "team_name": "DevTest"
    }, headers=headers)
    print(f"Register: {reg.status_code} {reg.text[:80]}")

    # Read the aggressive bot code
    with open("aggressive_bot.py", "r") as f:
        code = f.read()

    # Submit
    files = {"code": ("trader.py", code, "text/x-python")}
    data = {"user_id": uid, "round_id": "round1"}
    resp = requests.post(f"{API}/submit", files=files, data=data, headers=headers)
    if not resp.ok:
        print(f"Submit failed: {resp.status_code} {resp.text}")
        return False

    result = resp.json()
    run_id = result.get("run_id")
    print(f"Submitted! run_id={run_id} status={result.get('status')}")

    # Poll for up to 10 minutes
    start = time.time()
    last_status = None
    while time.time() - start < 600:
        poll = requests.get(f"{API}/runs/{run_id}", headers=headers)
        if poll.ok:
            run = poll.json()
            status = run.get("status")
            total_ticks = run.get("total_ticks", 0)
            tle_count = run.get("tle_count", 0)
            pnl_pct = run.get("pnl_pct", 0)
            if status != last_status:
                print(f"  [{int(time.time()-start)}s] Status: {status} | ticks: {total_ticks} | TLEs: {tle_count} | PnL: {pnl_pct:.4f}%")
                last_status = status
            if status in ("complete", "error", "tle"):
                print(f"\nFinal result:")
                print(json.dumps(run, indent=2))
                if tle_count > 0 and tle_count == total_ticks:
                    print(f"\n[FAIL] ALL TICKS TIMED OUT! Sandbox SHM race still present.")
                    return False
                elif tle_count > 0:
                    print(f"\n[WARN] {tle_count}/{total_ticks} TLEs (partial - some orders went through)")
                else:
                    print(f"\n[PASS] NO TLEs! Simulation ran correctly. PnL: {pnl_pct:.4f}%")
                return True
        time.sleep(3)
    
    print("TIMEOUT: run never completed")
    return False

if __name__ == "__main__":
    ok = test()
    sys.exit(0 if ok else 1)
