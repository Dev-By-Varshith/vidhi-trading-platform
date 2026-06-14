import requests
import websocket
import json
import time
import os
import sys
import threading

API_URL = "http://localhost:8080"
WS_URL = "ws://localhost:8080/ws/telemetry"
DUMMY_STRATEGY = os.path.join(os.path.dirname(__file__), "../backend/vidhi_sdk/dummy.py")

def wait_for_healthy():
    print("Waiting for backend to be healthy...")
    for _ in range(30):
        try:
            r = requests.get(f"{API_URL}/api/health", timeout=2)
            if r.status_code == 200:
                print("Backend is UP!")
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)
    return False

def run_e2e():
    if not wait_for_healthy():
        print("Backend failed to start.")
        sys.exit(1)

    # We need a shared state to know when the run finishes
    ws_connected = threading.Event()
    run_finished = threading.Event()
    final_result = {}
    target_run_id = [None]

    def on_message(ws, message):
        data = json.loads(message)
        if data.get("type") == "TICK_TELEMETRY":
            run_id = data.get("run_id")
            if target_run_id[0] and run_id == target_run_id[0]:
                payload = data.get("payload", {})
                if payload.get("status") == "complete":
                    final_result.update(payload)
                    run_finished.set()

    def on_open(ws):
        print("WebSocket connected.")
        ws_connected.set()

    ws = websocket.WebSocketApp(WS_URL, on_open=on_open, on_message=on_message)
    ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
    ws_thread.start()

    # Wait for ws to connect before submitting
    ws_connected.wait(timeout=5)

    print("Submitting dummy algorithm...")
    with open(DUMMY_STRATEGY, "rb") as f:
        files = {"code": ("dummy.py", f, "text/x-python")}
        data = {"user_id": "e2e_tester", "phase": "public"}
        r = requests.post(f"{API_URL}/api/submit", files=files, data=data)
        
    if r.status_code != 202:
        print(f"Submit failed: {r.text}")
        sys.exit(1)
        
    target_run_id[0] = r.json().get("run_id")
    print(f"Submitted successfully. Run ID: {target_run_id[0]}")

    print("Waiting for execution to complete (this tests the whole forge -> docker -> execution pipeline)...")
    success = run_finished.wait(timeout=60) # Wait max 60 seconds

    if success:
        print("--- E2E Test Passed ---")
        print(f"Result PnL: {final_result.get('pnl_pct')}%")
        print(f"P99 Latency: {final_result.get('p99_ns')} ns")
        sys.exit(0)
    else:
        print("--- E2E Test Failed (Timeout) ---")
        sys.exit(1)

if __name__ == "__main__":
    run_e2e()
