// sandbox-manager/main.go
// HTTP microservice that spawns and manages Docker sandbox containers.
// Endpoints:
//   POST /spawn           — launch a contestant sandbox for a given run_id
//   POST /stop/{runID}    — force-kill a running sandbox container
//   GET  /health          — liveness check
//   GET  /pool-status     — warm pool depth and capacity metrics
//
// P0 BUG FIX: Added /stop endpoint + run_id→containerID registry so the
// job_worker can kill sandbox containers when:
//   1. The Game Master detects per-tick TLE (sm→sb_sequence stalls)
//   2. The 5-minute job timeout fires in job_worker.go
// Without this, sandbox Docker containers ran indefinitely after the GM exited.

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/mux"
)

// ─── Global run_id → containerID registry ────────────────────────────────────
// Protected by mu. Entries are added on spawn, removed on stop/exit.
var (
	containerRegistry   = make(map[string]string) // run_id → containerID
	containerRegistryMu sync.RWMutex
)

func registerContainer(runID, containerID string) {
	containerRegistryMu.Lock()
	containerRegistry[runID] = containerID
	containerRegistryMu.Unlock()
}

func lookupContainer(runID string) (string, bool) {
	containerRegistryMu.RLock()
	id, ok := containerRegistry[runID]
	containerRegistryMu.RUnlock()
	return id, ok
}

func unregisterContainer(runID string) {
	containerRegistryMu.Lock()
	delete(containerRegistry, runID)
	containerRegistryMu.Unlock()
}

// ─── Request / Response types ─────────────────────────────────────────────────
type SpawnRequest struct {
	SoPath      string `json:"so_path"`
	RunID       string `json:"run_id"`
	Phase       string `json:"phase"`
	SandboxCore string `json:"sandbox_core"`
}

type SpawnResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type StopResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// PoolStatusResponse is returned by GET /pool-status.
type PoolStatusResponse struct {
	PoolSize      int `json:"pool_size"`       // current containers waiting in pool
	Available     int `json:"available"`       // same as pool_size (alias for clarity)
	TotalCapacity int `json:"total_capacity"`  // max pool depth (PoolSize const)
}

// ─── main ─────────────────────────────────────────────────────────────────────
func main() {
	InitPool() // start warm pool

	r := mux.NewRouter()
	r.HandleFunc("/spawn", handleSpawn).Methods("POST")
	// /spawn-async: start container in background, return immediately
	r.HandleFunc("/spawn-async", handleSpawnAsync).Methods("POST")
	// /ready/{runID}: returns 200 when sandbox container is registered (started)
	r.HandleFunc("/ready/{runID}", handleReady).Methods("GET")
	r.HandleFunc("/stop/{runID}", handleStop).Methods("POST")
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}).Methods("GET")
	r.HandleFunc("/pool-status", handlePoolStatus).Methods("GET")

	port := "8081"
	log.Printf("[SANDBOX-MANAGER] Listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

// ─── POST /spawn ──────────────────────────────────────────────────────────────
func handleSpawn(w http.ResponseWriter, r *http.Request) {
	var req SpawnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sandboxCore := req.SandboxCore
	if sandboxCore == "" {
		sandboxCore = SandboxCore // fallback
	}

	err := SpawnSandbox(r.Context(), req.SoPath, req.RunID, req.Phase, sandboxCore)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		json.NewEncoder(w).Encode(SpawnResponse{Success: false, Error: err.Error()})
		return
	}
	json.NewEncoder(w).Encode(SpawnResponse{Success: true})
}

// ─── POST /spawn-async ────────────────────────────────────────────────────────
// Starts the sandbox container in the background goroutine and returns 200
// immediately. Use GET /ready/{runID} to poll until the container is registered.
func handleSpawnAsync(w http.ResponseWriter, r *http.Request) {
	var req SpawnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	sandboxCore := req.SandboxCore
	if sandboxCore == "" {
		sandboxCore = SandboxCore
	}
	// Launch in background — caller polls /ready/{runID}
	go func() {
		if err := SpawnSandbox(context.Background(), req.SoPath, req.RunID, req.Phase, sandboxCore); err != nil {
			log.Printf("[SANDBOX-MANAGER] async spawn error for run=%s: %v", req.RunID[:min(12, len(req.RunID))], err)
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(SpawnResponse{Success: true})
}

// ─── GET /ready/{runID} ───────────────────────────────────────────────────────
// Returns 200 when the sandbox container is registered in the registry
// (i.e. it has been created and started). Returns 202 if not yet ready.
func handleReady(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["runID"]
	if runID == "" {
		http.Error(w, "missing runID", http.StatusBadRequest)
		return
	}
	_, ok := lookupContainer(runID)
	w.Header().Set("Content-Type", "application/json")
	if ok {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"ready": true})
	} else {
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]bool{"ready": false})
	}
}

// ─── POST /stop/{runID} ───────────────────────────────────────────────────────
// Force-kills the sandbox container for a given run_id.
// Called by job_worker.go when:
//   - The Game Master process exits (normal cleanup)
//   - The 5-minute job timeout fires (TLE hard kill)
func handleStop(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["runID"]
	if runID == "" {
		http.Error(w, "missing runID", http.StatusBadRequest)
		return
	}

	containerID, ok := lookupContainer(runID)
	if !ok {
		// Already stopped or never started — not an error
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(StopResponse{Success: true})
		return
	}

	log.Printf("[SANDBOX-MANAGER] /stop request for run=%s container=%s", runID[:min(12, len(runID))], containerID[:min(12, len(containerID))])

	if err := killContainer(context.Background(), containerID); err != nil {
		log.Printf("[SANDBOX-MANAGER] killContainer error for %s: %v", runID[:min(12, len(runID))], err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(StopResponse{Success: false, Error: err.Error()})
		return
	}

	unregisterContainer(runID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StopResponse{Success: true})
}

// ─── GET /pool-status ─────────────────────────────────────────────────────────
// Returns real-time pool depth so the orchestrator can monitor warm sandbox
// availability. A depth of 0 means all future spawns will cold-start (slower).
//
// Example response:
//
//	{"pool_size": 15, "available": 15, "total_capacity": 20}
func handlePoolStatus(w http.ResponseWriter, r *http.Request) {
	depth := len(warmPool) // non-blocking snapshot of buffered channel length
	resp := PoolStatusResponse{
		PoolSize:      depth,
		Available:     depth,
		TotalCapacity: PoolSize,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
