import { q, tx, body, methodGuard, currentUser, requireUser, clientIp, isReachableIp } from './_lib.js';

/**
 * 런쳐. 1번방부터 8번방까지, 방마다 최대 16명이 모여 이야기를 나누고
 * 다 모이면 방장이 게임을 띄운다.
 *
 * 방장은 따로 저장하지 않는다. "그 방에 가장 먼저 들어온 사람"이 방장이다.
 * 이렇게 두면 방장이 나가도 다음 사람에게 저절로 넘어간다.
 */

export const ROOM_COUNT = 8;
export const ROOM_CAPACITY = 16;
/** 방장이 고를 수 있는 정원의 아래끝. 혼자서는 게임이 안 되니 둘부터다. */
export const ROOM_CAPACITY_MIN = 2;
/** 방 이름 길이 */
export const MAX_TITLE = 24;

/**
 * 회선을 재는 방식의 판 번호.
 *
 * 재는 방법을 바꿀 때마다 올린다. 브라우저를 새로고침하지 않은 사람은 예전
 * 방식으로 잰 값을 계속 올려보내는데, 그 값을 그대로 섞으면 같은 화면에서
 * 어떤 사람은 새 잣대로, 어떤 사람은 옛 잣대로 재어진 값이 나란히 놓인다.
 * 판이 다르면 값을 받지 않고 비워둔다 — 틀린 값을 보여주느니 아직 못 쟀다고
 * 말하는 편이 낫다. 새로고침하면 곧바로 제 값이 들어온다.
 */
export const PING_VERSION = 3;

/** 사이트가 바뀌었는지 브라우저가 알아채는 표. 배포할 때마다 올린다. */
export const APP_VERSION = 39;

/** 이 시간 동안 아무 신호가 없으면 나간 것으로 본다 (브라우저를 그냥 닫는 경우) */
const IDLE_MS = 3 * 60 * 1000;

/**
 * Radmin VPN 네트워크. 회원들이 여기 모여야 게임이 서로를 본다.
 * 이름은 누구에게나 보여주고, 비밀번호는 로그인한 사람에게만 내려보낸다.
 * 사이트가 이 값으로 무엇을 하지는 않는다 — 회원이 Radmin 창에 직접 적는 안내일 뿐이다.
 */
export const VPN_NETWORK = 'rainbowsix12345';
export const VPN_PASSWORD = '987654';

/**
 * 서로를 찾는 방법.
 *   radmin — Radmin VPN 을 켜고 그 안의 주소(26.…)로 붙는다.
 *   auto   — 사이트가 읽은 공인 IP 로 곧장 붙는다. 켤 프로그램이 없다.
 *
 * 기본은 radmin 이다. auto 는 방장 쪽 공유기에 UDP 2346 이 열려 있어야 하는데,
 * 공유기가 UPnP 에 답하지 않거나 손댈 수 없는 집이 있어 모두에게 강요할 수 없다.
 * 공유기를 열어둔 사람은 각자 auto 로 바꾸면 된다.
 *
 * 방식은 사람마다 따로 두는데, 실제로 쓰이는 것은 그 방 방장의 방식뿐이다.
 * 참가자는 방에 걸린 주소로 붙기만 하므로 방 안에서 서로 달라도 상관없다.
 */
export const CONN_MODES = ['auto', 'radmin'];
const DEFAULT_MODE = 'radmin';

const MAX_MSG = 200;
/** 방마다 남겨두는 대화 수 */
const KEEP_MSG = 120;
/**
 * 대기실 대화도 같은 표에 담는다. 방 번호는 1번부터라 0 을 대기실 자리로 쓴다.
 * 방과 달리 비워지는 일이 없으므로, 늘 최근 것만 남기고 덜어낸다.
 */
const LOBBY = 0;

let ensured = false;
/**
 * 표가 없으면 만든다. 새 인스턴스가 처음 깨어날 때 한 번만 돈다.
 *
 * 예전에는 문장마다 따로 보내 열두 번을 오갔다. 왕복 한 번이 200ms 인
 * 회선에서는 그것만으로 2초가 넘어, 오랜만에 들어온 사람이 첫 클릭에서
 * 한참을 기다렸다. 서로 기댈 것이 없는 문장들이라 한 번에 보낸다.
 */
