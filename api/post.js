import { q, body, methodGuard, currentUser, currentAdmin, requireUser, requireAdmin, audit } from './_lib.js';

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
    await Promise.all([ensureTable(), ensureFileTable(), ensurePhotoTable()]);
    if (req.method === 'GET') {
      // 사이트에 담아둔 파일·사진 내려주기. 함수를 더 만들 수 없어 이 주소를 같이 쓴다.
      const dl = req.query && req.query.download;
      if (dl) return await sendBlob(req, res, dl);
      const ph = req.query && req.query.photo;
      if (ph) return await sendPhoto(req, res, ph, req.query.thumb === '1');
      return await listAll(req, res);
    }

    const { action } = body(req);
    if (action === 'fileCreate') return await fileCreate(req, res);
    if (action === 'fileUpdate') return await fileUpdate(req, res);
    if (action === 'fileRemove') return await fileRemove(req, res);
    if (action === 'fileHit')    return await fileHit(req, res);
    if (action === 'photoCreate') return await photoCreate(req, res);
    if (action === 'photoUpdate') return await photoUpdate(req, res);
    if (action === 'photoRemove') return await photoRemove(req, res);
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

/**
 * 사이트에 담아둔 파일을 그대로 내려준다.
 * 받아간 횟수는 여기서 올린다 — 화면이 따로 세면 실패한 내려받기까지 세어진다.
 */
