import pg from 'pg';
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

/* ---------- DB ---------- */

let pool;
export function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL 환경변수가 없습니다.');
    pool = new pg.Pool({
      connectionString: cs,
      ssl: cs.includes('localhost') || cs.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function q(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows;
}

export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- 비밀번호 ---------- */

/**
 * 새 계정과 재발급에 쓰는 임시 비밀번호.
 * 모바일에서 받아치기 쉽도록 짧게 두었다. 이 값으로 로그인하면
 * 비밀번호 변경 창이 강제로 뜨고, 8자 이상으로 바꿔야 이용할 수 있다.
 */
export const TEMP_PASSWORD = '1234';

export function hashPw(pw) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPw(pw, stored) {
  if (!stored) return false;
  // 백업에서 넘어온 평문 비밀번호 호환 (로그인 성공 시 자동으로 해시로 승격됨)
  if (!stored.startsWith('scrypt$')) return stored === pw;
  const [, salt, hex] = stored.split('$');
  const a = Buffer.from(hex, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isLegacyHash(stored) {
  return !!stored && !stored.startsWith('scrypt$');
}

/* ---------- 세션 ---------- */

const SESSION_HOURS = 12;

export async function createSession(adminId) {
  const token = randomUUID() + randomBytes(16).toString('hex');
  await q(
    `INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`,
    [token, adminId]
  );
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  return token;
}

export async function currentAdmin(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const rows = await q(
    `SELECT admin_id FROM sessions WHERE token = $1 AND expires_at > now()`,
    [token]
  );
  return rows.length ? rows[0].admin_id : null;
}

export async function requireAdmin(req, res) {
  const id = await currentAdmin(req);
  if (!id) {
    res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
    return null;
  }
  return id;
}

export async function audit(adminId, action, detail) {
  try {
    await q(`INSERT INTO audit_log (admin_id, action, detail) VALUES ($1, $2, $3)`, [
      adminId, action, detail ? JSON.stringify(detail) : null,
    ]);
  } catch { /* 감사 로그 실패는 무시 */ }
}

/* ---------- 공통 ---------- */

export function genReqId() {
  return 'req_' + Date.now() + '_' + randomBytes(4).toString('hex');
}

export function parseHandle(full) {
  const idx = full.indexOf('_');
  if (idx !== -1) return { clan: full.slice(0, idx), name: full.slice(idx + 1) };
  return { clan: '-', name: full };
}

/** 구버전 1:1 기록을 팀전 형식으로 변환 */
export function normalizeMatch(m) {
  if (!m) return m;
  if (!m.winners && m.winner) {
    return {
      winners: [{ handle: m.winner, gained: m.pointsAwarded !== undefined ? m.pointsAwarded : 3 }],
      losers: m.loser ? [m.loser] : [],
      ts: m.ts,
      recordedBy: m.recordedBy || '이전 기록',
    };
  }
  return m;
}

/** 패배 시 점수 변화 */
export function lossGain() {
  return 1;
}

/** 승리 시 획득 점수: 기본 +3, 3연승 +1, 5연승 +2 */
export function winGain(newStreak) {
  if (newStreak === 3) return 4;
  if (newStreak === 5) return 5;
  return 3;
}

export function rowToPlayer(r) {
  return {
    handle: r.handle,
    clan: r.clan,
    name: r.name,
    point: r.point,
    wins: r.wins,
    losses: r.losses,
    streak: r.streak,
    lastResult: r.last_result,
    lastMatch: r.last_match,
  };
}

export function rowToMatch(r) {
  return { winners: r.winners, losers: r.losers, ts: Number(r.ts), recordedBy: r.recorded_by, season: r.season || null };
}

export function rowToRequest(r) {
  return {
    id: r.id,
    type: r.type,
    newId: r.new_id,
    newClan: r.new_clan,
    targetId: r.target_id,
    requestedAt: Number(r.requested_at),
  };
}

export function methodGuard(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.status(405).json({ error: 'Method Not Allowed' });
    return false;
  }
  return true;
}

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}
