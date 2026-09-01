import { q, tx, body, methodGuard, currentUser, requireUser, requireAdmin, audit } from './_lib.js';
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
/** 접속 예상 시간이 초기화되는 시각 (한국 시각) */
export const RESET_HOUR = 7;

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 그 시각이 속한 "하루". 한국 시각 07:00 에 넘어간다.
 * 00:00~06:59 는 아직 전날이므로 전날 체크가 그대로 보인다.
 * 화면(app.js)의 playDay 와 계산이 같아야 한다.
 */
export function playDay(ms = Date.now()) {
  const d = new Date(ms + KST - RESET_HOUR * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
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
      const [rows, picks] = await Promise.all([
        id ? q(`SELECT * FROM attendance WHERE season = $1 ORDER BY clock_in ASC`, [id]) : [],
        q(`SELECT handle, slot FROM play_schedule WHERE day = $1 ORDER BY handle, slot`, [day]),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        season: id,
        logs: rows.map(rowToLog),
        slots: SLOTS,
        day,
        resetHour: RESET_HOUR,
        schedule: picks.map(r => ({ handle: r.handle, slot: r.slot })),
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
      return await setSchedule(res, me, body(req).slots);
    }
    if (action === 'remove') return await remove(req, res, id);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

/** 잘못 찍힌 기록 지우기 — 관리자만 */
async function remove(req, res, id) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const rows = await q(`DELETE FROM attendance WHERE id = $1 RETURNING handle`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 지워진 기록입니다.' });
  await audit(me, 'remove_attendance', { id, handle: rows[0].handle });
  res.status(200).json({ ok: true });
}
