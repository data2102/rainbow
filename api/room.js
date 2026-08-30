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
 *   auto   — 사이트가 읽은 공인 IP 로 곧장 붙는다. 설치할 것이 없다.
 *   radmin — Radmin VPN 을 켜고 그 안의 주소(26.…)로 붙는다.
 *
 * auto 는 방장 쪽 공유기에 UDP 2346 이 열려 있어야 한다(r6upnp.bat 이 열어준다).
 * 통신사가 공인 IP 를 주지 않는 회선이면 auto 로 방장을 할 수 없어 radmin 을 쓴다.
 */
export const CONN_MODES = ['auto', 'radmin'];
const DEFAULT_MODE = 'auto';

const MAX_MSG = 200;
/** 방마다 남겨두는 대화 수 */
const KEEP_MSG = 120;

let ensured = false;
async function ensureTables() {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS room_members (
      room      INTEGER NOT NULL,
      handle    TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      PRIMARY KEY (room, handle)
    )`);
  // 한 사람이 두 방에 동시에 있을 수는 없다
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_room_one ON room_members (handle)`);
  await q(`
    CREATE TABLE IF NOT EXISTS room_state (
      room       INTEGER PRIMARY KEY,
      running    BOOLEAN NOT NULL DEFAULT false,
      started_at BIGINT,
      started_by TEXT
    )`);
  // 방장의 Radmin 주소. 방을 연 사람이 어디에 있는지 알려주는 값이다.
  await q(`ALTER TABLE room_state ADD COLUMN IF NOT EXISTS address TEXT`);
  // 한 번 적은 주소는 계정에 남겨 다음부터 자동으로 채운다
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS radmin_ip TEXT`);
  // 어느 주소로 서로를 찾을지. 'auto' = 사이트가 읽은 공인 IP, 'radmin' = 직접 적어둔 주소
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS conn_mode TEXT`);
  await q(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id     BIGSERIAL PRIMARY KEY,
      room   INTEGER NOT NULL,
      handle TEXT,
      body   TEXT NOT NULL,
      ts     BIGINT NOT NULL
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_room_msg ON room_messages (room, id)`);
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

/** 아무도 없는 방은 대화와 실행 상태를 지운다. 다음 사람이 빈 방에서 시작하도록. */
async function closeEmptyRooms() {
  await q(`
    DELETE FROM room_messages
     WHERE room NOT IN (SELECT DISTINCT room FROM room_members)`);
  await q(`
    UPDATE room_state SET running = false, started_at = NULL, started_by = NULL, address = NULL
     WHERE room NOT IN (SELECT DISTINCT room FROM room_members)`);
}

async function system(room, text) {
  await q(`INSERT INTO room_messages (room, handle, body, ts) VALUES ($1, NULL, $2, $3)`,
    [room, text, Date.now()]);
}

/** 방마다 누가 있는지. 먼저 들어온 순서대로 — 맨 앞이 방장이다. */
async function roster() {
  const rows = await q(
    `SELECT room, handle, joined_at FROM room_members ORDER BY room, joined_at, handle`
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.room)) map.set(r.room, []);
    map.get(r.room).push(r.handle);
  }
  return map;
}

async function listRooms() {
  const [seats, states] = await Promise.all([roster(), q(`SELECT * FROM room_state`)]);
  const running = new Map(states.map(s => [s.room, s]));
  const rooms = [];
  for (let room = 1; room <= ROOM_COUNT; room++) {
    const members = seats.get(room) || [];
    const st = running.get(room);
    rooms.push({
      room,
      members,
      host: members[0] || null,
      running: !!(st && st.running),
      startedAt: st && st.started_at ? Number(st.started_at) : null,
      address: st && st.address ? st.address : null,
    });
  }
  return rooms;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTables();

    if (req.method === 'GET') {
      const me = await currentUser(req);
      // 목록을 읽는 것 자체가 "아직 있다"는 신호다
      if (me) {
        await q(`UPDATE room_members SET last_seen = $1 WHERE handle = $2`, [Date.now(), me.handle]);
      }
      await sweepIdle();

      const rooms = await listRooms();
      const mine = me ? rooms.find(r => r.members.includes(me.handle)) : null;
      // 접속 주소는 그 방에 들어와 있는 사람에게만 보인다
      for (const r of rooms) if (r !== mine) r.address = null;
      let messages = [];
      if (mine) {
        const rows = await q(
          `SELECT * FROM room_messages WHERE room = $1 ORDER BY id DESC LIMIT $2`,
          [mine.room, KEEP_MSG]
        );
        messages = rows.reverse().map(r => ({
          id: Number(r.id), handle: r.handle, body: r.body, ts: Number(r.ts),
        }));
      }

      // 방장이 지난번에 적어둔 주소를 미리 채워준다
      let savedAddress = null;
      let connMode = DEFAULT_MODE;
      if (me) {
        const rows = await q(`SELECT radmin_ip, conn_mode FROM players WHERE handle = $1`, [me.handle]);
        if (rows.length) {
          savedAddress = rows[0].radmin_ip;
          connMode = rows[0].conn_mode || DEFAULT_MODE;
        }
      }

      // 지금 이 사람이 어느 주소에서 들어왔는지. 방장이 되면 이 주소로 사람들이 찾아온다.
      const publicIp = clientIp(req);

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        rooms, messages, savedAddress, connMode, publicIp,
        publicIpUsable: isReachableIp(publicIp),
        myRoom: mine ? mine.room : null,
        capacity: ROOM_CAPACITY,
        network: VPN_NETWORK,
        networkPw: me ? VPN_PASSWORD : null,
      });
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
    if (n[0].n >= ROOM_CAPACITY) return { full: true };

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

  if (out.full) return res.status(400).json({ error: `${room}번방은 정원(${ROOM_CAPACITY}명)이 찼습니다.` });
  if (!out.already) {
    if (out.left) await system(out.left, `${me} 님이 나갔습니다.`);
    await system(room, out.first ? `${me} 님이 방을 열었습니다. (방장)` : `${me} 님이 들어왔습니다.`);
    if (out.left) await closeEmptyRooms();
  }
  res.status(200).json({ ok: true, room });
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

  await q(`INSERT INTO room_messages (room, handle, body, ts) VALUES ($1,$2,$3,$4)`,
    [room, me, text, Date.now()]);
  // 오래된 것부터 덜어낸다
  await q(
    `DELETE FROM room_messages
      WHERE room = $1 AND id NOT IN (
        SELECT id FROM room_messages WHERE room = $1 ORDER BY id DESC LIMIT $2)`,
    [room, KEEP_MSG]
  );
  res.status(200).json({ ok: true });
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