async function sendBlob(req, res, idRaw) {
  // 주소만 알면 받아갈 수 있어서는 가려둔 뜻이 없다
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const id = Number(idRaw);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '자료를 찾을 수 없습니다.' });

  const rows = await q(
    `SELECT f.filename, f.mime, f.title, b.data
       FROM files f JOIN file_blobs b ON b.file_id = f.id
      WHERE f.id = $1`, [id]
  );
  if (!rows.length) return res.status(404).json({ error: '담아둔 파일이 없습니다.' });

  const r = rows[0];
  await q(`UPDATE files SET downloads = downloads + 1 WHERE id = $1`, [id]);

  // 이름에 따옴표나 줄바꿈이 섞이면 머리글이 깨진다. 한글 이름은 UTF-8 로 따로 적는다.
  const name = String(r.filename || r.title || `file-${id}`).replace(/[\r\n"]/g, '_');
  res.setHeader('Content-Type', r.mime || 'application/octet-stream');
  res.setHeader('Content-Length', r.data.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition',
    `attachment; filename="file-${id}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.status(200).send(r.data);
}

/** 게시판 글과 자료실을 한 번에. 화면은 두 곳 다 첫 화면에서 쓴다. */
/**
 * 게시판과 자료실을 한 번에 내려준다.
 *
 * 자료실은 로그인한 사람에게만 보낸다. 화면에서 가리는 것만으로는 주소를
 * 아는 사람이 그대로 받아갈 수 있어, 목록 자체를 보내지 않는다.
 * 게시판은 예전처럼 누구나 볼 수 있다.
 */
async function listAll(req, res) {
  const me = await currentUser(req);
  const [board, files, photos] = await Promise.all([
    listPosts(),
    me ? fileList() : Promise.resolve(null),
    me ? photoList() : Promise.resolve(null),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ...board,
    ...(files || { files: [], kinds: FILE_KINDS, maxUpload: MAX_UPLOAD }),
    ...(photos || { photos: [], photoMaxNote: MAX_PHOTO_NOTE }),
    filesLocked: !me,
  });
}

async function listPosts() {
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
  return {
    posts: rows.map(r => ({ ...rowToPost(r), comments: byPost.get(Number(r.id)) || [] })),
  };
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

/* ======================================================================
   자료실
   ----------------------------------------------------------------------
   원래 api/file.js 로 따로 두었는데, Vercel 무료 요금제는 배포 한 번에
   서버리스 함수를 12개까지만 허용한다. 자료실을 새 함수로 두면 그 선을
   넘어 배포 자체가 서지 않는다. 그래서 게시판과 한 함수에 담는다 —
   주소도 /api/post 하나를 같이 쓰고, action 앞에 file 을 붙여 가른다.
   ====================================================================== */

export const FILE_KINDS = ['설치', '패치', '스킨', '타겟', '이미지', '기타'];

const MAX_TITLE = 80;
const MAX_NOTE = 500;
const MAX_URL = 2000;
const MAX_SIZE_TEXT = 20;

/**
 * 사이트에 바로 담을 수 있는 크기.
 * Vercel 은 요청 한 번에 4.5MB 까지만 실어 나르는데, 파일을 글자로 바꿔
 * 보내면 3분의 4로 불어난다. 3MB 면 바뀐 뒤에도 4MB 남짓이라 안전하다.
 * 이보다 큰 파일은 구글 드라이브 같은 곳에 두고 주소만 적는다.
 */
export const MAX_UPLOAD = 3 * 1024 * 1024;

let filesEnsured = false;
async function ensureFileTable() {
  if (filesEnsured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS files (
      id         BIGSERIAL PRIMARY KEY,
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL,
      note       TEXT,
      url        TEXT,
      size_text  TEXT,
      pinned     BOOLEAN NOT NULL DEFAULT FALSE,
      downloads  INTEGER NOT NULL DEFAULT 0,
      author     TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    )`);
  // 중요글이 맨 앞, 그 다음이 최신순 — 목록이 뽑히는 순서 그대로 색인을 건다
  await q(`CREATE INDEX IF NOT EXISTS idx_files_order
             ON files (pinned DESC, created_at DESC)`);

  // 붙인 파일의 이름·종류·크기. 크기는 브라우저가 재서 보내주므로
  // 올린 사람이 손으로 적을 일이 없다.
  const has = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'files' AND column_name = 'bytes'`
  );
  if (!has.length) {
    await q(`ALTER TABLE files ADD COLUMN filename TEXT,
                                ADD COLUMN mime     TEXT,
                                ADD COLUMN bytes    BIGINT`);
  }

  // 파일 내용은 따로 담는다. 목록을 뽑을 때마다 수십 MB 를 같이 끌어오면 안 된다.
  await q(`
    CREATE TABLE IF NOT EXISTS file_blobs (
      file_id BIGINT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      data    BYTEA NOT NULL
    )`);
  filesEnsured = true;
}

/** 올린 사람 본인인가. 아이디는 로그인과 마찬가지로 대소문자를 가리지 않는다. */
function isFileAuthor(me, row) {
  return !!me && String(row.author).toLowerCase() === String(me).toLowerCase();
}

function rowToFile(r) {
  return {
    id: Number(r.id),
    kind: r.kind,
    title: r.title,
    note: r.note || '',
    url: r.url || '',
    sizeText: r.size_text || '',
    filename: r.filename || '',
    bytes: r.bytes == null ? null : Number(r.bytes),
    hasBlob: !!r.has_blob,
    pinned: !!r.pinned,
    downloads: Number(r.downloads || 0),
    author: r.author,
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
  };
}

/** 받는 곳은 http(s) 만 받는다. javascript: 같은 주소가 들어오면 안 된다. */
function cleanUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return null;
  if (s.length > MAX_URL) return null;
  return s;
}

function readFields(req) {
  const b = body(req);
  const title = String(b.title || '').trim();
  const kind = FILE_KINDS.includes(b.kind) ? b.kind : FILE_KINDS[0];
  const note = String(b.note || '').trim();
  const sizeText = String(b.sizeText || '').trim().slice(0, MAX_SIZE_TEXT);
  const url = cleanUrl(b.url);

  // 붙인 파일. data 가 있으면 사이트에 담고, 없으면 크기만 적어둔다
  // (너무 큰 파일은 브라우저가 크기만 재서 보낸다).
  const filename = String(b.filename || '').trim().slice(0, 200);
  const mime = String(b.mime || '').trim().slice(0, 120);
  const bytes = Number.isFinite(Number(b.bytes)) && Number(b.bytes) > 0
    ? Math.floor(Number(b.bytes)) : null;
  let data = null;
  if (typeof b.data === 'string' && b.data) {
    try { data = Buffer.from(b.data, 'base64'); } catch { data = null; }
  }
  return { title, kind, note, sizeText, url, pinned: !!b.pinned,
           filename, mime, bytes, data, dropBlob: b.dropBlob === true };
}

function checkFields(f) {
  if (!f.title) return '제목을 입력해주세요.';
  if (f.title.length > MAX_TITLE) return `제목은 ${MAX_TITLE}자 이내로 입력해주세요.`;
  if (f.note.length > MAX_NOTE) return `설명은 ${MAX_NOTE}자 이내로 입력해주세요.`;
  if (f.url === null) return '받는 곳 주소는 http:// 또는 https:// 로 시작해야 합니다.';
  if (f.data && f.data.length > MAX_UPLOAD) {
    return `사이트에 바로 담을 수 있는 파일은 ${Math.floor(MAX_UPLOAD / 1024 / 1024)}MB 까지입니다.`;
  }
  return null;
}

/** 파일 내용을 담거나 지운다. 한 자료에 파일은 하나다. */
async function putBlob(id, f) {
  if (f.data) {
    await q(
      `INSERT INTO file_blobs (file_id, data) VALUES ($1,$2)
       ON CONFLICT (file_id) DO UPDATE SET data = EXCLUDED.data`,
      [id, f.data]
    );
  } else if (f.dropBlob) {
    await q(`DELETE FROM file_blobs WHERE file_id = $1`, [id]);
  }
}

/**
 * 중요글이 먼저, 그 다음 최신순.
 * 나누는 일은 화면이 하므로 여기서는 순서만 맞춰 통째로 준다.
 */
async function fileList() {
  // data 는 뽑지 않는다 — 목록 한 번에 수십 MB 를 끌어오면 화면이 서지 않는다
  const rows = await q(
    `SELECT f.id, f.kind, f.title, f.note, f.url, f.size_text, f.filename, f.mime,
            f.bytes, f.pinned, f.downloads, f.author, f.created_at, f.updated_at,
            (b.file_id IS NOT NULL) AS has_blob
       FROM files f LEFT JOIN file_blobs b ON b.file_id = f.id
      ORDER BY f.pinned DESC, f.created_at DESC`
  );
  return { files: rows.map(rowToFile), kinds: FILE_KINDS, maxUpload: MAX_UPLOAD };
}

async function fileCreate(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const f = readFields(req);
  const bad = checkFields(f);
  if (bad) return res.status(400).json({ error: bad });

  const bytes = f.data ? f.data.length : f.bytes;
  const rows = await q(
    `INSERT INTO files (kind, title, note, url, size_text, pinned, author, created_at,
                        filename, mime, bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [f.kind, f.title, f.note, f.url || null, f.sizeText || null, f.pinned, me, Date.now(),
     f.filename || null, f.mime || null, bytes]
  );
  await putBlob(rows[0].id, f);
  res.status(200).json({ ok: true, id: Number(rows[0].id) });
}

/** 글을 찾고 권한을 확인한다. 고치는 것도 지우는 것도 올린 사람과 관리자만. */
async function findMyFile(req, res) {
  const me = await requireUser(req, res);
  if (!me) return null;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) {
    res.status(400).json({ error: '자료를 찾을 수 없습니다.' });
    return null;
  }
  const rows = await q(`SELECT * FROM files WHERE id = $1`, [Number(id)]);
  if (!rows.length) {
    res.status(404).json({ error: '이미 삭제된 자료입니다.' });
    return null;
  }
  const admin = await currentAdmin(req);
  if (!admin && !isFileAuthor(me, rows[0])) {
    res.status(403).json({ error: '내가 올린 자료만 고치거나 지울 수 있습니다.' });
    return null;
  }
  return { me, admin, row: rows[0] };
}

