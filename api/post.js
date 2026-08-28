import { q, body, methodGuard, currentAdmin, requireUser, requireAdmin, audit } from './_lib.js';

const MAX_BODY = 1000;
const MAX_COMMENT = 300;

/**
 * 기능 개선 게시판.
 * 로그인한 회원만 글과 댓글을 남긴다. 글쓴이는 로그인한 계정이 그대로 들어간다.
 * 고치는 것은 글쓴이만, 지우는 것은 글쓴이와 관리자가 할 수 있다.
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
  await q(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id         BIGSERIAL PRIMARY KEY,
      post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      pw_hash    TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (post_id, created_at)`);

  // 4자리 비밀번호로 글을 지키던 시절의 흔적. 이제 로그인한 계정이 곧 글쓴이다.
  // 지난 글의 비밀번호는 굳이 지우지 않고, 새 글에는 넣지 않는다.
  await q(`ALTER TABLE posts ALTER COLUMN pw_hash DROP NOT NULL`);
  await q(`ALTER TABLE post_comments ALTER COLUMN pw_hash DROP NOT NULL`);

  // 아이디가 바뀐 회원의 지난 글을 새 아이디로 맞춘다.
  // 글쓴이를 아이디로 알아보므로, 옛 이름으로 남아 있으면 본인이 고치지 못한다.
  for (const [was, now] of RENAMED_AUTHORS) {
    await q(`UPDATE posts SET author = $1 WHERE lower(author) = lower($2)`, [now, was]);
    await q(`UPDATE post_comments SET author = $1 WHERE lower(author) = lower($2)`, [now, was]);
  }
  ensured = true;
}

/** [예전 아이디, 지금 아이디] */
const RENAMED_AUTHORS = [
  ['fvc_mental', 'oK_mEntAl'],
];

/** 글쓴이 본인인가. 아이디는 로그인과 마찬가지로 대소문자를 가리지 않는다. */
function isAuthor(me, row) {
  return !!me && String(row.author).toLowerCase() === String(me).toLowerCase();
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

function rowToComment(r) {
  return {
    id: Number(r.id),
    postId: Number(r.post_id),
    author: r.author,
    body: r.body,
    createdAt: Number(r.created_at),
  };
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
    if (action === 'comment')       return await addComment(req, res);
    if (action === 'removeComment') return await removeComment(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function listPosts(res) {
  const [rows, comments] = await Promise.all([
    q(`SELECT * FROM posts ORDER BY created_at DESC`),
    q(`SELECT * FROM post_comments ORDER BY created_at ASC`),
  ]);
  const byPost = new Map();
  for (const c of comments) {
    const key = Number(c.post_id);
    if (!byPost.has(key)) byPost.set(key, []);
    byPost.get(key).push(rowToComment(c));
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    posts: rows.map(r => ({ ...rowToPost(r), comments: byPost.get(Number(r.id)) || [] })),
  });
}

async function addComment(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { postId, body: text } = body(req);
  const content = String(text || '').trim();

  if (!Number.isInteger(Number(postId))) return res.status(400).json({ error: '댓글을 달 글을 찾을 수 없습니다.' });
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
  if (content.length > MAX_COMMENT) return res.status(400).json({ error: `댓글은 ${MAX_COMMENT}자 이내로 입력해주세요.` });

  const exists = await q(`SELECT 1 FROM posts WHERE id = $1`, [Number(postId)]);
  if (!exists.length) return res.status(404).json({ error: '이미 삭제된 글입니다.' });

  const rows = await q(
    `INSERT INTO post_comments (post_id, author, body, created_at)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [Number(postId), me, content, Date.now()]
  );
  res.status(200).json({ ok: true, comment: rowToComment(rows[0]) });
}

async function removeComment(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '삭제할 댓글을 찾을 수 없습니다.' });

  const rows = await q(`SELECT * FROM post_comments WHERE id = $1`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 댓글입니다.' });
  const comment = rows[0];

  const admin = await currentAdmin(req);
  if (!admin && !isAuthor(me, comment)) {
    return res.status(403).json({ error: '내가 쓴 댓글만 삭제할 수 있습니다.' });
  }

  await q(`DELETE FROM post_comments WHERE id = $1`, [comment.id]);
  if (admin) await audit(admin, 'delete_comment', { id: comment.id, author: comment.author });
  res.status(200).json({ ok: true });
}

async function create(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const content = String(body(req).body || '').trim();
  if (!content) return res.status(400).json({ error: '내용을 입력해주세요.' });
  if (content.length > MAX_BODY) return res.status(400).json({ error: `내용은 ${MAX_BODY}자 이내로 입력해주세요.` });

  const rows = await q(
    `INSERT INTO posts (author, body, created_at) VALUES ($1,$2,$3) RETURNING *`,
    [me, content, Date.now()]
  );
  res.status(200).json({ ok: true, post: rowToPost(rows[0]) });
}

/**
 * 글을 찾고 권한을 확인한다.
 * 고치는 것은 글쓴이만, 지우는 것은 글쓴이와 관리자가 할 수 있다.
 */
async function authorize(req, res, id, { allowAdmin = true } = {}) {
  const me = await requireUser(req, res);
  if (!me) return null;

  const rows = await q(`SELECT * FROM posts WHERE id = $1`, [Number(id)]);
  if (!rows.length) {
    res.status(404).json({ error: '이미 삭제된 글입니다.' });
    return null;
  }
  const post = rows[0];

  if (isAuthor(me, post)) return post;
  if (allowAdmin && await currentAdmin(req)) return post;

  res.status(403).json({
    error: allowAdmin ? '내가 쓴 글만 삭제할 수 있습니다.' : '내가 쓴 글만 수정할 수 있습니다.',
  });
  return null;
}

async function update(req, res) {
  const { id, body: text } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '수정할 글을 찾을 수 없습니다.' });

  const content = String(text || '').trim();
  if (!content) return res.status(400).json({ error: '내용을 입력해주세요.' });
  if (content.length > MAX_BODY) return res.status(400).json({ error: `내용은 ${MAX_BODY}자 이내로 입력해주세요.` });

  // 수정은 글쓴이만 할 수 있다. 관리자에게는 삭제 권한만 준다.
  const post = await authorize(req, res, id, { allowAdmin: false });
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
