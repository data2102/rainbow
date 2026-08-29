import {
  q, body, methodGuard, audit, hashPw, verifyPw, createSession,
  currentUser, requireAdmin, ensureAccounts,
  genReqId, parseHandle, cleanEmail, ROLES, ROLE_LABEL, TEMP_PASSWORD,
} from './_lib.js';

/**
 * 계정. 선수 명단(players)이 곧 계정 목록이다.
 * 권한은 일반 < 관리자 < 마스터 셋이고, 권한을 바꾸는 것은 마스터만 할 수 있다.
 */

const MIN_PW = 4;

function checkPw(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PW) {
    throw new Error(`비밀번호는 ${MIN_PW}자 이상으로 입력해주세요.`);
  }
  return pw;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    await ensureAccounts();
    const { action } = body(req);
    switch (action) {
      case 'login':    return await login(req, res);
      case 'logout':   return await logout(req, res);
      case 'me':       return await whoami(req, res);
      case 'signup':   return await signup(req, res);
      case 'checkId':  return await checkId(req, res);
      case 'resetPw':  return await resetPw(req, res);
      case 'changePw': return await changePw(req, res);
      case 'setEmail': return await setEmail(req, res);
      case 'list':     return await list(req, res);
      case 'setRole':  return await setRole(req, res);
      case 'logs':     return await logs(req, res);
      default:         return res.status(400).json({ error: '알 수 없는 요청입니다.' });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/* ---------- 로그인 ---------- */

async function login(req, res) {
  const { id, password, remember } = body(req);
  if (!id || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });

  // 아이디는 대소문자를 가리지 않는다. 스펠링만 맞으면 된다.
  const rows = await q(`SELECT * FROM players WHERE lower(handle) = lower($1)`, [String(id).trim()]);
  const p = rows[0];
  if (!p || !verifyPw(password, p.pw_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const token = await createSession(p.handle, !!remember);
  res.status(200).json({ ok: true, token, account: toAccount(p) });
}

/**
 * 화면에 넘겨주는 계정 정보.
 * mustChangePw · mustSetEmail 이 붙어 있으면 화면이 창을 강제로 띄운다.
 * 초기 비밀번호(1234)를 그대로 쓰거나 이메일이 없으면 비밀번호를 잃었을 때
 * 본인 확인을 할 방법이 없으므로, 미루지 못하게 막는다.
 */
function toAccount(p) {
  return {
    handle: p.handle,
    role: p.role || 'member',
    clan: p.clan,
    email: p.email || null,
    mustChangePw: verifyPw(TEMP_PASSWORD, p.pw_hash),
    mustSetEmail: !p.email,
  };
}

async function logout(req, res) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) await q(`DELETE FROM sessions WHERE token = $1`, [token]);
  res.status(200).json({ ok: true });
}

async function whoami(req, res) {
  const me = await currentUser(req);
  if (!me) return res.status(200).json({ account: null });
  const rows = await q(`SELECT * FROM players WHERE handle = $1`, [me.handle]);
  res.status(200).json({ account: rows.length ? toAccount(rows[0]) : me });
}

/* ---------- 가입 신청 ---------- */

async function signup(req, res) {
  const { id, clan, email } = body(req);
  const handle = String(id == null ? '' : id).trim();
  if (!handle) return res.status(400).json({ error: '아이디를 입력해주세요.' });
  const mail = cleanEmail(email);
  if (!mail) return res.status(400).json({ error: '이메일 주소를 입력해주세요.' });
  const clanName = String(clan == null ? '' : clan).trim() || parseHandle(handle).clan;

  const dup = await q(`SELECT 1 FROM players WHERE lower(handle) = lower($1)`, [handle]);
  if (dup.length) return res.status(409).json({ error: '이미 있는 아이디입니다.' });
  const pending = await q(
    `SELECT 1 FROM requests WHERE type = 'add' AND lower(new_id) = lower($1)`, [handle]
  );
  if (pending.length) return res.status(409).json({ error: '이미 신청된 아이디입니다. 승인을 기다려주세요.' });

  await q(
    `INSERT INTO requests (id, type, new_id, new_clan, email, requested_at)
     VALUES ($1,'add',$2,$3,$4,$5)`,
    [genReqId(), handle, clanName, mail, Date.now()]
  );
  res.status(200).json({ ok: true });
}

/* ---------- 비밀번호 ---------- */

/** 아이디·클랜·이메일 세 가지가 모두 맞는 계정을 찾는다 */
async function findByIdentity({ id, clan, email }) {
  const rows = await q(
    `SELECT handle FROM players
      WHERE lower(handle) = lower($1) AND lower(clan) = lower($2) AND lower(email) = lower($3)`,
    [
      String(id == null ? '' : id).trim(),
      String(clan == null ? '' : clan).trim(),
      String(email == null ? '' : email).trim(),
    ]
  );
  return rows.length ? rows[0].handle : null;
}

/** 1단계: 본인 확인만 한다. 여기서 맞아야 새 비밀번호 화면으로 넘어간다. */
async function checkId(req, res) {
  const handle = await findByIdentity(body(req));
  if (!handle) {
    return res.status(400).json({ error: '아이디·클랜·이메일이 일치하는 계정이 없습니다.' });
  }
  res.status(200).json({ ok: true, handle });
}