async function fileUpdate(req, res) {
  const found = await findMyFile(req, res);
  if (!found) return;

  const f = readFields(req);
  const bad = checkFields(f);
  if (bad) return res.status(400).json({ error: bad });

  // 새 파일을 붙이지 않았으면 이미 담아둔 크기를 그대로 둔다
  const bytes = f.data ? f.data.length : (f.bytes != null ? f.bytes : found.row.bytes);
  await q(
    `UPDATE files SET kind=$1, title=$2, note=$3, url=$4, size_text=$5, pinned=$6,
            updated_at=$7, filename=$8, mime=$9, bytes=$10
      WHERE id=$11`,
    [f.kind, f.title, f.note, f.url || null, f.sizeText || null, f.pinned, Date.now(),
     f.filename || found.row.filename || null, f.mime || found.row.mime || null,
     f.dropBlob && !f.data ? (f.bytes ?? null) : bytes, found.row.id]
  );
  await putBlob(found.row.id, f);
  res.status(200).json({ ok: true, id: Number(found.row.id) });
}

async function fileRemove(req, res) {
  const found = await findMyFile(req, res);
  if (!found) return;
  await q(`DELETE FROM files WHERE id = $1`, [found.row.id]);
  if (found.admin) {
    await audit(found.admin, 'delete_file', { id: Number(found.row.id), title: found.row.title });
  }
  res.status(200).json({ ok: true });
}

