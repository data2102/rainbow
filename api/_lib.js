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
 * 모바일에서 받아치기 쉽도록 짧게 두었다. 이 값 그대로 로그인하면
 * 비밀번호를 바꾸는 창이 강제로 뜨고, 바꾸기 전에는 닫을 수 없다.
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

/* ---------- 계정 · 세션 ---------- */

/**
 * 계정은 곧 선수 명단이다. players 한 줄이 로그인 계정 하나다.
 * 권한은 일반(member) < 관리자(admin) < 마스터(master) 셋뿐이다.
 */
export const ROLES = ['member', 'admin', 'master'];
export const ROLE_LABEL = { member: '일반', admin: '관리자', master: '마스터' };
const RANK = { member: 1, admin: 2, master: 3 };

/** 처음 마스터 권한을 가지는 계정 */
export const MASTER_HANDLE = 'LOTUS_TeaRs';

/** 계정 제도를 처음 켤 때 한 번만 도는 정리 작업 */
let accountsReady = false;
export async function ensureAccounts() {
  if (accountsReady) return;
  const has = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'pw_hash'`
  );
  if (!has.length) {
    await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pw_hash TEXT`);
    await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`);
    await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT`);
    await q(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS email TEXT`);

    // 명단에 있는 모두에게 같은 임시 비밀번호를 준다. 어차피 공개된 값이라
    // 한 번만 해시해서 나눠 써도 잃을 것이 없고, 콜드 스타트가 느려지지 않는다.
    await q(`UPDATE players SET pw_hash = $1 WHERE pw_hash IS NULL`, [hashPw(TEMP_PASSWORD)]);
    await q(`UPDATE players SET role = 'master' WHERE handle = $1`, [MASTER_HANDLE]);

    // 예전 ADMIN_* 계정은 더 쓰지 않는다
    await q(`DELETE FROM admins WHERE id ILIKE 'ADMIN%'`);
    // 세션은 이제 선수 명단을 가리킨다
    await q(`ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_admin_id_fkey`);
    await q(`DELETE FROM sessions`);
  }
  accountsReady = true;
}

const SESSION_HOURS = 12;

export async function createSession(handle) {
  const token = randomUUID() + randomBytes(16).toString('hex');
  await q(
    `INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`,
    [token, handle]
  );
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  return token;
}

/** 로그인한 사람. { handle, role } 또는 null */
export async function currentUser(req) {
  await ensureAccounts();
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const rows = await q(
    `SELECT p.handle, p.role FROM sessions s
       JOIN players p ON p.handle = s.admin_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows.length ? { handle: rows[0].handle, role: rows[0].role || 'member' } : null;
}

/** 관리자 이상이면 그 아이디를, 아니면 null (권한 없이 조용히 넘어가는 곳에 쓴다) */
export async function currentAdmin(req) {
  const me = await currentUser(req);
  return me && RANK[me.role] >= RANK.admin ? me.handle : null;
}

async function gate(req, res, need) {
  const me = await currentUser(req);
  if (!me) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return null;
  }
  if (RANK[me.role] < RANK[need]) {
    res.status(403).json({ error: `${ROLE_LABEL[need]} 권한이 필요합니다.` });
    return null;
  }
  return me.handle;
}

/** 로그인만 하면 된다 (일반 이상) */
export function requireUser(req, res) { return gate(req, res, 'member'); }
/** 관리자 이상 */
export function requireAdmin(req, res) { return gate(req, res, 'admin'); }
/** 마스터만 */
export function requireMaster(req, res) { return gate(req, res, 'master'); }

/** 누가 무엇을 했는지 남긴다. ts 는 audit_log 가 자동으로 찍는다. */
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

/** 이메일 최대 길이 */
export const MAX_EMAIL = 120;

/**
 * 이메일을 다듬는다. 빈 값이면 null.
 * 아주 느슨하게만 본다. 오타까지 잡아주려다 멀쩡한 주소를 막는 편이 더 나쁘다.
 */
export function cleanEmail(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (s.length > MAX_EMAIL) throw new Error('이메일이 너무 깁니다.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('이메일 형식이 올바르지 않습니다.');
  return s;
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
