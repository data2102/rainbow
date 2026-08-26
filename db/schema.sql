-- r6rank.co.kr / LADDER ZONE 스키마
-- Postgres 13+ 기준

CREATE TABLE IF NOT EXISTS players (
  handle      TEXT PRIMARY KEY,
  clan        TEXT NOT NULL DEFAULT '-',
  name        TEXT NOT NULL,
  point       INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,
  last_match  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id          BIGSERIAL PRIMARY KEY,
  winners     JSONB NOT NULL,   -- [{handle, gained}]
  losers      JSONB NOT NULL,   -- ["handle", ...]
  ts          BIGINT NOT NULL,  -- epoch ms
  recorded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_ts ON matches (ts DESC);

CREATE TABLE IF NOT EXISTS admins (
  id           TEXT PRIMARY KEY,
  pw_hash      TEXT NOT NULL,
  must_change  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('add','remove')),
  new_id       TEXT,
  new_clan     TEXT,
  target_id    TEXT,
  requested_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- 감사 로그(누가 무엇을 했는지)
CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGSERIAL PRIMARY KEY,
  admin_id  TEXT,
  action    TEXT NOT NULL,
  detail    JSONB,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);
