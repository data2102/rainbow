import { q, body, methodGuard, hashPw, verifyPw, currentAdmin, requireAdmin, audit } from './_lib.js';

const MAX_AUTHOR = 20;
const MAX_BODY = 1000;

/**
 * 기능 개선 게시판.
 * 글쓴이가 정한 4자리 비밀번호로 수정·삭제한다. 관리자는 비밀번호 없이 삭제할 수 있다.
 *
 * db:setup 을 다시 돌리지 않고 배포해도 동작하도록 콜드 스타트마다 한 번 테이블을 확인한다.
 */
let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS posts (
      id         BIGSERIAL PRIMARY KEY,
      author     TEXT NOT NULL,
      pw_hash    TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`);
  ensured = true;
}

/** 비밀번호는 어떤 경우에도 내보내지 않는다 */
function rowToPost(r) {
  return {
    id: Number(r.id),
    author: r.author,
    body: r.body,
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
  };
}

function checkPw(pw) {
  return /^\d{4}$/.test(String(pw || ''));
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTable();
    if (req.method === 'GET') return await listPosts(res);

    const { action } = body(req);
    if (action === 'create')     return await create(req, res);
    if (action === 'update')     return await update(req, res);
    if (action === 'remove')     return await remove(req, res);
    if (action === 'removeMany') return await removeMany(req, res);
    if (action === 'clear')      return await clear(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function listPosts(res) {
  const rows = await q(`SELECT * FROM posts ORDER BY created_at DESC`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ posts: rows.map(rowToPost) });
}

async function create(req, res) {
  const { author, password, body: text } = body(req);
  const name = String(author || '').trim();
  const content = String(text || '').trim();

  if (!name) return res.status(400).json({ error: 'ID를 입력해주세요.' });
  if (name.length > MAX_AUTHOR) return res.status(400).json({ error: `ID는 ${MAX_AUTHOR}자 이내로 입력해주세요.` });
  if (!checkPw(password)) return res.status(400).json({ error: '비밀번호는 숫자 4자리로 입력해주세요.' });
  if (!content) return res.status(400).json({ error: '내용을 입력해주세요.' });
  if (content.length > MAX_BODY) return res.status(400).json({ error: `내용은 ${MAX_BODY}자 이내로 입력해주세요.` });

  const rows = await q(
    `INSERT INTO posts (author, pw_hash, body, created_at) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, hashPw(String(password)), content, Date.now()]
  );
  res.status(200).json({ ok: true, post: rowToPost(rows[0]) });
}

/** 글을 찾고 권한을 확인한다. 관리자는 비밀번호 없이 통과한다. */
async function authorize(req, res, id, { adminOnlyBypass = true } = {}) {
  const rows = await q(`SELECT * FROM posts WHERE id = $1`, [Number(id)]);
  if (!rows.length) {
    res.status(404).json({ error: '이미 삭제된 글입니다.' });
    return null;
  }
  const post = rows[0];

  if (adminOnlyBypass && await currentAdmin(req)) return post;

  const { password } = body(req);
  if (!verifyPw(String(password || ''), post.pw_hash)) {
    res.status(403).json({ error: '비밀번호가 일치하지 않습니다.' });
    return null;
  }
  return post;
}

async function update(req, res) {
  const { id, body: text } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '수정할 글을 찾을 수 없습니다.' });

  const content = String(text || '').trim();
  if (!content) return res.status(400).json({ error: '내용을 입력해주세요.' });
  if (content.length > MAX_BODY) return res.status(400).json({ error: `내용은 ${MAX_BODY}자 이내로 입력해주세요.` });

  // 수정은 글쓴이만 할 수 있다. 관리자에게는 삭제 권한만 준다.
  const post = await authorize(req, res, id, { adminOnlyBypass: false });
  if (!post) return;

  const rows = await q(
    `UPDATE posts SET body = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
    [content, Date.now(), post.id]
  );
  res.status(200).json({ ok: true, post: rowToPost(rows[0]) });
}

async function remove(req, res) {
  const { id } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '삭제할 글을 찾을 수 없습니다.' });

  const post = await authorize(req, res, id);
  if (!post) return;

  await q(`DELETE FROM posts WHERE id = $1`, [post.id]);
  const admin = await currentAdmin(req);
  if (admin) await audit(admin, 'delete_post', { id: post.id, author: post.author });
  res.status(200).json({ ok: true });
}

async function removeMany(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const ids = (body(req).ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: '삭제할 글을 선택해주세요.' });

  const rows = await q(`DELETE FROM posts WHERE id = ANY($1) RETURNING id`, [ids]);
  await audit(me, 'delete_posts', { count: rows.length, ids });
  res.status(200).json({ ok: true, deleted: rows.length });
}

async function clear(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const rows = await q(`DELETE FROM posts RETURNING id`);
  await audit(me, 'clear_posts', { count: rows.length });
  res.status(200).json({ ok: true, deleted: rows.length });
}
