import {
  q, tx, body, methodGuard, currentUser, requireUser, requireStaff, requireAdmin, audit,
  ruleV2, attendRule, kstHour, nightDay, ATTEND_CLOSE_HOUR, applyPlayDefaults,
} from './_lib.js';
import { syncSeason } from './_season.js';

/**
 * 접속 예상 시간대. 12시 다음이 1시이므로 숫자 순서가 아니라 이 순서대로 보여준다.
 * 화면(app.js)은 서버가 준 이 목록을 그대로 그린다.
 */
export const HOUR_SLOTS = [6, 7, 8, 9, 10, 11, 12, 1];

/**
 * 시간대 대신 고르는 두 가지.
 * 칸이 숫자라서 시간과 겹치지 않는 값을 골라 자리로 쓴다.
 * 한 사람이 고를 수 있는 칸은 하루에 하나뿐이다.
 */
export const SLOT_UNSURE = 0;   // 미정
export const SLOT_ABSENT = -1;  // 불참
export const SPECIAL_SLOTS = [SLOT_UNSURE, SLOT_ABSENT];

export const SLOTS = [...HOUR_SLOTS, ...SPECIAL_SLOTS];

const KST = 9 * 60 * 60 * 1000;
/**
 * 접속 예상 시간이 초기화되는 시각 (한국 시각).
 *
 * 11월 2일부터 **0시**다. 그전에는 아침 7시였다 — 새벽까지 놀고 자는 사람이
 * 전날 체크를 그대로 보게 하려던 것인데, 이제 출석이 0시~18시에만 받는
 * '그날의 신고'가 되었으므로 날짜와 함께 넘어가야 한다.
 *
 * 점수 규칙(11월 1일)이 아니라 출석 규칙(11월 2일)을 따른다. 출석 화면과
 * 출석을 보는 리폿이 하루 동안 서로 다른 날짜를 보면 안 되기 때문이다.
 */
export const RESET_HOUR_V1 = 7;
export const RESET_HOUR_V2 = 0;
export function resetHourAt(ms = Date.now()) {
  return attendRule(ms) ? RESET_HOUR_V2 : RESET_HOUR_V1;
}
/** 지금 쓰이는 초기화 시각. 화면에 적어 보내는 값이다. */
export const RESET_HOUR = RESET_HOUR_V1;

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 그 시각이 속한 "하루". 11월부터는 0시, 그전에는 07:00 에 넘어간다.
 * 화면(app.js)의 playDay 와 계산이 같아야 한다.
 */
export function playDay(ms = Date.now()) {
  const d = new Date(ms + KST - resetHourAt(ms) * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 지금 출석 체크를 받을 수 있는지. 11월 2일부터 **0시~18시**만 받는다.
 *
 * 18시면 그날 밤이 시작되므로, 그 뒤에 체크를 받으면 "경기 끝나고
 * 점수 받으러 체크"가 되어 규칙이 뜻을 잃는다.
 */
export function attendOpen(ms = Date.now()) {
  return !attendRule(ms) || kstHour(ms) < ATTEND_CLOSE_HOUR;
}

/**
 * 출퇴근 기록.
 * 한 번의 출근~퇴근이 한 줄이다. 퇴근 전이면 clock_out 이 비어 있다.
 * 기록은 시즌(월) 단위로 묶이고, 지난 달 기록은 조회만 된다.
 */

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS attendance (
      id        BIGSERIAL PRIMARY KEY,
      handle    TEXT NOT NULL,
      season    TEXT,
      clock_in  BIGINT NOT NULL,
      clock_out BIGINT
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_attendance_season ON attendance (season, clock_in DESC)`);
  // 한 사람이 동시에 두 번 출근 상태가 되는 것을 DB 차원에서 막는다
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open
             ON attendance (handle) WHERE clock_out IS NULL`);
  // 접속 예상 시간대. 스케줄은 매일 달라지므로 하루 단위로 쌓는다.
  await q(`
    CREATE TABLE IF NOT EXISTS play_schedule (
      day    TEXT NOT NULL,
      handle TEXT NOT NULL,
      slot   INTEGER NOT NULL,
      PRIMARY KEY (day, handle, slot)
    )`);
  // 하루 단위로 바뀌기 전에 만들어진 테이블을 옮긴다.
  // 남아 있던 체크는 오늘 것으로 살려둔다.
  const has = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'play_schedule' AND column_name = 'day'`
  );
  if (!has.length) {
    await q(`ALTER TABLE play_schedule ADD COLUMN day TEXT`);
    await q(`UPDATE play_schedule SET day = $1 WHERE day IS NULL`, [playDay()]);
    await q(`ALTER TABLE play_schedule ALTER COLUMN day SET NOT NULL`);
    await q(`ALTER TABLE play_schedule DROP CONSTRAINT IF EXISTS play_schedule_pkey`);
    await q(`ALTER TABLE play_schedule ADD PRIMARY KEY (day, handle, slot)`);
  }

  // 한 사람은 하루에 한 칸만 고른다. 예전에는 여러 칸을 켤 수 있었으므로
  // 남아 있는 중복을 먼저 정리하고 — 먼저 고른 것을 남긴다 — DB 로 막는다.
  await q(`
    DELETE FROM play_schedule a
     USING play_schedule b
     WHERE a.day = b.day AND a.handle = b.handle AND a.ctid > b.ctid`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_one
             ON play_schedule (day, handle)`);
  ensured = true;
}

