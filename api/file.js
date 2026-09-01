import { q, body, methodGuard, currentAdmin, requireUser, audit } from './_lib.js';

/**
 * 자료실.
 *
 * 파일 자체는 사이트에 두지 않는다. Vercel 은 요청 한 번에 4.5MB 까지만
 * 실어 나르고 파일을 쌓아둘 디스크도 없어서, 1GB 짜리 설치 파일은 애초에
 * 지나가지 못한다. 그래서 파일은 구글 드라이브·MEGA 같은 곳에 두고
 * 여기에는 "어디서 받는지"만 적는다. 나중에 저장소를 붙이더라도 이 표의
 * 생김새는 그대로이고 받는 곳 주소만 바뀐다.
 *
 * 올리는 것은 로그인한 회원 누구나, 지우는 것은 올린 사람과 관리자만.
 */

export const KINDS = ['설치', '패치', '스킨', '타겟', '기타'];

const MAX_TITLE = 80;
const MAX_NOTE = 500;
const MAX_URL = 2000;
const MAX_SIZE_TEXT = 20;

let ensured = false;
async function ensureTable() {
  if (ensured) return;
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
  ensured = true;
}

/** 올린 사람 본인인가. 아이디는 로그인과 마찬가지로 대소문자를 가리지 않는다. */
function isAuthor(me, row) {
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
  const kind = KINDS.includes(b.kind) ? b.kind : KINDS[0];
  const note = String(b.note || '').trim();
  const sizeText = String(b.sizeText || '').trim().slice(0, MAX_SIZE_TEXT);
  const url = cleanUrl(b.url);
  return { title, kind, note, sizeText, url, pinned: !!b.pinned };
}

function checkFields(f) {
  if (!f.title) return '제목을 입력해주세요.';
  if (f.title.length > MAX_TITLE) return `제목은 ${MAX_TITLE}자 이내로 입력해주세요.`;
  if (f.note.length > MAX_NOTE) return `설명은 ${MAX_NOTE}자 이내로 입력해주세요.`;
  if (f.url === null) return '받는 곳 주소는 http:// 또는 https:// 로 시작해야 합니다.';
  return null;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTable();
    if (req.method === 'GET') return await list(res);

    const { action } = body(req);
    if (action === 'create') return await create(req, res);
    if (action === 'update') return await update(req, res);
    if (action === 'remove') return await remove(req, res);
    if (action === 'hit')    return await hit(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

/**
 * 중요글이 먼저, 그 다음 최신순.
 * 나누는 일은 화면이 하므로 여기서는 순서만 맞춰 통째로 준다.
 */
async function list(res) {
  const rows = await q(`SELECT * FROM files ORDER BY pinned DESC, created_at DESC`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ files: rows.map(rowToFile), kinds: KINDS });
}

async function create(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const f = readFields(req);
  const bad = checkFields(f);
  if (bad) return res.status(400).json({ error: bad });

  const rows = await q(
    `INSERT INTO files (kind, title, note, url, size_text, pinned, author, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [f.kind, f.title, f.note, f.url || null, f.sizeText || null, f.pinned, me, Date.now()]
  );
  res.status(200).json({ ok: true, file: rowToFile(rows[0]) });
}

/** 글을 찾고 권한을 확인한다. 고치는 것도 지우는 것도 올린 사람과 관리자만. */
async function findMine(req, res) {
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
  if (!admin && !isAuthor(me, rows[0])) {
    res.status(403).json({ error: '내가 올린 자료만 고치거나 지울 수 있습니다.' });
    return null;
  }
  return { me, admin, row: rows[0] };
}

async function update(req, res) {
  const found = await findMine(req, res);
  if (!found) return;

  const f = readFields(req);
  const bad = checkFields(f);
  if (bad) return res.status(400).json({ error: bad });

  const rows = await q(
    `UPDATE files SET kind=$1, title=$2, note=$3, url=$4, size_text=$5, pinned=$6, updated_at=$7
      WHERE id=$8 RETURNING *`,
    [f.kind, f.title, f.note, f.url || null, f.sizeText || null, f.pinned, Date.now(), found.row.id]
  );
  res.status(200).json({ ok: true, file: rowToFile(rows[0]) });
}

async function remove(req, res) {
  const found = await findMine(req, res);
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
async function hit(req, res) {
  const { id } = body(req);
  if (!Number.isInteger(Number(id))) return res.status(400).json({ error: '자료를 찾을 수 없습니다.' });
  const rows = await q(
    `UPDATE files SET downloads = downloads + 1 WHERE id = $1 RETURNING downloads`,
    [Number(id)]
  );
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 자료입니다.' });
  res.status(200).json({ ok: true, downloads: Number(rows[0].downloads) });
}
