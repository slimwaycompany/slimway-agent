-- SlimWay Agent — Supabase schema
-- Run this in the Supabase SQL editor once.

-- Tracks the current agent state per lead (one row per lead)
CREATE TABLE IF NOT EXISTS agent_state (
  lead_id      BIGINT PRIMARY KEY,
  stage_id     INT NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_logged_fingerprint TEXT NOT NULL DEFAULT '',
  open_task_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup guard: one action per (lead_id, action_key)
-- action_key format: "<registration_id>|<eventStart.getTime()>"
CREATE TABLE IF NOT EXISTS agent_acted (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    BIGINT NOT NULL,
  action_key TEXT NOT NULL,
  action     TEXT NOT NULL,
  acted_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, action_key)
);

-- Full event log (Realtime enabled below)
CREATE TABLE IF NOT EXISTS agent_events (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  job         TEXT NOT NULL,
  type        TEXT NOT NULL,
  lead_id     BIGINT,
  short_name  TEXT,
  text        TEXT,
  meta        JSONB,
  dry         BOOLEAN NOT NULL DEFAULT FALSE
);

-- Run history and stats
CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGSERIAL PRIMARY KEY,
  job         TEXT NOT NULL,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  stats       JSONB,
  error       TEXT
);

-- Distributed lock: prevents concurrent execution of the same job
CREATE TABLE IF NOT EXISTS job_locks (
  job          TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL
);

-- General key-value store (mail cooldowns, etc.)
CREATE TABLE IF NOT EXISTS agent_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_lead_id    ON agent_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_acted_lead_id     ON agent_acted(lead_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_started_at     ON job_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job            ON job_runs(job);

-- Enable Realtime for agent_events
-- (Realtime → agent_events must be enabled in the Supabase dashboard too)
ALTER PUBLICATION supabase_realtime ADD TABLE agent_events;