function rowToLog(r) {
  return {
    id: Number(r.id),
    handle: r.handle,
    season: r.season,
    clockIn: Number(r.clock_in),
    clockOut: r.clock_out == null ? null : Number(r.clock_out),
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTable();
    const season = await syncSeason();

    if (req.method === 'GET') {
      const id = (req.query && req.query.season) || (season ? season.id : null);
      const day = playDay();
      // 리폿은 '이 밤'의 출석을 본다. 새벽 2시에는 오늘(day)이 아니라
      // 어젯밤(night)의 체크가 기준이므로 그쪽 명단도 함께 내려보낸다.
      const night = nightDay();
      // 읽기 전에 오늘 치 기본값을 채운다. 날이 바뀌고 처음 들어온
      // 사람이 누구든, 그 한 번이 고정 출석을 세워준다.
      try { await applyPlayDefaults(poolShim, day); }
      catch { /* 표가 아직 없으면 없는 대로 */ }
      const [rows, picks, nightPicks] = await Promise.all([
        id ? q(`SELECT * FROM attendance WHERE season = $1 ORDER BY clock_in ASC`, [id]) : [],
        q(`SELECT handle, slot FROM play_schedule WHERE day = $1 ORDER BY handle, slot`, [day]),
        night === day
          ? null
          : q(`SELECT handle FROM play_schedule WHERE day = $1`, [night]),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        season: id,
        logs: rows.map(rowToLog),
        slots: SLOTS,
        day,
        resetHour: resetHourAt(),
        closeHour: ATTEND_CLOSE_HOUR,
        open: attendOpen(),
        ruleV2: ruleV2(Date.now()),
        attendRule: attendRule(Date.now()),
        schedule: picks.map(r => ({ handle: r.handle, slot: r.slot })),
        night: {
          day: night,
          handles: (nightPicks || picks).map(r => r.handle),
        },
      });
    }

    const { action, handle, id } = body(req);
    if (action === 'in' || action === 'out') {
      if (!season) return res.status(400).json({ error: '아직 시즌이 시작되지 않았습니다.' });
      return await punch(res, action, handle, season);
    }
    if (action === 'schedule') {
      // 로그인한 사람이 자기 시간대만 고친다.
      // 대상은 세션에서 가져온다. 화면이 보내온 아이디는 쓰지 않는다.
      const me = await requireUser(req, res);
      if (!me) return;
      if (!attendOpen()) {
        return res.status(400).json({
          error: `출석 체크는 0시부터 ${ATTEND_CLOSE_HOUR}시까지만 할 수 있습니다 · 오늘은 마감되었습니다.`,
        });
      }
      return await setSchedule(res, me, body(req).slots);
    }
    if (action === 'remove') return await remove(req, res, id);
    if (action === 'voteStats') return await voteStats(req, res);
    if (action === 'defaults') return await listDefaults(req, res);
    if (action === 'setDefault') return await setDefault(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * 달마다 누가 투표를 했고 누가 안 했는지.
 *
 * "며칠 중 며칠"의 분모는 달력 날수가 아니라 **그 달에 누구라도 투표한 날**로
 * 센다. 아무도 안 들어온 날까지 세면 모두의 투표율이 억울하게 떨어진다.
 * 미정·불참도 투표한 것으로 본다 — 대답을 한 것이기 때문이다.
 */
async function voteStats(req, res) {
  const raw = String(body(req).month || '');
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : playDay().slice(0, 7);
  const like = month + '%';

  const [days, counts, months, roster] = await Promise.all([
    q(`SELECT COUNT(DISTINCT day)::int AS n FROM play_schedule WHERE day LIKE $1`, [like]),
    q(`SELECT handle, COUNT(DISTINCT day)::int AS n FROM play_schedule
        WHERE day LIKE $1 GROUP BY handle`, [like]),
    q(`SELECT DISTINCT substring(day, 1, 7) AS m FROM play_schedule ORDER BY m DESC`),
    q(`SELECT handle, clan FROM players ORDER BY handle`),
  ]);

  const by = new Map(counts.map(r => [r.handle, Number(r.n)]));
  const total = Number((days[0] || {}).n || 0);

  // 이 달에 투표가 하나도 없어도 이 달은 고를 수 있어야 한다
  const list = months.map(r => r.m);
  if (!list.includes(month)) list.unshift(month);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    month, months: list, days: total,
    stats: roster.map(r => ({
      handle: r.handle, clan: r.clan,
      voted: by.get(r.handle) || 0,
    })),
  });
}

async function punch(res, action, handle, season) {
  if (!handle || typeof handle !== 'string') {
    return res.status(400).json({ error: '아이디를 선택해주세요.' });
  }

  const out = await tx(async (c) => {
    const { rows: who } = await c.query(`SELECT handle FROM players WHERE handle = $1`, [handle]);
    if (!who.length) throw new Error('명단에 없는 선수입니다: ' + handle);

    // 열려 있는 기록을 잠가두고 판단한다. 두 번 눌러도 한 번만 처리된다.
    const { rows: open } = await c.query(
      `SELECT * FROM attendance WHERE handle = $1 AND clock_out IS NULL FOR UPDATE`, [handle]
    );
    const now = Date.now();

    if (action === 'in') {
      if (open.length) throw new Error('이미 출근 상태입니다. 퇴근을 먼저 눌러주세요.');
      const { rows } = await c.query(
        `INSERT INTO attendance (handle, season, clock_in) VALUES ($1,$2,$3) RETURNING *`,
        [handle, season.id, now]
      );
      return rowToLog(rows[0]);
    }

    if (!open.length) throw new Error('출근 기록이 없습니다. 출근을 먼저 눌러주세요.');
    const { rows } = await c.query(
      `UPDATE attendance SET clock_out = $1 WHERE id = $2 RETURNING *`, [now, open[0].id]
    );
    return rowToLog(rows[0]);
  });

  res.status(200).json({ ok: true, log: out });
}

/** 로그인한 사람의 접속 예상 시간대를 통째로 다시 저장한다 */
async function setSchedule(res, handle, slots) {
  let picked = Array.isArray(slots)
    ? [...new Set(slots.map(Number))].filter(n => SLOTS.includes(n))
    : [];

  // 한 사람은 한 칸만 고른다. 화면에서도 막지만 여기서도 잘라둔다 —
  // 미정·불참이 섞여 오면 그것부터 남긴다 ("불참인데 8시"는 뜻이 없다).
  const special = picked.find(n => SPECIAL_SLOTS.includes(n));
  picked = special !== undefined ? [special] : picked.slice(0, 1);

  const day = playDay();
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT handle FROM players WHERE handle = $1`, [handle]);
    if (!rows.length) throw new Error('명단에 없는 선수입니다: ' + handle);
    await c.query(`DELETE FROM play_schedule WHERE day = $1 AND handle = $2`, [day, handle]);
    for (const slot of picked) {
      await c.query(`INSERT INTO play_schedule (day, handle, slot) VALUES ($1,$2,$3)`,
        [day, handle, slot]);
    }
  });
  res.status(200).json({ ok: true, day, handle, slots: picked });
}

/* ---------- 기본 출석 시간대(고정 출석) ---------- */

/**
 * applyPlayDefaults 는 트랜잭션 클라이언트(`{ rows }` 를 돌려주는 것)를
 * 받는다. 여기서는 트랜잭션이 필요 없으므로 q() 를 그 모양으로 감싼다.
 */
const poolShim = { query: async (text, params) => ({ rows: await q(text, params) }) };

/** 지금 누구에게 걸려 있는지 — 리더·웹마스터만 */
async function listDefaults(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const rows = await q(
    `SELECT handle, slot, set_by, ts FROM play_default ORDER BY handle`
  );
  const day = playDay();
  // '오늘 어떻게 됐는지'는 기록 한 줄만으로는 알 수 없다. play_default_log 는
  // '넣어보려 했다'만 남기므로, 본인이 먼저 체크해 둔 날에도 줄이 생긴다.
  // 그래서 오늘 실제로 어느 칸에 들어가 있는지를 같이 보고 가른다.
  const [done, today] = await Promise.all([
    q(`SELECT handle FROM play_default_log WHERE day = $1`, [day]),
    q(`SELECT handle, slot FROM play_schedule WHERE day = $1`, [day]),
  ]);
  const filled = new Set(done.map(r => r.handle));
  const now = new Map(today.map(r => [r.handle, r.slot]));
  res.status(200).json({
    day,
    defaults: rows.map(r => ({
      handle: r.handle,
      slot: r.slot,
      by: r.set_by,
      ts: r.ts == null ? null : Number(r.ts),
      filledToday: filled.has(r.handle),
      todaySlot: now.has(r.handle) ? now.get(r.handle) : null,
    })),
  });
}

/**
 * 걸거나 푼다 — 리더·웹마스터만.
 *
 * slot 이 없으면 해제한다. 오늘 이미 대신 눌러준 뒤에 풀더라도 오늘 칸은
 * 그대로 둔다 — 본인이 보고 고칠 수 있는 상태이고, 말없이 지우면
 * '눌렀는데 사라졌다'가 된다.
 */
async function setDefault(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const b = body(req);
  const handle = String(b.handle || '').trim();
  if (!handle) return res.status(400).json({ error: '아이디가 없습니다.' });

  const rows = await q(`SELECT handle FROM players WHERE handle = $1`, [handle]);
  if (!rows.length) return res.status(404).json({ error: '명단에 없는 선수입니다: ' + handle });
  const real = rows[0].handle;

  if (b.slot === null || b.slot === undefined || b.slot === '') {
    await q(`DELETE FROM play_default WHERE handle = $1`, [real]);
    await audit(me, 'set_default_slot', { handle: real, slot: null });
    return res.status(200).json({ ok: true, handle: real, slot: null });
  }

  const slot = Number(b.slot);
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: '없는 시간대입니다.' });
  await q(
    `INSERT INTO play_default (handle, slot, set_by, ts) VALUES ($1,$2,$3,$4)
     ON CONFLICT (handle) DO UPDATE SET slot = $2, set_by = $3, ts = $4`,
    [real, slot, me, Date.now()]
  );
  await audit(me, 'set_default_slot', { handle: real, slot });

  // 오늘 아직 안 눌렀으면 지금 바로 눌러준다 — 내일까지 기다릴 까닭이 없다.
  let today = 0;
  try { today = await applyPlayDefaults(poolShim, playDay()); }
  catch { /* noop */ }
  res.status(200).json({ ok: true, handle: real, slot, appliedToday: today > 0 });
}

/** 잘못 찍힌 기록 지우기 */
async function remove(req, res, id) {
  const me = await requireStaff(req, res);
  if (!me) return;
  const rows = await q(`DELETE FROM attendance WHERE id = $1 RETURNING handle`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 지워진 기록입니다.' });
  await audit(me, 'remove_attendance', { id, handle: rows[0].handle });
  res.status(200).json({ ok: true });
}
