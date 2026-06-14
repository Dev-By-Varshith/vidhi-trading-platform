# Vidhi Arena v5.0

Vidhi Arena is a high-performance, containerized algorithmic trading simulation platform designed for the IICPC Prosperity hackathon. It evaluates user-submitted Python trading algorithms against an unyielding C++ Game Master and Limit Order Book (LOB) with extreme precision.

## Architecture

*   **Frontend**: React + Vite (Local JS simulation and interactive dashboard).
*   **Backend**: Go 1.22 (HTTP/WebSocket API, Redis job queue).
*   **Forge Pipeline**: Python 3.11 (AST Scanning, Type Transpilation, Numba AOT Compilation).
*   **Game Master**: C++20 (Bare-metal LOB simulation, lock-free SPSC rings over `/dev/shm`).
*   **Sandbox Manager**: Go (Microservice maintaining a warm pool of 20 secure Docker containers).
*   **Infrastructure**: PostgreSQL (State), TimescaleDB (Tick telemetry), Redis (Queues & pub/sub).
*   **Datasets**: Apache Arrow generated binaries (`SEASHELLS.bin`, `STARFRUIT.bin`) for zero-copy memory mapping.
*   **SDK**: The `vidhi_sdk` provides the API and type stubs for Python development.

Please refer to `docs/architecture_blueprint.md` for a comprehensive design overview, and `backend/vidhi_sdk/README.md` for contestant usage instructions.

## Setup Instructions (IaC)

Prerequisites:
- Docker Desktop (or Docker Engine + docker-compose)
- Node.js (for local frontend dev)
- Make

### Quick Start

Bring up the entire backend stack (Go API, Postgres, Redis, Worker):

```bash
make up
```

This will:
1. Build the multi-stage Docker image (compiling the C++ Game Master).
2. Start PostgreSQL and Redis.
3. Start the Go backend API.
4. Block until all services are healthy (using `tools/healthcheck.sh`).

### Service URLs

| Service | URL |
| :--- | :--- |
| **Frontend UI** | `http://localhost:5173` |
| **Backend API** | `http://localhost:8080/api` |
| **WebSocket** | `ws://localhost:8080/ws/telemetry` |

### Database Reset

To completely reset the Postgres schema:

```bash
make reset-db
```

### Sandbox Image

The system uses a highly restricted Docker image to run user code safely. To rebuild the sandbox image:

```bash
make build-sandbox
```

## API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | GET | Health check. Returns status of DB and Redis. |
| `/api/contestants` | POST | Register or update a student/team. |
| `/api/contests` | GET | List active contests. |
| `/api/contests` | POST | Admin: Create a new contest. |
| `/api/credits` | GET | Check remaining runs for today. |
| `/api/submit` | POST | Submit Python code to the Forge pipeline. |
| `/api/runs/{id}` | GET | Poll the status of a specific run. |
| `/api/leaderboard` | GET | Top submissions across the platform. |
| `/ws/telemetry` | WS | Subscribe to live `TICK_TELEMETRY` JSON stream. |