/**
 * 2단계: 새 비밀번호를 정한다.
 * 여기서도 세 가지를 다시 확인한다. 1단계를 건너뛰고 바로 불러도 통과하지 못하도록.
 * 메일을 보내는 절차가 없으므로, 세 가지를 아는 사람은 비밀번호를 바꿀 수 있다.
 */
async function resetPw(req, res) {
  const { password } = body(req);
  checkPw(password);

  const handle = await findByIdentity(body(req));
  if (!handle) {
    return res.status(400).json({ error: '아이디·클랜·이메일이 일치하는 계정이 없습니다.' });
  }
  const rows = [{ handle }];

  await q(`UPDATE players SET pw_hash = $1 WHERE handle = $2`, [hashPw(password), rows[0].handle]);
  await q(`DELETE FROM sessions WHERE admin_id = $1`, [rows[0].handle]);
  await audit(rows[0].handle, 'reset_password', { by: 'self' });
  res.status(200).json({ ok: true });
}

async function changePw(req, res) {
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const { password } = body(req);
  checkPw(password);
  if (password === TEMP_PASSWORD) {
    return res.status(400).json({ error: '초기 비밀번호와 다른 비밀번호로 정해주세요.' });
  }
  await q(`UPDATE players SET pw_hash = $1 WHERE handle = $2`, [hashPw(password), me.handle]);
  res.status(200).json({ ok: true });
}

/** 본인 이메일 등록·변경. 비밀번호를 잊었을 때 본인 확인에 쓰는 유일한 단서다. */
async function setEmail(req, res) {
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const email = cleanEmail(body(req).email);
  if (!email) return res.status(400).json({ error: '이메일 주소를 입력해주세요.' });
  await q(`UPDATE players SET email = $1 WHERE handle = $2`, [email, me.handle]);
  res.status(200).json({ ok: true, email });
}

/* ---------- 권한 ---------- */

async function list(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const rows = await q(
    `SELECT handle, clan, email, role FROM players ORDER BY handle`
  );
  res.status(200).json({
    accounts: rows.map(r => ({
      handle: r.handle, clan: r.clan, email: r.email, role: r.role || 'member',
    })),
    roles: ROLES.map(r => ({ value: r, label: ROLE_LABEL[r] })),
  });
}

/**
 * 권한 변경.
 * 관리자는 일반과 관리자 사이를 오가게 할 수 있다.
 * 마스터를 세우고 내리는 일만 마스터에게 남겨둔다. 관리자끼리 서로 마스터를
 * 만들어 줄 수 있으면 마스터를 따로 둔 뜻이 없어진다.
 */
async function setRole(req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const me = await currentUser(req);
  const { handle, role } = body(req);
  if (!ROLES.includes(role)) return res.status(400).json({ error: '없는 권한입니다.' });

  const rows = await q(`SELECT role FROM players WHERE handle = $1`, [handle]);
  if (!rows.length) return res.status(404).json({ error: '없는 계정입니다: ' + handle });
  const before = rows[0].role || 'member';
  if (before === role) return res.status(200).json({ ok: true, handle, role });

  // 마스터가 걸린 자리는 마스터만 건드린다. 주는 것도, 거두는 것도.
  if ((before === 'master' || role === 'master') && me.role !== 'master') {
    return res.status(403).json({ error: '마스터 권한은 마스터만 주고 거둘 수 있습니다.' });
  }

  // 마스터가 하나도 남지 않으면 아무도 권한을 되돌릴 수 없게 된다
  if (before === 'master' && role !== 'master') {
    const masters = await q(`SELECT count(*)::int AS n FROM players WHERE role = 'master'`);
    if (masters[0].n <= 1) {
      return res.status(400).json({ error: '마스터가 최소 한 명은 있어야 합니다.' });
    }
  }

  await q(`UPDATE players SET role = $1 WHERE handle = $2`, [role, handle]);
  await audit(actor, 'set_role', { handle, from: before, to: role });
  res.status(200).json({ ok: true, handle, role });
}

/* ---------- 계정 로그 ---------- */

/**
 * 계정을 만들고 · 고치고 · 지운 기록, 그리고 경기 기록을 취소한 기록.
 * 취소는 남의 점수를 되돌리는 일이라 여기 함께 남긴다. 되돌리기까지 남아서
 * 취소 → 되돌리기로 오간 흔적도 여기서만 온전히 보인다.
 */
const LOG_ACTIONS = [
  'approve_add', 'approve_remove', 'reject_request',
  'create_player', 'update_player', 'remove_player', 'set_role',
  'void_match', 'restore_match',
];

async function logs(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const rows = await q(
    `SELECT admin_id, action, detail, ts FROM audit_log
      WHERE action = ANY($1) ORDER BY ts DESC LIMIT 200`,
    [LOG_ACTIONS]
  );
  res.status(200).json({
    logs: rows.map(r => ({
      by: r.admin_id, action: r.action, detail: r.detail,
      ts: new Date(r.ts).getTime(),
    })),
  });
}
