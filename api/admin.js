import {
  q, body, methodGuard, hashPw, verifyPw, isLegacyHash,
  createSession, currentAdmin, requireAdmin, audit,
} from './_lib.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const { action } = body(req);

  try {
    switch (action) {
      case 'login':      return await login(req, res);
      case 'logout':     return await logout(req, res);
      case 'changePassword': return await changePassword(req, res);
      case 'list':       return await list(req, res);
      case 'add':        return await add(req, res);
      case 'remove':     return await remove(req, res);
      default:
        return res.status(400).json({ error: '알 수 없는 요청입니다.' });
    }
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function login(req, res) {
  const { id, password } = body(req);
  const rows = await q(`SELECT * FROM admins WHERE id = $1`, [id]);
  const a = rows[0];
  if (!a || !verifyPw(password, a.pw_hash)) {
    return res.status(401).json({ error: 'ID 또는 비밀번호가 일치하지 않습니다.' });
  }
  // 평문으로 남아있던 비밀번호를 해시로 승격
  if (isLegacyHash(a.pw_hash)) {
    await q(`UPDATE admins SET pw_hash = $1 WHERE id = $2`, [hashPw(password), a.id]);
  }
  const token = await createSession(a.id);
  await audit(a.id, 'login', null);
  res.status(200).json({ token, admin: a.id, mustChangePassword: a.must_change });
}

async function logout(req, res) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) await q(`DELETE FROM sessions WHERE token = $1`, [token]);
  res.status(200).json({ ok: true });
}

async function changePassword(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const { oldPassword, newPassword } = body(req);
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
  }
  const rows = await q(`SELECT * FROM admins WHERE id = $1`, [me]);
  if (!rows.length || !verifyPw(oldPassword, rows[0].pw_hash)) {
    return res.status(400).json({ error: '기존 비밀번호가 일치하지 않습니다.' });
  }
  await q(`UPDATE admins SET pw_hash = $1, must_change = FALSE WHERE id = $2`, [hashPw(newPassword), me]);
  await audit(me, 'change_password', null);
  res.status(200).json({ ok: true });
}

async function list(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const rows = await q(`SELECT id, must_change FROM admins ORDER BY id`);
  res.status(200).json({ admins: rows.map(r => ({ id: r.id, mustChangePassword: r.must_change })) });
}

async function add(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const { id, password } = body(req);
  if (!id) return res.status(400).json({ error: 'ID를 입력해주세요.' });
  const exists = await q(`SELECT 1 FROM admins WHERE id = $1`, [id]);
  if (exists.length) return res.status(400).json({ error: '이미 존재하는 관리자 ID입니다.' });
  const initial = password && password.length >= 8 ? password : null;
  const temp = initial || Math.random().toString(36).slice(2, 10) + '!R6';
  await q(`INSERT INTO admins (id, pw_hash, must_change) VALUES ($1, $2, TRUE)`, [id, hashPw(temp)]);
  await audit(me, 'add_admin', { id });
  res.status(200).json({ ok: true, tempPassword: temp });
}

async function remove(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const { id } = body(req);
  const cnt = await q(`SELECT count(*)::int AS c FROM admins`);
  if (cnt[0].c <= 1) return res.status(400).json({ error: '최소 1명 이상의 관리자가 있어야 합니다.' });
  await q(`DELETE FROM admins WHERE id = $1`, [id]);
  await audit(me, 'remove_admin', { id });
  res.status(200).json({ ok: true });
}
