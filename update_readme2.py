import sys

with open('README.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Make image bigger
content = content.replace('width="300"', 'width="800"')

# 2. Append original build/setup instructions and API reference
missing_content = """

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
"""

# Insert before "From the silicon up" div, or just at the end.
insertion_point = "<div align=\"center\">\n\n**From the silicon up.**\n\n</div>"
if insertion_point in content:
    content = content.replace(insertion_point, missing_content + "\n" + insertion_point)
else:
    content += missing_content

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(content)
