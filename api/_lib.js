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
      max: 6,   // 한 번에 나란히 보내는 조회가 다섯 개다 — 여기서 줄서면 왕복이 늘어난다
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function q(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows;
}

/**
 * 한 덩어리로 처리한다.
 *
 * `begin` 을 주면 BEGIN 과 함께 한 번에 보낸다. 트랜잭션을 열자마자
 * 잠금부터 걸어야 하는 곳이 있는데, 두 번 나눠 보내면 먼 DB 에서는
 * 그것만으로 왕복 한 번이 더 든다. 값을 끼워 넣지 않는 문장에만 쓴다.
 */
export async function tx(fn, begin = '') {
  const client = await getPool().connect();
  try {
    await client.query(begin ? `BEGIN; ${begin}` : 'BEGIN');
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

export const SESSION_HOURS = 12;

/**
 * "로그인 상태 유지"를 켠 사람의 세션 길이.
 * 회원들이 들를 때마다 아이디와 비밀번호를 다시 치는 것이 힘들다고 해서 두었다.
 * 비밀번호를 저장해두는 대신 세션을 길게 주는 쪽을 택했다 — 남는 것이
 * 비밀번호가 아니라 이 계정 하나짜리 표라서, 잃어도 되돌리기 쉽다.
 */
export const REMEMBER_DAYS = 30;

export async function createSession(handle, remember = false) {
  const token = randomUUID() + randomBytes(16).toString('hex');
  const span = remember ? `${REMEMBER_DAYS} days` : `${SESSION_HOURS} hours`;
  await q(
    `INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '${span}')`,
    [token, handle]
  );
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  return token;
}

/**
 * 세션 표를 담아두는 쿠키 이름.
 *
 * 표는 원래 머리글(Authorization)로만 오갔다. 그런데 <img> 로 불러오는 사진과
 * <a href> 로 받는 파일은 머리글을 붙일 수가 없다 — 브라우저가 그냥 주소를
 * 열 뿐이다. 그래서 같은 표를 쿠키로도 들려보낸다.
 */
export const SESSION_COOKIE = 'r6s';

/** 쿠키 한 줄에서 이름 하나를 꺼낸다 */
function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** 브라우저에 표를 심거나(값이 있으면) 지운다(null 이면) */
export function setSessionCookie(req, res, token, days) {
  const host = String(req.headers?.host || '');
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const bits = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    // Lax 면 남의 사이트에서 보낸 POST 에는 쿠키가 실리지 않는다.
    // 주소를 직접 여는 일(사진 새 창, 파일 받기)에는 실린다 — 필요한 건 그것뿐이다.
    'SameSite=Lax',
    `Max-Age=${token ? Math.round(days * 24 * 60 * 60) : 0}`,
  ];
  if (!local) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

/** 로그인한 사람. { handle, role } 또는 null */
export async function currentUser(req) {
  await ensureAccounts();
  const auth = req.headers?.authorization || '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  // 쿠키는 주소를 그냥 여는 요청(GET)에서만 받는다. 값을 바꾸는 요청까지
  // 쿠키로 받아주면 남의 사이트가 대신 누르게 할 수 있다(CSRF).
  if (!token && req.method === 'GET') token = readCookie(req, SESSION_COOKIE);
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
/** 마스터만. 되돌릴 수 없는 일(대회 기록 삭제 등)에 쓴다 — 관리자는 넣을 수만 있다. */
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

/* ---------- 접속 주소 ---------- */

/**
 * 이 요청을 보낸 사람의 공인 IP.
 *
 * 사이트는 Vercel 을 거쳐 오므로 소켓 주소는 프록시의 것이다. 진짜 손님은
 * x-forwarded-for 맨 앞에 적혀 온다. 레인보우식스는 IPv4 만 알아들으므로
 * IPv6 로만 들어온 사람은 주소가 없는 것으로 본다.
 */
export function clientIp(req) {
  const h = req.headers || {};
  const raw = String(h['x-forwarded-for'] || h['x-real-ip'] || '')
    .split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || '';
  // ::ffff:1.2.3.4 처럼 IPv6 껍데기를 쓴 IPv4 는 벗겨낸다
  const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(raw);
  if (!m) return null;
  const ip = m[1];
  return ip.split('.').every(n => Number(n) <= 255) ? ip : null;
}

/**
 * 밖에서 찾아올 수 있는 주소인가.
 *
 * 통신사가 공인 IP 를 주지 않고 자기네 안에서만 쓰는 주소를 주는 회선이 있다
 * (CGNAT, 100.64~100.127). 그런 회선은 방장을 할 수 없다 — 참가자는 괜찮다.
 * 사설망 주소도 마찬가지다.
 */
export function isReachableIp(ip) {
  if (!ip) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;   // CGNAT
  return true;
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

/**
 * 새 규칙이 시작되는 시각 — 2026년 11월 1일 0시 (한국 시각).
 *
 * 이 시각을 **경기가 기록된 때**(`ts`)와 견준다. "지금"과 견주지 않는 까닭:
 * 관리자가 경기를 하나 취소하면 `replay()` 가 그 달 경기를 처음부터 다시
 * 계산하는데, 그때 '지금'을 쓰면 **10월 경기까지 새 점수로 다시 매겨져**
 * 지난 순위가 소리 없이 바뀐다. 기록된 때로 재면 10월 경기는 10월 규칙,
 * 11월 경기는 11월 규칙으로 영원히 고정된다.
 */
export const RULE_V2_AT = Date.parse('2026-11-01T00:00:00+09:00');
export function ruleV2(ts) { return Number(ts) >= RULE_V2_AT; }

/**
 * 출석 규칙이 시작되는 시각 — 2026년 11월 2일 0시 (한국 시각). 점수보다 하루 늦다.
 *
 * 10월 31일 밤 경기가 자정을 넘기면 그 판은 11월 기록이 된다. 출석까지 같은
 * 날 켜면 **규칙이 알려지기도 전 밤**에 체크를 안 했다는 이유로 점수가 빠진다.
 * 그 하룻밤을 비워주려고 출석만 하루 뒤로 뒀다.
 */
export const ATTEND_RULE_AT = Date.parse('2026-11-02T00:00:00+09:00');
export function attendRule(ts) { return Number(ts) >= ATTEND_RULE_AT; }

/**
 * 패배 시 점수 변화.
 * 11월부터는 0 — 져도 깎이지 않지만 붙는 것도 없다. 그전에는 +1 이었다.
 */
export function lossGain(ts) {
  return ruleV2(ts) ? 0 : 1;
}

/**
 * 연승 고비마다 붙던 보너스. 그 수에 '닿는 순간' 한 번만 줬다 —
 * 4연승·6연승처럼 고비가 아닌 판은 기본 점수만 받았다.
 * 11월부터는 쓰지 않는다. 10월까지의 기록을 다시 계산할 때만 쓰인다.
 */
const STREAK_BONUS = { 3: 1, 5: 2, 7: 3, 10: 5 };

/**
 * 11월 규칙에서 한 판 이겼을 때 받는 점수.
 * 처음에는 1 이었다가 2026-11-02 에 2 로 올렸다 (아래 SCORE_RULE_VERSION 참고).
 */
export const WIN_GAIN_V2 = 2;

/**
 * 승리 시 획득 점수.
 * 11월부터는 연승과 상관없이 **+2**. 그전에는 기본 +3 에 연승 보너스를 더했다.
 */
export function winGain(newStreak, ts) {
  return ruleV2(ts) ? WIN_GAIN_V2 : 3 + (STREAK_BONUS[newStreak] || 0);
}

/* ---------- 하룻밤의 경계 ---------- */

const KST_OFFSET = 9 * 60 * 60 * 1000;
/** 하룻밤이 시작되는 시각 (한국 시각). 18시에 넘어간다. */
export const NIGHT_START_HOUR = 18;
/** 출석 체크가 닫히는 시각 (한국 시각). 하룻밤이 시작되는 때와 같다. */
export const ATTEND_CLOSE_HOUR = NIGHT_START_HOUR;

/**
 * 그 시각이 속한 하룻밤의 시작. 한국 시각 18시에 넘어간다.
 *
 * 모이는 시간이 저녁 6시부터 새벽 4시쯤까지라, 자정으로 끊으면 하룻밤이
 * 두 날로 쪼개진다. 호스트를 하룻밤에 한 번만 맡게 하는 규칙도, 출석을
 * 보는 규칙도 모두 이 경계를 쓴다.
 */
export function nightStart(ms = Date.now()) {
  const edge = NIGHT_START_HOUR * 60 * 60 * 1000;
  return Math.floor((ms + KST_OFFSET - edge) / 86400000) * 86400000 + edge - KST_OFFSET;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 그 하룻밤의 이름표 (`YYYY-MM-DD`, 한국 시각 기준).
 *
 * 밤이 시작된 날의 날짜다. 11월 1일 20시도, 11월 2일 새벽 2시도 모두
 * `2026-11-01` 이다. 출석 체크는 그 날 0시~18시에 받으므로, 새벽 2시에
 * 올린 리폿도 **전날 낮에 한 출석**을 보게 된다.
 */
export function nightDay(ms = Date.now()) {
  const d = new Date(nightStart(ms) + KST_OFFSET);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 그 시각의 한국 시각 '시' (0~23) */
export function kstHour(ms = Date.now()) {
  return new Date(ms + KST_OFFSET).getUTCHours();
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
  return {
    id: r.id === undefined ? null : Number(r.id),
    winners: r.winners,
    losers: r.losers,
    late: Array.isArray(r.late) ? r.late : [],
    // 출석 체크가 없어 점수를 못 받은 사람들 (2026-11 규칙)
    noScore: Array.isArray(r.noscore) ? r.noscore : [],
    ts: Number(r.ts),
    recordedBy: r.recorded_by,
    season: r.season || null,
    // 취소된 기록은 지우지 않고 남긴다. 화면에는 취소선으로 보인다.
    voidedAt: r.voided_at == null ? null : Number(r.voided_at),
    voidedBy: r.voided_by || null,
    voidReason: r.void_reason || null,
  };
}

/** 취소 사유 최대 길이 */
export const MAX_REASON = 200;

/**
 * 취소 사유를 다듬는다. 사유 없이 남의 점수를 되돌릴 수는 없으므로 빈 값은 막는다.
 */
export function cleanReason(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!s) throw new Error('취소 사유를 적어주세요.');
  if (s.length > MAX_REASON) throw new Error(`취소 사유는 ${MAX_REASON}자까지 쓸 수 있습니다.`);
  return s;
}

/** 경기 취소 칸을 준비한다 (한 프로세스에 한 번) */
/**
 * 늦게 들어온 사람에게 주던 점수. **이제 새 기록에는 쓰지 않는다.**
 *
 * 호스트 뽑기로 팀을 나누면 늦게 온 사람도 어느 한 팀에 들어가므로
 * 지각 팀이라는 칸 자체가 어긋났다(2026-10). 그래서 리폿에서 칸을 뺐다.
 *
 * 이 함수는 **지난 기록을 다시 셀 때만** 남아 있다. 관리자가 경기 하나를
 * 취소하면 그 달 기록을 처음부터 다시 세는데, 거기서 이 점수를 빼면
 * 예전에 받은 점수가 소리 없이 사라져 순위가 달라진다.
 */
export function lateGain() {
  // 그 시절 패배 점수와 같은 +1 로 못 박아 둔다. lossGain() 을 부르면
  // 11월부터 0 이 되어, 지난 기록을 다시 셀 때 받았던 점수가 사라진다.
  return 1;
}

let voidReady = false;
export async function ensureMatchVoid() {
  if (voidReady) return;
  const has = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'matches' AND column_name = 'late'`
  );
  if (!has.length) {
    await q(`
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_at BIGINT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_by TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS void_reason TEXT;
      -- 늦게 붙은 사람. 승패 어느 쪽도 아니라 따로 담는다.
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS late JSONB;
    `);
  }
  // 출석 체크가 없어 점수를 못 받은 사람 (2026-11 규칙). 위 if 바깥에서 따로
  // 보는 까닭은 late 칸이 이미 있는 데이터베이스에도 이 칸은 없기 때문이다.
  // ALTER 는 표를 잠그므로, 있는지 먼저 보고 없을 때만 건드린다.
  const hasNoScore = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'matches' AND column_name = 'noscore'`
  );
  if (!hasNoScore.length) {
    await q(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS noscore JSONB`);
  }
  voidReady = true;
}

/**
 * 그 하룻밤에 출석 체크를 한 사람들 (소문자 아이디 집합).
 *
 * 출석 체크란 '출석' 메뉴에서 들어올 시간대를 고르는 것을 말한다.
 * 미정·불참도 **대답을 한 것**이므로 출석으로 친다 — 아무것도 안 누른
 * 사람만 걸린다.
 */
export async function attendedOn(c, day) {
  const { rows } = await c.query(
    `SELECT DISTINCT handle FROM play_schedule WHERE day = $1`, [day]
  );
  return new Set(rows.map(r => String(r.handle).toLowerCase()));
}

/**
 * 이 경기에서 출석 체크가 없어 점수를 못 받을 사람들을 골라낸다.
 * 11월 2일 전 경기에는 빈 목록을 돌려준다 — 그때는 이 규칙이 없었다.
 */
/**
 * 기본 출석 시간대(고정 출석).
 *
 * 매일 빠짐없이 오는 사람이 매일 같은 칸을 누르는 것은 품만 든다. 관리자가
 * 기본 시간대를 걸어두면 날이 바뀐 뒤 **한 번만** 그 칸을 대신 눌러준다.
 *
 * 한 번만인 것이 중요하다. 본인이 오늘 불참으로 바꾸거나 아예 지워도
 * 다시 채워 넣지 않는다 — 그러면 본인이 고칠 수 없는 칸이 된다.
 * '이 날 이 사람에게 넣었다'를 play_default_log 에 남겨 그것을 막는다.
 *
 * 숨기지 않는다. 관리자 화면에 누구에게 걸려 있는지 그대로 보이고,
 * 걸고 푸는 것은 계정 로그에 남는다.
 */
let defaultsReady = false;
async function ensurePlayDefaults(c) {
  if (defaultsReady) return;
  await c.query(`
    CREATE TABLE IF NOT EXISTS play_default (
      handle TEXT PRIMARY KEY,
      slot   INTEGER NOT NULL,
      set_by TEXT,
      ts     BIGINT
    )`);
  await c.query(`
    CREATE TABLE IF NOT EXISTS play_default_log (
      day    TEXT NOT NULL,
      handle TEXT NOT NULL,
      PRIMARY KEY (day, handle)
    )`);
  defaultsReady = true;
}

/**
 * 그 날짜의 기본값을 아직 안 넣었으면 넣는다. 여러 번 불려도 한 번만 들어간다.
 *
 * 출석 화면과 리폿(점수 계산) 양쪽에서 부른다. 화면 쪽에서만 부르면,
 * 아무도 출석 탭을 안 연 날 밤에는 기본값이 없는 채로 점수가 매겨진다 —
 * 하필 그게 제일 중요한 순간이다.
 *
 * day 는 '지금'에 해당하는 날짜여야 한다. 지난 날짜를 넣으면 이미 끝난
 * 날의 투표율이 뒤늦게 바뀐다.
 */
export async function applyPlayDefaults(c, day) {
  await ensurePlayDefaults(c);
  const { rows: has } = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'play_schedule'`
  );
  if (!has.length) return 0;
  const { rows } = await c.query(
    `WITH todo AS (
       INSERT INTO play_default_log (day, handle)
       SELECT $1, d.handle FROM play_default d
       ON CONFLICT (day, handle) DO NOTHING
       RETURNING handle
     )
     INSERT INTO play_schedule (day, handle, slot)
     SELECT $1, t.handle, d.slot
       FROM todo t JOIN play_default d ON d.handle = t.handle
       WHERE EXISTS (SELECT 1 FROM players p WHERE p.handle = d.handle)
     ON CONFLICT (day, handle) DO NOTHING
     RETURNING handle`,
    [day]
  );
  return rows.length;
}

export async function noScoreFor(c, handles, ts) {
  if (!attendRule(ts)) return [];
  // play_schedule 표가 아직 없는 데이터베이스일 수 있다 ('출석' 을 한 번도
  // 안 연 경우). 그럴 때는 아무도 벌하지 않는다.
  const { rows: has } = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'play_schedule'`
  );
  if (!has.length) return [];
  // 지금 벌어지는 경기일 때만 채운다. 지난 경기를 다시 계산할 때
  // 그 날의 기본값을 뒤늦게 만들어 넣으면 안 된다.
  if (Math.abs(Date.now() - ts) < 36 * 60 * 60 * 1000) {
    try { await applyPlayDefaults(c, nightDay(ts)); } catch { /* 없으면 없는 대로 */ }
  }
  const came = await attendedOn(c, nightDay(ts));
  return handles.filter(h => !came.has(String(h).toLowerCase()));
}

/**
 * 호스트 뽑기 표가 아직 없는 데이터베이스일 수 있다.
 * 배포만 하면 쓸 수 있도록 처음 불릴 때 한 번 만든다.
 *
 * teams·pairs 는 나중에 붙였다. 처음에는 두 팀뿐이라 team_a·team_b 로 족했는데,
 * 네 팀으로 나눠 두 경기를 동시에 하고 싶다는 말이 나와 일반화했다.
 * 옛 칸은 그대로 둔다 — 지난 기록을 읽어야 하고, 두 팀짜리는 거기에도 채운다.
 */
let drawsReady = false;
export async function ensureHostDraws() {
  if (drawsReady) return;
  await q(`
    CREATE TABLE IF NOT EXISTS host_draws (
      id         BIGSERIAL PRIMARY KEY,
      ts         BIGINT NOT NULL,
      size       INTEGER NOT NULL,
      team_a     JSONB NOT NULL,
      team_b     JSONB NOT NULL,
      host_a     TEXT NOT NULL,
      host_b     TEXT NOT NULL,
      first_team TEXT NOT NULL,
      drawn_by   TEXT NOT NULL,
      season     TEXT,
      result     TEXT,
      match_id   BIGINT,
      result_by  TEXT,
      result_ts  BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_host_draws_ts ON host_draws (ts DESC);
    -- 팀이 둘뿐이 아닐 수 있다. [{name, order}] 와 [{a, b, first, result, ...}]
    ALTER TABLE host_draws ADD COLUMN IF NOT EXISTS teams JSONB;
    ALTER TABLE host_draws ADD COLUMN IF NOT EXISTS pairs JSONB;
  `);
  drawsReady = true;
}

/** 팀 이름. 네 팀까지 쓴다. */
export const TEAM_NAMES = ['A', 'B', 'C', 'D'];

/**
 * 뽑기 한 줄을 화면이 쓰는 모양으로.
 *
 * teams 가 있으면 그것이 전부다. 없으면 teams·pairs 가 생기기 전의 기록이므로
 * 두 팀짜리로 지어서 돌려준다 — 화면은 한 가지 모양만 알면 된다.
 */
export function rowToDraw(r) {
  const base = {
    id: Number(r.id),
    ts: Number(r.ts),
    size: r.size,
    by: r.drawn_by,
  };
  if (r.teams && r.teams.length) {
    return { ...base, teams: r.teams, pairs: r.pairs || [] };
  }
  return {
    ...base,
    teams: [
      { name: 'A', order: r.team_a || [] },
      { name: 'B', order: r.team_b || [] },
    ],
    pairs: [{
      a: 'A', b: 'B', first: r.first_team,
      // teams 칸이 생기기 전의 줄이라도 '수기작성' 표시는 pairs 에 적힌다.
      // 여기서 집어오지 않으면 적어놓고도 사라진 것처럼 보인다.
      manual: (r.pairs && r.pairs[0] && r.pairs[0].manual) || null,
      result: r.result || null,
      matchId: r.match_id == null ? null : Number(r.match_id),
      by: r.result_by || null,
      at: r.result_ts == null ? null : Number(r.result_ts),
    }],
  };
}

/**
 * 살아있는 기록만으로 시즌 성적을 처음부터 다시 계산한다.
 *
 * 취소한 경기의 점수만 빼는 방법은 쓸 수 없다. 연승 보너스 때문에 한 경기를
 * 들어내면 그 뒤 경기들의 획득 점수까지 달라지기 때문이다. 그래서 시즌 첫
 * 경기부터 순서대로 다시 돌린다. 한 달 경기 수가 많지 않아 이 편이 정확하고
 * 단순하다. 달라진 획득 점수는 기록에도 반영한다.
 */
export async function replay(c, seasonId) {
  await c.query(
    `UPDATE players SET point = 0, wins = 0, losses = 0, streak = 0,
            last_result = NULL, last_match = NULL`
  );

  const { rows } = seasonId
    ? await c.query(
        `SELECT * FROM matches WHERE season = $1 AND voided_at IS NULL ORDER BY ts ASC, id ASC`,
        [seasonId])
    : await c.query(
        `SELECT * FROM matches WHERE season IS NULL AND voided_at IS NULL ORDER BY ts ASC, id ASC`);

  const stats = new Map();
  const of = (h) => {
    if (!stats.has(h)) {
      stats.set(h, { point: 0, wins: 0, losses: 0, streak: 0, lastResult: null, lastMatch: null });
    }
    return stats.get(h);
  };

  for (const m of rows) {
    const winners = Array.isArray(m.winners) ? m.winners : [];
    const losers = Array.isArray(m.losers) ? m.losers : [];
    const ts = Number(m.ts);
    // 그 경기 때 출석 체크가 없어 점수를 못 받은 사람들. 기록해 둔 것을 그대로
    // 쓴다 — 지금 출석표를 다시 보면 안 된다. 그날의 사실이 바뀌어 버린다.
    const skipped = new Set(Array.isArray(m.noscore) ? m.noscore : []);
    const redone = [];

    for (const w of winners) {
      const h = typeof w === 'string' ? w : w.handle;
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'W' ? s.streak + 1 : 1;
      const gained = skipped.has(h) ? 0 : winGain(s.streak, ts);
      s.point += gained;
      s.wins += 1;
      s.lastResult = 'W';
      s.lastMatch = ts;
      redone.push({ handle: h, gained });
    }

    for (const h of losers) {
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'L' ? s.streak - 1 : -1;
      s.point += skipped.has(h) ? 0 : lossGain(ts);
      s.losses += 1;
      s.lastResult = 'L';
      s.lastMatch = ts;
    }

    // 지각 팀은 없앴지만, 그 칸이 있던 시절의 기록은 여기서 그대로 되살린다.
    // 빼버리면 관리자가 경기 하나를 취소하는 순간 지난 달에 받은 점수까지
    // 소리 없이 사라져 순위가 달라진다. 새 기록에는 이 칸이 비어 있다.
    for (const h of (Array.isArray(m.late) ? m.late : [])) {
      if (!h) continue;
      of(h).point += lateGain();
    }

    if (JSON.stringify(redone) !== JSON.stringify(winners)) {
      await c.query(`UPDATE matches SET winners = $1 WHERE id = $2`, [JSON.stringify(redone), m.id]);
    }
  }

  for (const [handle, s] of stats) {
    await c.query(
      `UPDATE players SET point = $1, wins = $2, losses = $3, streak = $4,
              last_result = $5, last_match = $6 WHERE handle = $7`,
      [s.point, s.wins, s.losses, s.streak, s.lastResult,
       s.lastMatch == null ? null : new Date(s.lastMatch), handle]
    );
  }
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
