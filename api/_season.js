/* =============================================================
   시즌(월간 리셋) 규칙
   -------------------------------------------------------------
   · 시즌은 한국 시각(KST, UTC+9) 매월 1일 00시에 바뀐다.
   · 첫 시즌만 예외로 2026-08-27 00:00 ~ 2026-10-01 00:00 (8/27~9/30) 이다.
   · 시즌이 끝나면 그 시점의 랭킹을 season_standings 에 그대로 저장하고,
     players 의 점수·승·패·연승을 0 으로 되돌린다. 명단 자체는 지우지 않는다.
   · 넘김(rollover)은 별도 스케줄러 없이, 시즌이 끝난 뒤 처음 들어온 요청이
     처리한다. 동시에 여러 요청이 들어와도 한 번만 넘어가도록 잠금을 건다.
   ============================================================= */

import { q, tx } from './_lib.js';

const KST = 9 * 60 * 60 * 1000;

/** 시즌 넘김 잠금에 쓰는 고정 키 (pg_advisory_xact_lock) */
const LOCK_KEY = 8_270_926;

/** 예외 규정으로 잡은 첫 시즌 */
const FIRST_SEASON = {
  id: '2026-09',
  label: '2026년 8월 27일 ~ 9월 30일',
  startsAt: Date.UTC(2026, 7, 27) - KST,  // 2026-08-27 00:00 KST
  endsAt:   Date.UTC(2026, 9, 1) - KST,   // 2026-10-01 00:00 KST
};

function pad2(n) { return String(n).padStart(2, '0'); }

/** epoch ms 를 한국 시각 기준 연/월로 나눈다 */
function kstYearMonth(ms) {
  const d = new Date(ms + KST);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** 한국 시각 기준 그 달 1일 00시의 epoch ms */
function kstMonthStart(y, m) {
  return Date.UTC(y, m - 1, 1) - KST;
}

/**
 * 그 시각이 속한 시즌. 첫 시즌 시작 전이면 null 을 준다.
 * (시즌 제도를 도입하기 전에 쌓인 기록이 여기에 해당한다)
 */
export function seasonFor(ms) {
  if (ms < FIRST_SEASON.startsAt) return null;
  if (ms < FIRST_SEASON.endsAt) return { ...FIRST_SEASON };

  const { y, m } = kstYearMonth(ms);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    id: `${y}-${pad2(m)}`,
    label: `${y}년 ${m}월`,
    startsAt: kstMonthStart(y, m),
    endsAt: kstMonthStart(ny, nm),
  };
}

let ensuredTables = false;
async function ensureTables(c) {
  if (ensuredTables) return;
  await c.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      starts_at  BIGINT NOT NULL,
      ends_at    BIGINT NOT NULL,
      closed_at  BIGINT
    )`);
  await c.query(`
    CREATE TABLE IF NOT EXISTS season_standings (
      season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      rank      INTEGER NOT NULL,
      handle    TEXT NOT NULL,
      clan      TEXT NOT NULL,
      point     INTEGER NOT NULL,
      wins      INTEGER NOT NULL,
      losses    INTEGER NOT NULL,
      PRIMARY KEY (season_id, handle)
    )`);
  await c.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS season TEXT`);
  await c.query(`CREATE INDEX IF NOT EXISTS idx_matches_season ON matches (season, ts DESC)`);
  ensuredTables = true;
}

/** players 의 성적만 0 으로 되돌린다. 명단·클랜은 그대로 둔다. */
async function resetPlayers(c) {
  await c.query(
    `UPDATE players SET point = 0, wins = 0, losses = 0, streak = 0,
            last_result = NULL, last_match = NULL`
  );
}

/** 끝난 시즌의 최종 순위를 그대로 저장해 둔다 */
async function snapshot(c, seasonId) {
  await c.query(`DELETE FROM season_standings WHERE season_id = $1`, [seasonId]);
  await c.query(
    `INSERT INTO season_standings (season_id, rank, handle, clan, point, wins, losses)
     SELECT $1,
            row_number() OVER (ORDER BY point DESC, wins DESC, handle ASC),
            handle, clan, point, wins, losses
       FROM players
      WHERE wins + losses > 0`,
    [seasonId]
  );
}

