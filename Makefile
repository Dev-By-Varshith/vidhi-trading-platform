# Vidhi Arena v5.0 Makefile
# ─────────────────────────────────────────────────────────────────────────────
# Primary targets:
#   up             — build images + start all services in detached mode
#   down           — stop and remove containers
#   logs           — tail all service logs
#   reset-db       — drop + recreate DB schema
#   sandbox-build  — (re)build the hardened sandbox Docker image
#   dataset        — generate deterministic tick datasets (seed=42)
#   e2e            — run the full 6-phase end-to-end test suite
#   vet            — run go vet on the Go backend
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: up down logs reset-db sandbox-build dataset e2e vet

# ── Core lifecycle ────────────────────────────────────────────────────────────

up:
	docker-compose up --build -d
	@echo "Waiting for services to become healthy..."
	@bash tools/healthcheck.sh
	@echo "Vidhi Arena is UP!"
	@echo "  Frontend: http://localhost:5173"
	@echo "  Backend:  http://localhost:8080"

down:
	docker-compose down

logs:
	docker-compose logs -f

reset-db:
	docker-compose exec -T postgres psql -U postgres -d postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	cat backend/db/schema.sql | docker-compose exec -T postgres psql -U postgres -d postgres

# ── Sandbox image ─────────────────────────────────────────────────────────────

sandbox-build:
	@echo "[BUILD] Building hardened vidhi_sandbox:latest..."
	docker build -t vidhi_sandbox:latest -f sandbox/Dockerfile .
	@echo "[BUILD] Done. Security layers: seccomp + no-new-privs + cap-drop=ALL + userns=private + non-root USER"

# ── Tick dataset ──────────────────────────────────────────────────────────────
# Generates deterministic binary tick files used by the C++ Game Master.
# All contestants receive the same price path (seed=42).
# Output: data/ticks/public_99k.bin  (100k ticks, ~8.6MB)
#         data/ticks/eval_1m.bin     (1M ticks,  ~86MB)
#
# Re-run only if you change the generator script or want a new price path.
# The sha256 checksums are printed at the end — include them in contest docs.

dataset:
	@echo "[DATASET] Generating deterministic tick datasets (seed=42)..."
	python3 data/generate_ticks.py --seed 42
	@echo "[DATASET] Done. Files written to data/ticks/"

# ── End-to-end tests ──────────────────────────────────────────────────────────
# Requires backend to be running (make up).
# Runs 6 test phases: API key, submission, polling, pagination, round admin, leaderboard.

e2e:
	@echo "[E2E] Running end-to-end integration test suite..."
	python3 tools/test_e2e.py
	@echo "[E2E] Done."

# ── Go static analysis ────────────────────────────────────────────────────────
# Runs go vet on all backend packages. Should pass before any build.

vet:
	@echo "[VET] Running go vet on backend..."
	cd backend && go vet ./...
	@echo "[VET] Running go vet on sandbox-manager..."
	cd sandbox-manager && go vet ./...
	@echo "[VET] All checks passed."
