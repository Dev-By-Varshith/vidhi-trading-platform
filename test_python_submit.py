import requests
import time
import json

def submit_code():
    url = "http://localhost:8080/api/submit"
    with open("bot.py", "r") as f:
        code = f.read()

    data_payload = {
        "user_id": "test_user_py",
        "round_id": "round1",
        "language": "python"
    }

    try:
        response = requests.post(url, data=data_payload, files={"code": ("bot.py", code)})
        response.raise_for_status()
        data = response.json()
        print(f"Submission OK: {data}")
        return data["run_id"]
    except requests.exceptions.RequestException as e:
        print(f"Submission failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(e.response.text)
        return None

def poll_run(run_id):
    url = f"http://localhost:8080/api/runs/{run_id}"
    while True:
        try:
            resp = requests.get(url)
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status", "unknown")
            pnl = data.get("pnl", 0)
            pnl_pct = data.get("pnl_pct", 0)
            
            print(f"Status: {status} | PnL: {pnl} | PnL%: {pnl_pct}%")
            if status in ["complete", "failed"]:
                break
            time.sleep(1)
        except Exception as e:
            print(f"Polling error: {e}")
            break

if __name__ == "__main__":
    print("Submitting native Python algorithm to Vidhi Backend...")
    run_id = submit_code()
    if run_id:
        poll_run(run_id)
