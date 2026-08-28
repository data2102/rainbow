import { q, tx, body, methodGuard, currentAdmin, audit } from './_lib.js';
import { syncSeason } from './_season.js';

/** 접속 예상 시간대. 화면(app.js)의 SLOTS 와 같아야 한다. */
export const SLOTS = [8, 9, 10, 11, 12];

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
  // 접속 예상 시간대. 기록이 아니라 예정이라 달이 바뀌어도 그대로 둔다.
  await q(`
    CREATE TABLE IF NOT EXISTS play_schedule (
      handle TEXT NOT NULL,
      slot   INTEGER NOT NULL,
      PRIMARY KEY (handle, slot)
    )`);
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
      const [rows, slots] = await Promise.all([
        id ? q(`SELECT * FROM attendance WHERE season = $1 ORDER BY clock_in ASC`, [id]) : [],
        q(`SELECT handle, slot FROM play_schedule ORDER BY handle, slot`),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        season: id,
        logs: rows.map(rowToLog),
        slots: SLOTS,
        schedule: slots.map(r => ({ handle: r.handle, slot: r.slot })),
      });
    }

    const { action, handle, id } = body(req);
    if (action === 'in' || action === 'out') {
      if (!season) return res.status(400).json({ error: '아직 시즌이 시작되지 않았습니다.' });
      return await punch(res, action, handle, season);
    }
    if (action === 'schedule') return await setSchedule(res, handle, body(req).slots);
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

/** 접속 예상 시간대를 통째로 다시 저장한다 */
async function setSchedule(res, handle, slots) {
  if (!handle || typeof handle !== 'string') {
    return res.status(400).json({ error: '아이디를 선택해주세요.' });
  }
  const picked = Array.isArray(slots)
    ? [...new Set(slots.map(Number))].filter(n => SLOTS.includes(n))
    : [];

  await tx(async (c) => {
    const { rows } = await c.query(`SELECT handle FROM players WHERE handle = $1`, [handle]);
    if (!rows.length) throw new Error('명단에 없는 선수입니다: ' + handle);
    await c.query(`DELETE FROM play_schedule WHERE handle = $1`, [handle]);
    for (const slot of picked) {
      await c.query(`INSERT INTO play_schedule (handle, slot) VALUES ($1,$2)`, [handle, slot]);
    }
  });
  res.status(200).json({ ok: true, handle, slots: picked });
}

/** 잘못 찍힌 기록 지우기 — 관리자만 */
async function remove(req, res, id) {
  const me = await currentAdmin(req);
  if (!me) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
  const rows = await q(`DELETE FROM attendance WHERE id = $1 RETURNING handle`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 지워진 기록입니다.' });
  await audit(me, 'remove_attendance', { id, handle: rows[0].handle });
  res.status(200).json({ ok: true });
}