async function ensureTables() {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS room_members (
      room      INTEGER NOT NULL,
      handle    TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      PRIMARY KEY (room, handle)
    );
    -- 한 사람이 두 방에 동시에 있을 수는 없다
    CREATE UNIQUE INDEX IF NOT EXISTS idx_room_one ON room_members (handle);
    -- 각자 브라우저가 잰 사이트까지의 왕복 시간(ms)
    ALTER TABLE room_members ADD COLUMN IF NOT EXISTS rtt INTEGER;

    CREATE TABLE IF NOT EXISTS room_state (
      room       INTEGER PRIMARY KEY,
      running    BOOLEAN NOT NULL DEFAULT false,
      started_at BIGINT,
      started_by TEXT
    );
    -- 방장의 Radmin 주소. 방을 연 사람이 어디에 있는지 알려주는 값이다.
    ALTER TABLE room_state ADD COLUMN IF NOT EXISTS address TEXT;
    -- 방장이 정한 정원. 비어 있으면 기본값(16명)을 쓴다.
    ALTER TABLE room_state ADD COLUMN IF NOT EXISTS cap INTEGER;
    -- 방장이 붙인 이름. 비어 있으면 "N번방".
    ALTER TABLE room_state ADD COLUMN IF NOT EXISTS title TEXT;

    -- 한 번 적은 주소는 계정에 남겨 다음부터 자동으로 채운다
    ALTER TABLE players ADD COLUMN IF NOT EXISTS radmin_ip TEXT;
    -- 'auto' = 사이트가 읽은 공인 IP, 'radmin' = 직접 적어둔 주소
    ALTER TABLE players ADD COLUMN IF NOT EXISTS conn_mode TEXT;

    CREATE TABLE IF NOT EXISTS room_messages (
      id     BIGSERIAL PRIMARY KEY,
      room   INTEGER NOT NULL,
      handle TEXT,
      body   TEXT NOT NULL,
      ts     BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_room_msg ON room_messages (room, id);

    -- 로그인한 채 런쳐를 보고 있는 사람들. 방에 들어가기 전 대기실이다.
    CREATE TABLE IF NOT EXISTS lobby (
      handle    TEXT PRIMARY KEY,
      last_seen BIGINT NOT NULL
    );
    ALTER TABLE lobby ADD COLUMN IF NOT EXISTS rtt INTEGER;
  `);
  ensured = true;
}

/**
 * 접속 주소. 26.131.188.239 처럼 IPv4 만 받고, 뒤에 :포트가 붙어도 된다.
 * 이 값은 나중에 각자 컴퓨터에서 프로토콜 주소로 넘어가므로,
 * 형식을 여기서 좁게 막아 엉뚱한 문자가 섞여 들어가지 못하게 한다.
 */
export function cleanAddress(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(s);
  if (!m) throw new Error('접속 주소는 26.131.188.239 처럼 IP 형식으로 입력해주세요.');
  for (let i = 1; i <= 4; i++) {
    if (Number(m[i]) > 255) throw new Error('올바른 IP 주소가 아닙니다.');
  }
  if (m[5] && (Number(m[5]) < 1 || Number(m[5]) > 65535)) {
    throw new Error('포트 번호가 올바르지 않습니다.');
  }
  return s;
}

/** 방장이 적어 보낸 정원을 2~16 사이로 다듬는다. */
export function cleanCap(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < ROOM_CAPACITY_MIN || n > ROOM_CAPACITY) {
    throw new Error(`정원은 ${ROOM_CAPACITY_MIN}명부터 ${ROOM_CAPACITY}명까지 정할 수 있습니다.`);
  }
  return n;
}

/** 방 이름을 다듬는다. 비우면 기본 이름("N번방")으로 돌아간다. */
export function cleanTitle(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > MAX_TITLE) throw new Error(`방 이름은 ${MAX_TITLE}자 이내로 지어주세요.`);
  return s;
}

function checkRoom(n) {
  const room = Number(n);
  if (!Number.isInteger(room) || room < 1 || room > ROOM_COUNT) {
    throw new Error('없는 방입니다.');
  }
  return room;
}

/** 오래 조용한 사람을 내보낸다. 목록을 읽을 때마다 한 번씩 쓸어준다. */
async function sweepIdle() {
  const gone = await q(
    `DELETE FROM room_members WHERE last_seen < $1 RETURNING room, handle`,
    [Date.now() - IDLE_MS]
  );
  for (const g of gone) await system(g.room, `${g.handle} 님의 연결이 끊겨 나갔습니다.`);
  if (gone.length) await closeEmptyRooms();
}

/** 런쳐를 떠난 지 오래된 사람은 대기실에서도 지운다. */
async function sweepLobby() {
  await q(`DELETE FROM lobby WHERE last_seen < $1`, [Date.now() - IDLE_MS]);
}

/** 지금 런쳐를 보고 있는데 아직 방에 안 들어간 사람들. */
async function lobbyList() {
  const fresh = Date.now() - IDLE_MS;
  const rows = await q(
    `SELECT l.handle, l.rtt, l.last_seen FROM lobby l
      WHERE l.last_seen >= $1
        AND l.handle NOT IN (SELECT handle FROM room_members)
      ORDER BY l.last_seen DESC, l.handle`,
    [fresh]
  );
  return rows.map(r => ({
    handle: r.handle,
    rtt: r.rtt != null && Date.now() - Number(r.last_seen) < 15000 ? Number(r.rtt) : null,
  }));
}

/** 아무도 없는 방은 대화와 실행 상태를 지운다. 다음 사람이 빈 방에서 시작하도록. */
async function closeEmptyRooms() {
  await q(`
    DELETE FROM room_messages
     WHERE room <> $1 AND room NOT IN (SELECT DISTINCT room FROM room_members)`, [LOBBY]);
  // 정원도 함께 푼다 — 다음에 방을 여는 사람이 자기 인원에 맞춰 다시 정한다
  await q(`
    UPDATE room_state
        SET running = false, started_at = NULL, started_by = NULL, address = NULL,
            cap = NULL, title = NULL
     WHERE room <> $1 AND room NOT IN (SELECT DISTINCT room FROM room_members)`, [LOBBY]);
}

/** 대화 한 줄을 담고, 그 방에 남길 만큼만 남긴다. */
async function push(room, handle, text) {
  await q(`INSERT INTO room_messages (room, handle, body, ts) VALUES ($1,$2,$3,$4)`,
    [room, handle, text, Date.now()]);
  await q(
    `DELETE FROM room_messages
      WHERE room = $1 AND id NOT IN (
        SELECT id FROM room_messages WHERE room = $1 ORDER BY id DESC LIMIT $2)`,
    [room, KEEP_MSG]
  );
}

/** 최근 대화. 오래된 것부터 순서대로 돌려준다. */
async function readMsgs(room) {
  const rows = await q(
    `SELECT * FROM room_messages WHERE room = $1 ORDER BY id DESC LIMIT $2`, [room, KEEP_MSG]
  );
  return rows.reverse().map(r => ({
    id: Number(r.id), handle: r.handle, body: r.body, ts: Number(r.ts),
  }));
}

async function system(room, text) {
  await q(`INSERT INTO room_messages (room, handle, body, ts) VALUES ($1, NULL, $2, $3)`,
    [room, text, Date.now()]);
}

/** 방마다 누가 있는지. 먼저 들어온 순서대로 — 맨 앞이 방장이다. */
async function roster() {
  const rows = await q(
    `SELECT room, handle, joined_at, rtt, last_seen FROM room_members
      ORDER BY room, joined_at, handle`
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.room)) map.set(r.room, []);
    map.get(r.room).push({
      handle: r.handle,
      // 한참 소식이 없으면 지난 값은 못 믿는다
      rtt: r.rtt != null && Date.now() - Number(r.last_seen) < 15000 ? Number(r.rtt) : null,
    });
  }
  return map;
}

async function listRooms() {
  const [seats, states] = await Promise.all([roster(), q(`SELECT * FROM room_state`)]);
  const running = new Map(states.map(s => [s.room, s]));
  const rooms = [];
  for (let room = 1; room <= ROOM_COUNT; room++) {
    const detail = seats.get(room) || [];
    const members = detail.map(x => x.handle);
    const st = running.get(room);
    rooms.push({
      room,
      members,
      seats: detail,
      host: members[0] || null,
      title: st && st.title ? st.title : null,
      cap: st && st.cap ? Number(st.cap) : ROOM_CAPACITY,
      running: !!(st && st.running),
      startedAt: st && st.started_at ? Number(st.started_at) : null,
      address: st && st.address ? st.address : null,
    });
  }
  return rooms;
}

/**
 * 지금 런쳐 화면에 필요한 것 전부.
 *
 * 목록을 읽을 때도, 방에 들어간 직후에도 같은 것이 필요하다. 들어가고 나서
 * 다시 물어보면 왕복이 한 번 더 생기므로, 들어가기 응답에도 이것을 실어 보낸다.
 */
async function snapshot(req, me) {
  // 서로를 기다릴 이유가 없는 것들이라 함께 보낸다.
  // 하나씩 오가면 왕복만 네 번이라, 먼 회선에서는 그것만으로 1초가 넘는다.
  const [rooms, lobbyMessages, waitingList, mineRows] = await Promise.all([
    listRooms(),
    me ? readMsgs(LOBBY) : Promise.resolve([]),
    lobbyList(),
    me ? q(`SELECT radmin_ip, conn_mode FROM players WHERE handle = $1`, [me.handle])
       : Promise.resolve([]),
  ]);
  const mine = me ? rooms.find(r => r.members.includes(me.handle)) : null;
  // 접속 주소는 그 방에 들어와 있는 사람에게만 보인다
  for (const r of rooms) if (r !== mine) r.address = null;
  const messages = mine ? await readMsgs(mine.room) : [];

  // 방장이 지난번에 적어둔 주소를 미리 채워준다
  let savedAddress = null;
  let connMode = DEFAULT_MODE;
  if (mineRows.length) {
    savedAddress = mineRows[0].radmin_ip;
    connMode = mineRows[0].conn_mode || DEFAULT_MODE;
  }

  // 지금 이 사람이 어느 주소에서 들어왔는지. 방장이 되면 이 주소로 사람들이 찾아온다.
  const publicIp = clientIp(req);

  return {
    rooms, messages, lobbyMessages, savedAddress, connMode, publicIp,
    publicIpUsable: isReachableIp(publicIp),
    myRoom: mine ? mine.room : null,
    waiting: waitingList,
    capacity: ROOM_CAPACITY,
    capacityMin: ROOM_CAPACITY_MIN,
    maxTitle: MAX_TITLE,
    pingVersion: PING_VERSION,
    appVersion: APP_VERSION,
    network: VPN_NETWORK,
    networkPw: me ? VPN_PASSWORD : null,
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const me = await currentUser(req);
      // 목록을 읽는 것 자체가 "아직 있다"는 신호다
      if (me) {
        const now = Date.now();
        // 브라우저가 방금 잰 왕복 시간. 터무니없는 값은 버린다.
        // 값이 아예 없을 때를 먼저 걸러야 한다 — Number(null) 은 0 이라,
        // 그냥 넘기면 재본 적도 없는 사람이 0ms 로 기록된다.
        const url = new URL(req.url, 'http://x');
        const raw = url.searchParams.get('rtt');
        // 지금 쓰는 방식으로 잰 값만 받는다
        const same = Number(url.searchParams.get('pv')) === PING_VERSION;
        const n = !same || raw == null || raw === '' ? NaN : Number(raw);
        const rtt = Number.isFinite(n) && n >= 0 && n < 60000 ? Math.round(n) : null;
        // 자리 지킴과 대기실 표시는 서로 기댈 것이 없으니 함께 보낸다
        await Promise.all([
          // 예전 방식으로 재던 사람은 값을 비워 "아직 못 쟀음"으로 되돌린다
          q(same
            ? `UPDATE room_members SET last_seen = $1, rtt = COALESCE($3, rtt) WHERE handle = $2`
            : `UPDATE room_members SET last_seen = $1, rtt = $3 WHERE handle = $2`,
            [now, me.handle, rtt]),
          // 방에 있든 없든 런쳐를 보고 있다는 표시는 남긴다
          q(`INSERT INTO lobby (handle, last_seen, rtt) VALUES ($1, $2, $3)
               ON CONFLICT (handle) DO UPDATE
                  SET last_seen = EXCLUDED.last_seen,
                      rtt = ${same ? 'COALESCE(EXCLUDED.rtt, lobby.rtt)' : 'EXCLUDED.rtt'}`,
            [me.handle, now, rtt]),
        ]);
      }
      // 내 표시를 남긴 뒤에 쓸어야 나를 쓸어내지 않는다
      await Promise.all([sweepIdle(), sweepLobby()]);

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await snapshot(req, me));
    }

    const { action } = body(req);
    switch (action) {
      case 'enter': return await enter(req, res);
      case 'leave': return await leave(req, res);
      case 'say':   return await say(req, res);
      case 'start': return await start(req, res);
      case 'setIp': return await setIp(req, res);
      case 'giveHost': return await giveHost(req, res);
      case 'kick':     return await kick(req, res);
      case 'report':   return await report(req, res);
      case 'setCap':   return await setCap(req, res);
      case 'sayLobby': return await sayLobby(req, res);
      case 'setTitle': return await setTitle(req, res);
      default:      return res.status(400).json({ error: '알 수 없는 요청입니다.' });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/* ---------- 들어가기 · 나가기 ---------- */

async function enter(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const room = checkRoom(body(req).room);

  const out = await tx(async (c) => {
    // 방을 잠그고 정원을 센다. 동시에 열일곱 번째가 들어오지 못하도록.
    await c.query(`SELECT pg_advisory_xact_lock($1, $2)`, [77_001, room]);

    const { rows: here } = await c.query(
      `SELECT handle FROM room_members WHERE room = $1 AND handle = $2`, [room, me]
    );
    if (here.length) return { already: true };

    const { rows: n } = await c.query(
      `SELECT count(*)::int AS n FROM room_members WHERE room = $1`, [room]
    );
    const { rows: capRow } = await c.query(`SELECT cap FROM room_state WHERE room = $1`, [room]);
    const cap = capRow.length && capRow[0].cap ? Number(capRow[0].cap) : ROOM_CAPACITY;
    if (n[0].n >= cap) return { full: true, cap };

    // 다른 방에 있었다면 그 방에서는 나온다
    const { rows: before } = await c.query(
      `DELETE FROM room_members WHERE handle = $1 RETURNING room`, [me]
    );
    const now = Date.now();
    await c.query(
      `INSERT INTO room_members (room, handle, joined_at, last_seen) VALUES ($1,$2,$3,$3)`,
      [room, me, now]
    );
    return { left: before.length ? before[0].room : null, first: n[0].n === 0 };
  });

  if (out.full) return res.status(400).json({ error: `${room}번방은 정원(${out.cap}명)이 찼습니다.` });
  if (!out.already) {
    if (out.left) await system(out.left, `${me} 님이 나갔습니다.`);
    await system(room, out.first ? `${me} 님이 방을 열었습니다. (방장)` : `${me} 님이 들어왔습니다.`);
    if (out.left) await closeEmptyRooms();
  }
  // 들어간 직후의 화면을 함께 보낸다 — 받은 쪽이 다시 물어보지 않아도 되도록
  res.status(200).json({ ok: true, room, ...(await snapshot(req, { handle: me })) });
}

async function leave(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const gone = await q(`DELETE FROM room_members WHERE handle = $1 RETURNING room`, [me]);
  if (!gone.length) return res.status(200).json({ ok: true });
  const room = gone[0].room;

  await system(room, `${me} 님이 나갔습니다.`);
  // 방장이 나갔으면 다음 사람이 방장이 된다 (먼저 들어온 순서로 저절로 정해진다)
  const rest = await q(
    `SELECT handle FROM room_members WHERE room = $1 ORDER BY joined_at, handle LIMIT 1`, [room]
  );
  if (rest.length) await system(room, `${rest[0].handle} 님이 방장이 되었습니다.`);
  else await closeEmptyRooms();

  res.status(200).json({ ok: true });
}

/**
 * 방장이 정원을 정한다.
 *
 * 이미 들어와 있는 사람보다 적게는 줄일 수 없다. 줄이자고 남을 밀어내면
 * 누가 나가야 하는지 아무도 납득하지 못한다 — 내보내려면 강퇴를 쓴다.
 */
async function setCap(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const cap = cleanCap(body(req).cap);

  const out = await tx(async (c) => {
    const seat = await hostSeat(c, me);
    if (cap < seat.members) {
      throw new Error(`이미 ${seat.members}명이 들어와 있어 ${cap}명으로 줄일 수 없습니다.`);
    }
    await c.query(
      `INSERT INTO room_state (room, cap) VALUES ($1, $2)
         ON CONFLICT (room) DO UPDATE SET cap = EXCLUDED.cap`, [seat.room, cap]
    );
    return { room: seat.room };
  });

  await system(out.room, `${me} 님이 정원을 ${cap}명으로 정했습니다.`);
  res.status(200).json({ ok: true, cap });
}

/** 방장이 방 이름을 짓는다. 비우면 다시 "N번방" 이 된다. */
async function setTitle(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const title = cleanTitle(body(req).title);

  const room = await tx(async (c) => {
    const seat = await hostSeat(c, me);
    await c.query(
      `INSERT INTO room_state (room, title) VALUES ($1, $2)
         ON CONFLICT (room) DO UPDATE SET title = EXCLUDED.title`, [seat.room, title]
    );
    return seat.room;
  });

  await system(room, title
    ? `${me} 님이 방 이름을 "${title}" 로 바꿨습니다.`
    : `${me} 님이 방 이름을 되돌렸습니다.`);
  res.status(200).json({ ok: true, title });
}

/** 지금 이 사람이 방장인 방. 아니면 그 자리에서 막는다. */
async function hostSeat(c, me) {
  const { rows } = await c.query(
    `SELECT room, handle FROM room_members WHERE room =
       (SELECT room FROM room_members WHERE handle = $1)
      ORDER BY joined_at, handle`, [me]
  );
  if (!rows.length) throw new Error('방에 들어와 있지 않습니다.');
  if (rows[0].handle !== me) throw new Error('방장만 바꿀 수 있습니다.');
  return { room: rows[0].room, members: rows.length };
}

/* ---------- 대화 ---------- */

async function say(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const text = String(body(req).body || '').trim();
  if (!text) return res.status(400).json({ error: '보낼 말을 입력해주세요.' });
  if (text.length > MAX_MSG) return res.status(400).json({ error: `${MAX_MSG}자 이내로 입력해주세요.` });

  const rows = await q(`SELECT room FROM room_members WHERE handle = $1`, [me]);
  if (!rows.length) return res.status(400).json({ error: '먼저 방에 들어가주세요.' });

  const room = rows[0].room;
  await push(room, me, text);
  // 방금 담은 것까지 함께 돌려준다 — 보낸 쪽이 다시 물어보지 않아도 되도록
  res.status(200).json({ ok: true, messages: await readMsgs(room) });
}

/**
 * 대기실 대화.
 *
 * 방에 들어가기 전에 서로를 부르는 자리다. 방 안에서도 보낼 수 있게 두면
 * 어디에 쓴 말인지 헷갈리므로, 방 밖에 있는 사람만 쓴다.
 */
async function sayLobby(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const text = String(body(req).body || '').trim();
  if (!text) return res.status(400).json({ error: '보낼 말을 입력해주세요.' });
  if (text.length > MAX_MSG) return res.status(400).json({ error: `${MAX_MSG}자 이내로 입력해주세요.` });

  await push(LOBBY, me, text);
  res.status(200).json({ ok: true, messages: await readMsgs(LOBBY) });
}

/**
 * 서로를 어떻게 찾을지 정한다.
 * auto 면 사이트가 읽은 공인 IP 를 쓰므로 적을 것이 없고,
 * radmin 이면 Radmin 창에 보이는 내 주소를 적어둔다.
 */
async function setIp(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const b = body(req);

  const mode = b.mode === undefined ? null : String(b.mode);
  if (mode !== null && !CONN_MODES.includes(mode)) {
    return res.status(400).json({ error: '없는 접속 방식입니다.' });
  }

  const address = cleanAddress(b.address);
  if (mode === 'radmin' && !address) {
    return res.status(400).json({ error: 'Radmin 주소를 적어주세요.' });
  }

  // 방식만 바꿀 때는 적어둔 Radmin 주소를 건드리지 않는다.
  // 공인 IP 로 갔다가 돌아왔을 때 다시 적게 만들 이유가 없다.
  if (mode !== null && !address) {
    await q(`UPDATE players SET conn_mode = $1 WHERE handle = $2`, [mode, me]);
  } else if (mode === null) {
    await q(`UPDATE players SET radmin_ip = $1 WHERE handle = $2`, [address, me]);
  } else {
    await q(`UPDATE players SET radmin_ip = $1, conn_mode = $2 WHERE handle = $3`,
      [address, mode, me]);
  }

  const rows = await q(`SELECT radmin_ip FROM players WHERE handle = $1`, [me]);
  res.status(200).json({
    ok: true,
    address: rows.length ? rows[0].radmin_ip : address,
    mode: mode || undefined,
  });
}

/**
 * 각자의 런쳐가 무엇을 했는지 방에 남긴다.
 *
 * 게임이 실제로 켜지고 붙는지는 각자 컴퓨터 안의 일이라 사이트가 볼 수 없다.
 * 하지만 "누가 눌렀는지"까지는 알 수 있고, 그것만으로도 어디를 봐야 할지 갈린다.
 *   줄이 안 뜬다  → 그 사람이 안 눌렀거나 자동 실행이 안 굴렀다
 *   줄은 떴는데 게임이 안 켜진다 → 그 사람 컴퓨터의 설치 문제
 *   게임은 켜졌는데 못 붙는다   → 그제서야 네트워크를 본다
 */
async function report(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  // 방을 이미 나갔으면 남길 곳이 없다. 실패로 만들 일은 아니다.
  const rows = await q(`SELECT room FROM room_members WHERE handle = $1`, [me]);
  if (!rows.length) return res.status(200).json({ ok: true });

  const b = body(req);
  const going = b.event === 'create' ? '방을 열러' : '들어가러';
  let addr = null;
  try { addr = cleanAddress(b.address); } catch { addr = null; }

  await system(rows[0].room, `${me} 님이 런쳐를 눌렀습니다 — ${going} ${addr || '(주소 없음)'}`);
  res.status(200).json({ ok: true });
}

/* ---------- 방장이 하는 일 ---------- */

/**
 * 방장만 할 수 있는 일을 하기 전에 확인한다.
 * 내가 방장인지, 상대가 이 방에 있는지 본 뒤 방 번호를 돌려준다.
 * 방을 잠그고 보므로 두 사람이 동시에 눌러도 뒤엉키지 않는다.
 */
async function asHost(c, me, target) {
  const { rows: mine } = await c.query(`SELECT room FROM room_members WHERE handle = $1`, [me]);
  if (!mine.length) throw new Error('먼저 방에 들어가주세요.');
  const room = mine[0].room;
  await c.query(`SELECT pg_advisory_xact_lock($1, $2)`, [77_001, room]);

  const { rows } = await c.query(
    `SELECT handle, joined_at FROM room_members WHERE room = $1 ORDER BY joined_at, handle`, [room]
  );
  if (!rows.length || rows[0].handle !== me) throw new Error('방장만 할 수 있습니다.');
  if (target === me) throw new Error('자기 자신에게는 할 수 없습니다.');
  const t = rows.find(r => r.handle === target);
  if (!t) throw new Error('그 사람은 이 방에 없습니다.');
  return { room, first: rows[0], target: t };
}

function readTarget(req) {
  const h = String(body(req).handle || '').trim();
  if (!h) throw new Error('누구인지 알 수 없습니다.');
  return h;
}

/**
 * 방장 넘기기.
 *
 * 방장은 따로 저장하지 않는다. "먼저 들어온 사람"이 방장이다. 그래서 넘길 때도
 * 상대의 들어온 시각을 맨 앞으로 당긴다. 이러면 방장이 나갔을 때 다음 사람에게
 * 저절로 넘어가는 규칙이 그대로 살아 있고, 넘겨준 사람이 바로 다음 차례가 된다.
 */
async function giveHost(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const target = readTarget(req);

  const out = await tx(async (c) => {
    const { room, first } = await asHost(c, me, target);
    await c.query(
      `UPDATE room_members SET joined_at = $1 WHERE room = $2 AND handle = $3`,
      [Number(first.joined_at) - 1, room, target]
    );
    return { room };
  });

  await system(out.room, `${target} 님이 방장이 되었습니다. (${me} 님이 넘겨줌)`);
  res.status(200).json({ ok: true });
}

/** 방에서 내보내기. 다시 들어오는 것을 막지는 않는다. */
async function kick(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const target = readTarget(req);

  const out = await tx(async (c) => {
    const { room } = await asHost(c, me, target);
    await c.query(`DELETE FROM room_members WHERE room = $1 AND handle = $2`, [room, target]);
    return { room };
  });

  await system(out.room, `${target} 님을 방장이 내보냈습니다.`);
  res.status(200).json({ ok: true });
}

/* ---------- 실행 ---------- */

/**
 * 방장이 게임을 띄운다. 방에 있는 사람 모두에게 알리고, 조인하기 버튼이 열린다.
 * 방장의 Radmin 주소를 함께 받아 방에 걸어둔다 — 나머지는 그 주소로 찾아 들어간다.
 * 실제로 게임을 켜는 것은 각자의 컴퓨터에서 일어난다 (app.js 의 launchGame 참고).
 */
async function start(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;

  const rows = await q(`SELECT room FROM room_members WHERE handle = $1`, [me]);
  if (!rows.length) return res.status(400).json({ error: '먼저 방에 들어가주세요.' });
  const room = rows[0].room;

  // 사람들이 찾아올 주소를 정한다. 방식은 각자 계정에 적혀 있다.
  const who = await q(`SELECT radmin_ip, conn_mode FROM players WHERE handle = $1`, [me]);
  const mode = (who.length && who[0].conn_mode) || DEFAULT_MODE;
  let address;

  if (mode === 'radmin') {
    // 창에서 새로 적어 보냈으면 그것으로 갈아끼운다
    address = cleanAddress(body(req).address) || (who.length ? who[0].radmin_ip : null);
    if (!address) {
      return res.status(400).json({ error: 'Radmin 주소를 적어야 사람들이 찾아올 수 있습니다.' });
    }
    await q(`UPDATE players SET radmin_ip = $1 WHERE handle = $2`, [address, me]);
  } else {
    address = clientIp(req);
    if (!address) {
      return res.status(400).json({
        error: '접속 주소를 읽지 못했습니다. Radmin 방식으로 바꿔서 해주세요.',
      });
    }
    if (!isReachableIp(address)) {
      return res.status(400).json({
        error: `이 인터넷 회선(${address})은 밖에서 찾아올 수 없는 주소를 씁니다. `
             + '방장을 하려면 Radmin 방식으로 바꿔주세요. (참가는 그대로 됩니다)',
      });
    }
  }

  const first = await q(
    `SELECT handle FROM room_members WHERE room = $1 ORDER BY joined_at, handle LIMIT 1`, [room]
  );
  if (!first.length || first[0].handle !== me) {
    return res.status(403).json({ error: '방장만 실행할 수 있습니다.' });
  }

  const now = Date.now();
  await q(
    `INSERT INTO room_state (room, running, started_at, started_by, address)
     VALUES ($1, true, $2, $3, $4)
     ON CONFLICT (room) DO UPDATE
        SET running = true, started_at = $2, started_by = $3, address = $4`,
    [room, now, me, address]
  );
  await system(room, `${me} 님이 게임을 실행했습니다 · 접속 주소 ${address}`);
  res.status(200).json({ ok: true, room, startedAt: now, address, mode });
}
