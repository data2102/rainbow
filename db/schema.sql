-- r6rank.co.kr / LADDER ZONE 스키마
-- Postgres 13+ 기준

-- 선수 명단이 곧 로그인 계정이다.
-- 권한은 member(일반) < admin(관리자) < master(마스터) 셋뿐이다.
CREATE TABLE IF NOT EXISTS players (
  handle      TEXT PRIMARY KEY,
  clan        TEXT NOT NULL DEFAULT '-',
  name        TEXT NOT NULL,
  email       TEXT,
  pw_hash     TEXT,
  role        TEXT NOT NULL DEFAULT 'member',
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
  recorded_by TEXT,
  season      TEXT              -- 속한 시즌 id. 시즌 제도 이전 기록은 NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_ts ON matches (ts DESC);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches (season, ts DESC);

-- 시즌(월간 리셋). 한국 시각 매월 1일 00시에 넘어가며,
-- 첫 시즌만 예외로 2026-08-27 ~ 2026-09-30 이다. 규칙은 api/_season.js 에 있다.
CREATE TABLE IF NOT EXISTS seasons (
  id         TEXT PRIMARY KEY,   -- '2026-09', '2026-10' ...
  label      TEXT NOT NULL,
  starts_at  BIGINT NOT NULL,    -- epoch ms
  ends_at    BIGINT NOT NULL,    -- epoch ms (이 시각은 다음 시즌에 속한다)
  closed_at  BIGINT              -- 마감된 시즌만 값이 있다
);

-- 시즌이 끝나는 순간의 최종 순위를 그대로 저장한다.
CREATE TABLE IF NOT EXISTS season_standings (
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  handle    TEXT NOT NULL,
  clan      TEXT NOT NULL,
  point     INTEGER NOT NULL,
  wins      INTEGER NOT NULL,
  losses    INTEGER NOT NULL,
  PRIMARY KEY (season_id, handle)
);

-- 출퇴근 기록. 한 번의 출근~퇴근이 한 줄이고, 퇴근 전이면 clock_out 이 비어 있다.
CREATE TABLE IF NOT EXISTS attendance (
  id        BIGSERIAL PRIMARY KEY,
  handle    TEXT NOT NULL,
  season    TEXT,             -- 속한 시즌 id
  clock_in  BIGINT NOT NULL,  -- epoch ms
  clock_out BIGINT
);
CREATE INDEX IF NOT EXISTS idx_attendance_season ON attendance (season, clock_in DESC);
-- 한 사람이 동시에 두 번 출근 상태가 되는 것을 막는다
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open
  ON attendance (handle) WHERE clock_out IS NULL;

-- 접속 예상 시간대. 스케줄은 매일 달라지므로 하루 단위로 쌓는다.
-- 하루는 한국 시각 07:00 에 넘어간다 (00:00~06:59 는 아직 전날).
CREATE TABLE IF NOT EXISTS play_schedule (
  day    TEXT NOT NULL,      -- 'YYYY-MM-DD' (07시 기준)
  handle TEXT NOT NULL,
  slot   INTEGER NOT NULL,   -- 6,7,8,9,10,11,12,1 (6시대 ~ 1시대)
  PRIMARY KEY (day, handle, slot)
);

CREATE TABLE IF NOT EXISTS admins (
  id           TEXT PRIMARY KEY,
  pw_hash      TEXT NOT NULL,
  must_change  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 대소문자만 다른 관리자 ID 를 막는다. 로그인은 대소문자를 가리지 않기 때문이다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_lower_id ON admins (lower(id));

CREATE TABLE IF NOT EXISTS requests (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('add','remove')),
  new_id       TEXT,
  new_clan     TEXT,
  email        TEXT,
  target_id    TEXT,
  requested_at BIGINT NOT NULL
);

-- 로그인 세션. admin_id 는 players.handle 을 가리킨다 (이름은 예전 그대로 둔다).
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL,
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

-- 대회(토너먼트) 경기 기록. 개인 래더 점수와는 완전히 분리된 팀 단위 기록이다.
CREATE TABLE IF NOT EXISTS tournament_matches (
  id          BIGSERIAL PRIMARY KEY,
  stage       TEXT NOT NULL CHECK (stage IN ('group','final')),  -- 예선 / 본선
  team_a      TEXT NOT NULL,
  team_b      TEXT NOT NULL,
  winner      TEXT NOT NULL,   -- team_a 또는 team_b 와 같아야 한다
  note        TEXT,            -- 본선 라운드 메모 (예: 승자조 1차전)
  ts          BIGINT NOT NULL,
  recorded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tmatches_ts ON tournament_matches (ts DESC);

-- 기능 개선 게시판. 로그인한 회원이 글을 쓰고, 글쓴이가 수정한다.
-- 삭제는 글쓴이와 관리자가 할 수 있다.
-- pw_hash 는 4자리 비밀번호로 글을 지키던 시절의 값이라 새 글에는 들어가지 않는다.
CREATE TABLE IF NOT EXISTS posts (
  id         BIGSERIAL PRIMARY KEY,
  author     TEXT NOT NULL,
  pw_hash    TEXT,
  body       TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

-- 게시판 댓글. 글이 지워지면 댓글도 함께 사라진다.
CREATE TABLE IF NOT EXISTS post_comments (
  id         BIGSERIAL PRIMARY KEY,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  pw_hash    TEXT,
  body       TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (post_id, created_at);

-- 런쳐. 1~8번방, 방마다 최대 16명.
-- 방장은 따로 두지 않는다. 그 방에 가장 먼저 들어온 사람이 방장이고,
-- 나가면 다음 사람에게 저절로 넘어간다.
CREATE TABLE IF NOT EXISTS room_members (
  room      INTEGER NOT NULL,
  handle    TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  PRIMARY KEY (room, handle)
);
-- 한 사람이 두 방에 동시에 있을 수는 없다
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_one ON room_members (handle);

CREATE TABLE IF NOT EXISTS room_state (
  room       INTEGER PRIMARY KEY,
  running    BOOLEAN NOT NULL DEFAULT false,
  started_at BIGINT,
  started_by TEXT
);

-- 방 안의 대화. handle 이 비어 있으면 시스템 알림이다.
CREATE TABLE IF NOT EXISTS room_messages (
  id     BIGSERIAL PRIMARY KEY,
  room   INTEGER NOT NULL,
  handle TEXT,
  body   TEXT NOT NULL,
  ts     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_msg ON room_messages (room, id);
