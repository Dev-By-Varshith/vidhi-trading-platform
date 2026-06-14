-- backend/db/schema.sql
-- TimescaleDB schema for Vidhi Arena control plane

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS contestants (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    team_name    TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
    run_id       TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
    round_id     TEXT,
    phase        TEXT NOT NULL DEFAULT 'public',
    status       TEXT NOT NULL DEFAULT 'queued',
    code_hash    TEXT NOT NULL DEFAULT '',
    pnl          DOUBLE PRECISION,
    pnl_pct      DOUBLE PRECISION,
    p50_ns       DOUBLE PRECISION,
    p90_ns       DOUBLE PRECISION,
    p99_ns       DOUBLE PRECISION,
    total_fills  BIGINT,
    total_ticks  BIGINT,
    tle_count    BIGINT,
    correctness  DOUBLE PRECISION DEFAULT 1.0,
    violations   BIGINT           DEFAULT 0,
    error_msg    TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_user_id_idx  ON runs(user_id);
CREATE INDEX IF NOT EXISTS runs_status_idx   ON runs(status);
CREATE INDEX IF NOT EXISTS runs_pnl_pct_idx  ON runs(pnl_pct DESC);
CREATE INDEX IF NOT EXISTS runs_phase_idx    ON runs(phase, status);

CREATE TABLE IF NOT EXISTS tick_telemetry (
    run_id      TEXT        NOT NULL,
    tick_id     BIGINT      NOT NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pnl         DOUBLE PRECISION,
    position    BIGINT,
    bid_price   DOUBLE PRECISION,
    ask_price   DOUBLE PRECISION,
    spread      DOUBLE PRECISION,
    last_trade  DOUBLE PRECISION,
    tick_ns     BIGINT,
    fill_count  INT
);

SELECT create_hypertable('tick_telemetry', 'ts', if_not_exists => TRUE);
SELECT add_compression_policy('tick_telemetry', INTERVAL '1 hour', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS tick_telemetry_run_idx ON tick_telemetry(run_id, ts DESC);

CREATE TABLE IF NOT EXISTS fills (
    run_id       TEXT NOT NULL,
    tick_id      BIGINT NOT NULL,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    price        DOUBLE PRECISION,
    volume       BIGINT,
    maker_bot    INT,
    taker_bot    INT,
    is_buy       BOOLEAN
);

SELECT create_hypertable('fills', 'ts', if_not_exists => TRUE);
SELECT add_compression_policy('fills', INTERVAL '1 hour', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS fills_run_idx ON fills(run_id, ts DESC);

-- Leaderboard view
-- Negative PnL demotion: (pnl_pct >= 0) DESC forces positive PnLs to the top.
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
    WITH best_runs AS (
        SELECT DISTINCT ON (user_id, round_id)
            run_id, user_id, round_id, pnl_pct, p99_ns, total_fills,
            correctness, violations, completed_at
        FROM   runs
        WHERE  status = 'complete' AND round_id IS NOT NULL
        ORDER  BY user_id, round_id, (pnl_pct >= 0) DESC, pnl_pct DESC, p99_ns ASC
    )
    SELECT
        br.user_id,
        br.round_id,
        COALESCE(c.display_name, br.user_id) AS display_name,
        COALESCE(c.team_name,    '')          AS team_name,
        br.pnl_pct,
        br.p99_ns,
        br.total_fills,
        br.correctness,
        br.violations,
        br.run_id,
        br.completed_at,
        ROW_NUMBER() OVER (PARTITION BY br.round_id ORDER BY (br.pnl_pct >= 0) DESC, br.pnl_pct DESC, br.p99_ns ASC) AS rank
    FROM best_runs br
    LEFT JOIN contestants c ON c.id = br.user_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_user_round_idx ON leaderboard(user_id, round_id);

CREATE TABLE IF NOT EXISTS credit_ledger (
    user_id   TEXT NOT NULL,
    day       DATE NOT NULL DEFAULT CURRENT_DATE,
    used      INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS contests (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    phase        TEXT NOT NULL DEFAULT 'public',
    status       TEXT NOT NULL DEFAULT 'active',
    starts_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rounds (
    id             TEXT PRIMARY KEY,
    contest_id     TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    asset_name     TEXT NOT NULL,
    bot_config     TEXT NOT NULL,
    tick_count     BIGINT NOT NULL DEFAULT 100000,
    position_limit BIGINT NOT NULL DEFAULT 1000,
    dataset_path   TEXT,
    final_dataset_path TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    starts_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

INSERT INTO contests(id, name, phase, status, ends_at)
VALUES('iicpc_2026', 'IICPC Prosperity 2026', 'public', 'active', NOW() + INTERVAL '7 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO rounds(id, contest_id, name, asset_name, bot_config, tick_count, position_limit, status)
VALUES
('round1', 'iicpc_2026', 'Round 1 - Seashells', 'SEASHELLS', 'MM:0.5,NOISE:0.5', 100000, 1000, 'active'),
('round2', 'iicpc_2026', 'Round 2 - Starfruit', 'STARFRUIT', 'MM:1.0,NOISE:1.0,MOM:0.5', 100000, 2000, 'upcoming')
ON CONFLICT(id) DO NOTHING;

-- ─── API Keys (P1 Auth) ──────────────────────────────────────────────────────
-- Keys are SHA-256 hashed before storage — we never store plaintext.
-- Key format: "vidhi_<user_id>_<random32hex>" (helps detect leaks in logs).
CREATE TABLE IF NOT EXISTS api_keys (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL UNIQUE,      -- SHA-256(plaintext_key) hex-encoded
    label       TEXT NOT NULL DEFAULT '',  -- human note e.g. "IICPC 2026 key"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ                -- NULL = never expires
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);

-- ─── runs.round_id FK constraint (P2-7) ──────────────────────────────────────
-- The runs table has round_id TEXT (no FK) which allows orphaned references.
-- Add the FK if the column isn't already constrained.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'runs_round_id_fkey'
    ) THEN
        ALTER TABLE runs
            ADD CONSTRAINT runs_round_id_fkey
            FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard;
END;
$$;

-- Trigger to automatically update round status to 'ended'
CREATE OR REPLACE FUNCTION update_round_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ends_at <= NOW() THEN
        NEW.status = 'ended';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_round_status
BEFORE UPDATE OR INSERT ON rounds
FOR EACH ROW EXECUTE FUNCTION update_round_status();

-- ============================================================================
-- The following lines were commented out instead of removed, to preserve the 
-- original schema plan. These were duplicate definitions of the tables above
-- that would cause 'relation already exists' errors in Postgres.
-- ============================================================================
--
-- -- ─── Runs ─────────────────────────────────────────────────────────────────────
-- -- Records every submission pipeline run (public or final phase)
-- CREATE TABLE IF NOT EXISTS runs (
--     run_id       TEXT PRIMARY KEY,
--     user_id      TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
--     phase        TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'final'
--     status       TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'running' | 'complete' | 'tle' | 'error'
--     code_hash    TEXT NOT NULL,                    -- SHA256 of submitted source (for .so dedup)
--     pnl          DOUBLE PRECISION,
--     pnl_pct      DOUBLE PRECISION,
--     p50_ns       DOUBLE PRECISION,
--     p90_ns       DOUBLE PRECISION,
--     p99_ns       DOUBLE PRECISION,
--     total_fills  BIGINT,
--     total_ticks  BIGINT,
--     tle_count    BIGINT,
--     error_msg    TEXT,
--     started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     completed_at TIMESTAMPTZ
-- );
-- 
-- CREATE INDEX IF NOT EXISTS runs_user_id_idx  ON runs(user_id);
-- CREATE INDEX IF NOT EXISTS runs_status_idx   ON runs(status);
-- CREATE INDEX IF NOT EXISTS runs_pnl_pct_idx  ON runs(pnl_pct DESC);
-- 
-- -- ─── Telemetry (time-series) ─────────────────────────────────────────────────
-- -- Per-tick snapshots streamed from Game Master during execution
-- -- This is a TimescaleDB hypertable for fast range queries + compression
-- CREATE TABLE IF NOT EXISTS tick_telemetry (
--     run_id      TEXT        NOT NULL,
--     tick_id     BIGINT      NOT NULL,
--     ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     pnl         DOUBLE PRECISION,
--     position    BIGINT,
--     bid_price   DOUBLE PRECISION,
--     ask_price   DOUBLE PRECISION,
--     spread      DOUBLE PRECISION,
--     last_trade  DOUBLE PRECISION,
--     tick_ns     BIGINT,         -- latency for this tick in nanoseconds
--     fill_count  INT
-- );
-- 
-- -- Convert to TimescaleDB hypertable (partitioned by ts)
-- SELECT create_hypertable('tick_telemetry', 'ts', if_not_exists => TRUE);
-- 
-- -- Compression policy: compress chunks older than 1 hour
-- SELECT add_compression_policy('tick_telemetry', INTERVAL '1 hour', if_not_exists => TRUE);
-- 
-- CREATE INDEX IF NOT EXISTS tick_telemetry_run_idx ON tick_telemetry(run_id, ts DESC);
-- 
-- -- ─── Leaderboard view ────────────────────────────────────────────────────────
-- -- Best completed run per user, for fast leaderboard queries
-- CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
--     SELECT
--         r.user_id,
--         c.display_name,
--         c.team_name,
--         r.pnl_pct,
--         r.p99_ns,
--         r.total_fills,
--         r.run_id,
--         r.completed_at,
--         ROW_NUMBER() OVER (ORDER BY r.pnl_pct DESC, r.p99_ns ASC) AS rank
--     FROM runs r
--     JOIN contestants c ON c.id = r.user_id
--     WHERE r.status = 'complete'
--       AND r.phase  = 'final'
--       AND r.pnl_pct = (
--           SELECT MAX(r2.pnl_pct)
--           FROM   runs r2
--           WHERE  r2.user_id = r.user_id AND r2.status = 'complete' AND r2.phase = 'final'
--       )
-- WITH DATA;
-- 
-- CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_user_idx ON leaderboard(user_id);
-- 
-- -- ─── Credit ledger ───────────────────────────────────────────────────────────
-- -- Tracks final-phase submission credits per user per UTC day
-- CREATE TABLE IF NOT EXISTS credit_ledger (
--     user_id   TEXT NOT NULL,
--     day       DATE NOT NULL DEFAULT CURRENT_DATE,
--     used      INT  NOT NULL DEFAULT 0,
--     PRIMARY KEY (user_id, day)
-- );
-- 
-- -- ─── Helper function: refresh leaderboard ────────────────────────────────────
-- CREATE OR REPLACE FUNCTION refresh_leaderboard()
-- RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--     REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard;
-- END;
-- $$;
