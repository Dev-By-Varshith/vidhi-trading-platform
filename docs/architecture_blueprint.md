# Vidhi Arena v5.0 — Architecture Blueprint

## 1. System Overview

Vidhi Arena is a high-performance algorithmic trading contest platform designed for the IICPC Prosperity hackathon. It evaluates user-submitted Python trading strategies against a set of simulated market conditions (bots) and a centralized limit order book.

The system is built on a **Dual-Phase Execution Model**:
1. **Local Mode (Browser Phase):** Rapid prototyping using a local JS execution environment for fast feedback.
2. **Backend Mode (Final Crucible):** High-precision evaluation in a secure, bare-metal containerized sandbox environment driven by a C++ Game Master and Go control plane.

## 2. Microservices Map

*   **Frontend (Vite + React):** The user interface (Lobby, Code Editor, Submissions, Leaderboard). Connects via HTTP and WebSockets.
*   **Backend (Go 1.22):** The control plane. Handles contest state, submission validation, and orchestration. Exposes REST API and WebSocket streams.
*   **Forge Pipeline (Python 3.11):** An AOT compilation pipeline. Scans AST for banned operations, transpiles dynamic Python to static types, and compiles to `.so` via Numba AOT.
*   **Game Master (C++20):** The core simulation engine. Manages the Limit Order Book, executes bots, matches orders, and records metrics. Runs directly on the host (or within the backend container) for maximum performance.
*   **Sandbox (Docker + C):** A minimal debian container running `vidhi-loader`. It `dlopen()`s the user's compiled `.so` and communicates with the Game Master via SPSC ring buffers in shared memory (`/dev/shm`).
*   **Database (PostgreSQL / TimescaleDB):** Persistent storage for contests, contestants, runs, and high-frequency tick telemetry.
*   **Queue/Cache (Redis):** Job queue for reliable Game Master dispatching and caching for the leaderboard.

## 3. Communication Protocols

*   **UI ↔ Backend (Control):** REST HTTP for form submissions, contest creation, leaderboard polling.
*   **UI ↔ Backend (Telemetry):** WebSocket (`/ws/telemetry`) streaming live JSON `TICK_TELEMETRY` from the Game Master to the frontend.
*   **Backend ↔ Worker (Job Queue):** Redis lists (`LPUSH`, `BRPOP`) with visibility timeouts and a reaper goroutine for fault tolerance.
*   **Worker ↔ Game Master (Lifecycle):** The Go worker spawns the C++ Game Master binary via `os/exec`.
*   **Game Master ↔ Worker (Results):** Game Master emits final summary as JSON to `stdout`, which Go parses. Telemetry events are piped concurrently.
*   **Game Master ↔ Sandbox (Simulation Loop):** Zero-copy SPSC (Single Producer, Single Consumer) ring buffers over `/dev/shm` (shared memory). No context switches, yielding ~150ns latency.

## 4. Execution Pipeline (The "Forge")

1.  **Scan:** Python AST scanner (`scanner.py`) detects banned imports (e.g., `os`, `socket`) and file I/O.
2.  **Transpile:** Python transpiler (`transpiler.py`) converts dynamic class definitions to `@jitclass` and injects type signatures.
3.  **Compile:** Numba AOT compiler (`forge.py`) uses LLVM to compile the Python to native machine code (`trader.so`).
4.  **Validate:** Go backend validates the ELF binary exports `on_tick__cfunc` and uses no banned glibc symbols.
5.  **Spawn:** Go spawns a minimal Docker sandbox (`vidhi-sandbox`) and mounts the `.so` and `/dev/shm`.
6.  **Run:** The C++ Game Master feeds tick data into the SPSC ring; the sandbox's `loader.c` reads the tick, calls the `.so`, and writes the orders back.

## 5. Fault Tolerance & Security

*   **Security:** User code executes natively inside an unprivileged Docker container with `NetworkMode=none` and all capabilities dropped (`CapDrop=ALL`).
*   **Fault Tolerance:** The job worker uses a heartbeat pattern. If the worker crashes mid-run, the TTL on the active key expires, and a reaper re-enqueues the job.
*   **Telemetry Drain:** The Go worker pipes telemetry to TimescaleDB using PostgreSQL's binary COPY protocol for extreme throughput.

## 6. Scoring Formula

Submissions are ranked first by **Total PnL%**, with ties broken by **p99 Latency**.
*   **PnL:** Calculated by marking the final inventory to the Last Traded Price (LTP) plus cash balance.
*   **Latency:** The time taken from the Game Master writing a tick to the sandbox, to reading the generated orders back.

## 7. Latency Budget

| Component | Target Latency | Tech Stack |
| :--- | :--- | :--- |
| **SPSC Ring Transfer (GM → Sandbox)** | < 100 ns | Lock-free atomics in `/dev/shm` |
| **Sandbox `dlopen` execution** | < 100 ns | C pointer invocation |
| **User Logic Execution** | < 10 µs | LLVM compiled (Numba) |
| **SPSC Ring Transfer (Sandbox → GM)** | < 100 ns | Lock-free atomics in `/dev/shm` |
| **Total Tick Budget** | **< 15 µs** |  |