/**
 * 지금이 속한 시즌을 보장한다. 필요하면 지난 시즌을 마감하고 성적을 리셋한다.
 * 트랜잭션 안에서 호출해야 한다. 넘어간 시즌 목록과 현재 시즌을 돌려준다.
 */
export async function ensureSeason(c, now = Date.now()) {
  await ensureTables(c);
  await c.query(`SELECT pg_advisory_xact_lock($1)`, [LOCK_KEY]);

  const target = seasonFor(now);
  // 첫 시즌 시작 전이라면 아직 시즌 제도를 켜지 않는다
  if (!target) return { current: null, closed: [] };

  const { rows: open } = await c.query(
    `SELECT * FROM seasons WHERE closed_at IS NULL ORDER BY starts_at DESC LIMIT 1`
  );
  const closed = [];

  if (!open.length) {
    // 시즌 제도를 처음 켜는 순간. 이전 기록은 어느 시즌에도 넣지 않고,
    // 성적만 0 으로 되돌려 새 시즌을 빈 상태에서 시작한다.
    const { rows: any } = await c.query(`SELECT 1 FROM seasons LIMIT 1`);
    if (!any.length) await resetPlayers(c);
    await c.query(
      `INSERT INTO seasons (id, label, starts_at, ends_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [target.id, target.label, target.startsAt, target.endsAt]
    );
    return { current: target, closed };
  }

  // 여기서도 id 가 아니라 기간으로 판단한다 (syncSeason 의 빠른 경로와 같은 이유)
  const cur = rowToSeason(open[0]);
  if (now >= cur.startsAt && now < cur.endsAt) {
    return { current: cur, closed };
  }

  // 지난 시즌(들)을 차례로 마감한다. 한 달 넘게 아무도 안 들어와도 순서가 지켜진다.
  // 조건을 "끝난 시즌인가"로 두어야 한다. 목표 시즌과 id 를 비교하면, 열려 있는 시즌이
  // 어떤 이유로든 지금보다 미래일 때 앞으로만 계속 감아 빠져나오지 못한다.
  let cursor = cur;
  while (cursor.endsAt <= now) {
    await snapshot(c, cursor.id);
    await c.query(`UPDATE seasons SET closed_at = $1 WHERE id = $2`, [cursor.endsAt, cursor.id]);
    await resetPlayers(c);
    closed.push(cursor.id);

    const next = seasonFor(cursor.endsAt);
    if (!next) break;
    await c.query(
      `INSERT INTO seasons (id, label, starts_at, ends_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [next.id, next.label, next.startsAt, next.endsAt]
    );
    cursor = next;
  }

  return { current: cursor, closed };
}

/**
 * 요청마다 부르는 진입점. 대부분의 요청은 시즌이 이미 맞아떨어지므로
 * 잠금 없이 한 번만 읽고 끝낸다. 넘어갈 때만 트랜잭션과 잠금을 쓴다.
 */
export async function syncSeason(now = Date.now()) {
  const target = seasonFor(now);
  if (!target) return null;
  try {
    const rows = await q(
      `SELECT * FROM seasons WHERE closed_at IS NULL ORDER BY starts_at DESC LIMIT 1`
    );
    // id 가 아니라 "지금이 그 시즌 안에 들어오는가"로 판단한다.
    // 저장된 기간이 규칙과 어긋나 있어도 마감을 건너뛰지 않기 위해서다.
    if (rows.length) {
      const open = rowToSeason(rows[0]);
      if (now >= open.startsAt && now < open.endsAt) return open;
    }
  } catch {
    // seasons 테이블이 아직 없는 첫 배포. 아래에서 만든다.
  }
  const { current } = await tx((c) => ensureSeason(c, now));
  return current;
}

export function rowToSeason(r) {
  return {
    id: r.id,
    label: r.label,
    startsAt: Number(r.starts_at),
    endsAt: Number(r.ends_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
  };
}