/**
 * 받아간 횟수를 하나 올린다.
 * 로그인을 요구하지 않는다 — 세는 것뿐이고, 막아서 얻는 것이 없다.
 */
async function fileHit(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '자료를 찾을 수 없습니다.' });
  const rows = await q(
    `UPDATE files SET downloads = downloads + 1 WHERE id = $1 RETURNING downloads`,
    [Number(id)]
  );
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 자료입니다.' });
  res.status(200).json({ ok: true, downloads: Number(rows[0].downloads) });
}

/* ==========================================================
   사진첩
   ----------------------------------------------------------
   자료실과 같은 함수 안에 둔다. Vercel 무료 플랜은 함수를
   열두 개까지만 올려주는데, 그 벽에 한 번 부딪혀 배포가 조용히
   깨진 적이 있다. 주소만 나눠 쓴다.
   ========================================================== */

/** 사진에 붙이는 한 줄 설명 */
const MAX_PHOTO_NOTE = 100;

let photosEnsured = false;
async function ensurePhotoTable() {
  if (photosEnsured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS photos (
      id         BIGSERIAL PRIMARY KEY,
      note       TEXT,
      filename   TEXT,
      mime       TEXT,
      bytes      BIGINT,
      author     TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_new ON photos (created_at DESC);

    -- 사진은 따로 담는다. 목록을 뽑을 때마다 원본을 끌어오면 화면이 선다.
    CREATE TABLE IF NOT EXISTS photo_blobs (
      photo_id BIGINT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
      data     BYTEA NOT NULL,
      thumb    BYTEA
    );
  `);
  photosEnsured = true;
}

function rowToPhoto(r) {
  return {
    id: Number(r.id),
    note: r.note || '',
    filename: r.filename || '',
    bytes: r.bytes == null ? null : Number(r.bytes),
    author: r.author,
    createdAt: Number(r.created_at),
  };
}

/** 목록에는 사진을 싣지 않는다. 스무 장이면 수십 MB 다. */
async function photoList() {
  const rows = await q(
    `SELECT id, note, filename, bytes, author, created_at
       FROM photos ORDER BY created_at DESC, id DESC`
  );
  return { photos: rows.map(rowToPhoto), photoMaxNote: MAX_PHOTO_NOTE };
}

/**
 * 사진 한 장을 그대로 내려준다.
 *
 * 격자에는 작은 것(thumb), 눌러서 크게 볼 때는 원본을 준다. 첨부가 아니라
 * 화면에 띄우는 것이므로 inline 으로 보낸다 — 새 창이 곧 사진이 된다.
 */
async function sendPhoto(req, res, idRaw, wantThumb) {
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const id = Number(idRaw);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '사진을 찾을 수 없습니다.' });

  const rows = await q(
    `SELECT p.mime, p.filename, b.data, b.thumb
       FROM photos p JOIN photo_blobs b ON b.photo_id = p.id
      WHERE p.id = $1`, [id]
  );
  if (!rows.length) return res.status(404).json({ error: '없는 사진입니다.' });

  const r = rows[0];
  // 작은 것이 없는 옛 사진은 원본으로 대신한다
  const buf = wantThumb && r.thumb ? r.thumb : r.data;
  const name = String(r.filename || `photo-${id}`).replace(/[\r\n"]/g, '_');
  res.setHeader('Content-Type', r.mime || 'image/jpeg');
  res.setHeader('Content-Length', buf.length);
  // 사진은 바뀌지 않는다. 한 번 받은 것은 브라우저가 들고 있게 둔다.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition',
    `inline; filename="photo-${id}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.status(200).send(buf);
}

async function photoCreate(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const b = body(req);
  const note = String(b.note || '').trim();
  if (note.length > MAX_PHOTO_NOTE) {
    return res.status(400).json({ error: `설명은 ${MAX_PHOTO_NOTE}자 이내로 적어주세요.` });
  }

  let data = null;
  let thumb = null;
  try { if (typeof b.data === 'string' && b.data) data = Buffer.from(b.data, 'base64'); } catch { data = null; }
  try { if (typeof b.thumb === 'string' && b.thumb) thumb = Buffer.from(b.thumb, 'base64'); } catch { thumb = null; }
  if (!data || !data.length) return res.status(400).json({ error: '사진을 골라주세요.' });
  if (data.length > MAX_UPLOAD) {
    return res.status(400).json({
      error: `사진 한 장은 ${Math.floor(MAX_UPLOAD / 1024 / 1024)}MB 까지입니다.`,
    });
  }

  const mime = String(b.mime || 'image/jpeg').trim().slice(0, 120);
  if (!/^image\//i.test(mime)) return res.status(400).json({ error: '사진 파일만 올릴 수 있습니다.' });

  const rows = await q(
    `INSERT INTO photos (note, filename, mime, bytes, author, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [note, String(b.filename || '').trim().slice(0, 200), mime, data.length, me, Date.now()]
  );
  const id = Number(rows[0].id);
  await q(`INSERT INTO photo_blobs (photo_id, data, thumb) VALUES ($1,$2,$3)`, [id, data, thumb]);
  res.status(200).json({ ok: true, id });
}

/** 올린 사람과 관리자만 손댈 수 있다 */
async function findMyPhoto(req, res) {
  const me = await requireUser(req, res);
  if (!me) return null;
  const id = Number(body(req).id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: '사진을 찾을 수 없습니다.' }); return null; }
  const rows = await q(`SELECT id, author FROM photos WHERE id = $1`, [id]);
  if (!rows.length) { res.status(404).json({ error: '이미 지워진 사진입니다.' }); return null; }
  const admin = await currentAdmin(req);
  if (!isFileAuthor(me, rows[0]) && !admin) {
    res.status(403).json({ error: '올린 사람과 관리자만 지울 수 있습니다.' });
    return null;
  }
  return { row: rows[0], me, admin };
}

async function photoUpdate(req, res) {
  const found = await findMyPhoto(req, res);
  if (!found) return;
  const note = String(body(req).note || '').trim();
  if (note.length > MAX_PHOTO_NOTE) {
    return res.status(400).json({ error: `설명은 ${MAX_PHOTO_NOTE}자 이내로 적어주세요.` });
  }
  await q(`UPDATE photos SET note = $1 WHERE id = $2`, [note, found.row.id]);
  res.status(200).json({ ok: true });
}

async function photoRemove(req, res) {
  const found = await findMyPhoto(req, res);
  if (!found) return;
  await q(`DELETE FROM photos WHERE id = $1`, [found.row.id]);
  if (found.admin) await audit(found.admin, 'delete_photo', { id: Number(found.row.id) });
  res.status(200).json({ ok: true });
}
