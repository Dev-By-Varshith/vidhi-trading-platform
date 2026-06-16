#!/usr/bin/env python3
import requests
import time
import sys
import json
import random
import string

API = "http://localhost:8080/api"

PAYLOADS = {
    "Happy Path (SMA)": """
#include <iostream>
extern "C" void on_tick__cfunc() {
    // Happy path, no malicious behavior
}
""",
    "OOM Bomb (Cgroups)": """
#include <vector>
extern "C" void on_tick__cfunc() {
    std::vector<int*> leak;
    while(true) {
        leak.push_back(new int[1024 * 1024]); // Allocate 4MB chunks indefinitely
    }
}
""",
    "Network Socket (Seccomp-BPF)": """
#include <unistd.h>
#include <sys/syscall.h>
extern "C" void on_tick__cfunc() {
    // Bypass ELF static 'socket' symbol check by invoking the raw syscall.
    // The Seccomp-BPF filter will catch this dynamically and SIGKILL.
    syscall(SYS_socket, 2, 1, 0);
}
""",
    "Infinite Loop (Watchdog TLE)": """
extern "C" void on_tick__cfunc() {
    while(true) {
        // TLE Watchdog will trigger
    }
}
"""
}

def provision_user():
    uid = "e2e_poison_" + ''.join(random.choices(string.ascii_lowercase, k=6))
    display = "Poison Tester " + uid

    prov = requests.post(f"{API}/apikey", json={
        "user_id": uid,
        "display_name": display,
        "team_name": "QA_Sec",
        "label": "e2e"
    })
    if not prov.ok:
        print(f"Key provision failed: {prov.status_code}")
        return None, None
    
    api_key = prov.json().get("api_key") or prov.json().get("key")
    headers = {"X-API-Key": api_key}
    
    requests.post(f"{API}/contestants", json={
        "user_id": uid, "display_name": display, "team_name": "QA_Sec"
    }, headers=headers)
    
    return uid, headers

def run_test(name, code, uid, headers):
    print(f"\n==================================================")
    print(f"[*] INJECTING: {name}")
    print(f"==================================================")
    
    files = {"code": ("trader.cpp", code, "text/x-c++src")}
    data = {"user_id": uid, "round_id": "round1"}
    
    resp = requests.post(f"{API}/submit", files=files, data=data, headers=headers)
    if not resp.ok:
        print(f"[ERROR] Submit failed: {resp.status_code} {resp.text}")
        return False
        
    run_id = resp.json().get("run_id")
    print(f"[*] Submitted! Run ID: {run_id}. Polling for completion...")

    start = time.time()
    last_status = None
    
    while time.time() - start < 120:
        poll = requests.get(f"{API}/runs/{run_id}", headers=headers)
        if poll.ok:
            run = poll.json()
            status = run.get("status")
            if status != last_status:
                print(f"  -> State transition: {status}")
                last_status = status
            
            if status in ("complete", "error", "tle", "sigkill", "oom"):
                print(f"\n[RESULT] Finished with status: {status.upper()}")
                print(f"         TLE Count: {run.get('tle_count', 0)}")
                print(f"         Violations: {run.get('violations', 0)}")
                if run.get("error"):
                    print(f"         Error Msg: {run.get('error')}")
                return True
        time.sleep(1)
        
    print("[TIMEOUT] Test hung indefinitely!")
    return False

if __name__ == "__main__":
    uid, headers = provision_user()
    if not uid:
        sys.exit(1)
        
    print(f"Provisioned Test User: {uid}")
    
    for name, code in PAYLOADS.items():
        run_test(name, code, uid, headers)
        time.sleep(2)
        
    print("\n[OK] All Poison Pills Administered. Check the Frontend UI to verify rendering!")
