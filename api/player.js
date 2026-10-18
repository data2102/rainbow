import {
  q, tx, body, methodGuard, requireAdmin, currentUser, audit, parseHandle,
  cleanEmail, hashPw, TEMP_PASSWORD, replay,
} from './_lib.js';
import { ensureSeason } from './_season.js';

/**
 * 회원(=계정) 정보를 관리자가 직접 손보는 곳.
 * '요청 → 승인' 절차를 거치지 않는 즉시 처리이므로 관리자 이상만 호출할 수 있다.
 * 경기 기록(matches)은 지우지 않는다. 지난 기록까지 사라지면 랭킹 이력이 어긋난다.
 */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const { action } = body(req);
    if (action === 'create') return await create(req, res);
    if (action === 'remove') return await remove(req, res);
    if (action === 'restore') return await restore(req, res);
    if (action === 'update') return await update(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

const MAX_HANDLE = 40;
const MAX_CLAN = 20;

/** 형식이 틀린 이메일은 서버 잘못이 아니므로 400 으로 돌려준다 */
function readEmail(req, res, out) {
  try {
    out.email = cleanEmail(body(req).email);
    return true;
  } catch (e) {
    res.status(400).json({ error: e.message });
    return false;
  }
}

/** 이름이 바뀌면 함께 따라가야 하는 표들. 나중에 생긴 표가 있으므로 있을 때만 손댄다. */
const RENAME_TABLES = [
  ['sessions', 'admin_id'],
  ['attendance', 'handle'],
  ['play_schedule', 'handle'],
  ['season_standings', 'handle'],
];

async function renameEverywhere(c, oldHandle, newHandle) {
  for (const [table, col] of RENAME_TABLES) {
    const { rows } = await c.query(`SELECT to_regclass($1) AS t`, ['public.' + table]);
    if (!rows[0].t) continue;
    await c.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [newHandle, oldHandle]);
  }
}

/* ---------- 추가 ---------- */

/**
 * 명단에 회원을 바로 넣는다. 가입 신청을 기다리지 않고 관리자가 대신 만들어 주는 길이다.
 * 비밀번호는 임시 비밀번호로 시작하고, 본인이 처음 로그인할 때 바꾸게 된다.
 */
async function create(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const handle = String(body(req).handle || '').trim();
  const clan = String(body(req).clan || '').trim();
  const parsedEmail = {};
  if (!readEmail(req, res, parsedEmail)) return;
  const email = parsedEmail.email;

  if (!handle) return res.status(400).json({ error: 'ID를 입력해주세요.' });
  if (handle.length > MAX_HANDLE) return res.status(400).json({ error: `ID는 ${MAX_HANDLE}자 이내로 입력해주세요.` });
  if (clan.length > MAX_CLAN) return res.status(400).json({ error: `CLAN은 ${MAX_CLAN}자 이내로 입력해주세요.` });

  const dup = await q(`SELECT 1 FROM players WHERE lower(handle) = lower($1)`, [handle]);
  if (dup.length) return res.status(409).json({ error: '이미 등록된 ID입니다: ' + handle });

  const parsed = parseHandle(handle);
  await q(
    `INSERT INTO players (handle, clan, name, email, pw_hash, role, point, wins, losses, streak)
     VALUES ($1,$2,$3,$4,$5,'member',0,0,0,0)`,
    [handle, clan || parsed.clan, parsed.name, email, hashPw(TEMP_PASSWORD)]
  );
  // 남아 있던 같은 아이디의 가입 신청은 이미 처리된 셈이므로 정리한다
  await q(`DELETE FROM requests WHERE type = 'add' AND lower(new_id) = lower($1)`, [handle]);

  await audit(me, 'create_player', { handle, clan: clan || parsed.clan, email });
  res.status(200).json({ ok: true, handle });
}

/* ---------- 삭제 ---------- */

async function remove(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const me = await currentUser(req);

  const handle = String(body(req).handle || '').trim();
  if (!handle) return res.status(400).json({ error: '삭제할 회원을 선택해주세요.' });
  if (handle === me.handle) {
    return res.status(400).json({ error: '자신의 계정은 삭제할 수 없습니다.' });
  }

  const target = await q(`SELECT role FROM players WHERE handle = $1`, [handle]);
  if (target.length && (target[0].role || 'member') === 'master') {
    if (me.role !== 'master') {
      return res.status(403).json({ error: '마스터 계정은 마스터만 삭제할 수 있습니다.' });
    }
    const masters = await q(`SELECT count(*)::int AS n FROM players WHERE role = 'master'`);
    if (masters[0].n <= 1) {
      return res.status(400).json({ error: '마스터가 최소 한 명은 있어야 합니다.' });
    }
  }

  const removed = await tx(async (c) => {
    const { rows } = await c.query(`DELETE FROM players WHERE handle = $1 RETURNING *`, [handle]);
    if (!rows.length) return null;
    // 이 회원을 대상으로 남아 있던 삭제 요청과 로그인 세션은 함께 정리한다
    await c.query(`DELETE FROM requests WHERE type = 'remove' AND target_id = $1`, [handle]);
    await c.query(`DELETE FROM sessions WHERE admin_id = $1`, [handle]);
    return rows[0];
  });

  if (!removed) return res.status(404).json({ error: '이미 삭제된 회원입니다.' });

  // 되살릴 때 쓸 값은 여기 남는 것이 전부다. 이메일·권한도 같이 적어 둔다.
  await audit(admin, 'remove_player', {
    handle, clan: removed.clan, point: removed.point, wins: removed.wins, losses: removed.losses,
    email: removed.email || '', role: removed.role || 'member',
  });
  res.status(200).json({ ok: true });
}

/* ---------- 되살리기 ---------- */

/**
 * 실수로 지운 회원을 되살린다.
 *
 * 지울 때 명단에서만 빠질 뿐 경기 기록은 그대로 남으므로, 명단에 다시 넣고
 * 이번 달 성적을 경기 기록에서 다시 세면 지우기 직전과 같아진다.
 * CLAN·이메일·권한은 삭제할 때 남긴 기록(audit_log)에서 꺼내 온다.
 *
 * 되돌릴 수 없는 것은 비밀번호뿐이다. 임시 비밀번호로 시작한다.
 */
async function restore(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const handle = String(body(req).handle || '').trim();
  if (!handle) return res.status(400).json({ error: '어떤 계정인지 알 수 없습니다.' });

  const dup = await q(`SELECT 1 FROM players WHERE lower(handle) = lower($1)`, [handle]);
  if (dup.length) return res.status(409).json({ error: '이미 명단에 있는 ID입니다: ' + handle });

  // 가장 마지막에 지운 기록을 본다. 지웠다 살렸다를 되풀이했어도 최근 것이 맞다.
  const logs = await q(
    `SELECT detail FROM audit_log
      WHERE action = 'remove_player' AND detail->>'handle' = $1
      ORDER BY ts DESC LIMIT 1`, [handle]
  );
  if (!logs.length) {
    return res.status(404).json({ error: '삭제 기록이 없어 되살릴 수 없습니다: ' + handle });
  }
  const was = logs[0].detail || {};

  const out = await tx(async (c) => {
    const season = await ensureSeason(c);
    const parsed = parseHandle(handle);
    await c.query(
      `INSERT INTO players (handle, clan, name, email, pw_hash, role, point, wins, losses, streak)
       VALUES ($1,$2,$3,$4,$5,$6,0,0,0,0)`,
      [handle, was.clan || parsed.clan, parsed.name, was.email || null,
       hashPw(TEMP_PASSWORD), was.role === 'master' ? 'member' : (was.role || 'member')]
    );
    // 경기 기록에서 이번 달 성적을 다시 센다 — 지우기 전 숫자가 그대로 돌아온다
    await replay(c, season.current ? season.current.id : null);
    const { rows } = await c.query(
      `SELECT handle, clan, point, wins, losses FROM players WHERE handle = $1`, [handle]
    );
    return rows[0];
  });

  await audit(me, 'restore_player', {
    handle, clan: out.clan, point: out.point, wins: out.wins, losses: out.losses,
    was: { point: was.point, wins: was.wins, losses: was.losses },
  });
  res.status(200).json({ ok: true, player: out, was });
}

/* ---------- 수정 ---------- */

/**
 * 회원의 ID(handle)·클랜·이메일을 고친다.
 *
 * ID 를 바꾸면 지난 경기 기록에 박혀 있는 이름도 함께 바꾼다.
 * 명단에서만 이름을 바꾸면 HISTORY 에는 STANDING 에 없는 이름이 남아,
 * 탈퇴한 사람처럼 보인다. 출석·시즌 기록도 같은 이유로 따라간다.
 *
 * email 은 보내지 않으면 건드리지 않는다. 빈 문자열을 보내면 지운다.
 */
async function update(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const oldHandle = String(body(req).handle || '').trim();
  const newHandle = String(body(req).newHandle || '').trim();
  const newClan = String(body(req).clan || '').trim();
  const hasEmail = Object.prototype.hasOwnProperty.call(body(req), 'email');
  const parsedEmail = {};
  if (hasEmail && !readEmail(req, res, parsedEmail)) return;
  const newEmail = parsedEmail.email || null;

  if (!oldHandle) return res.status(400).json({ error: '수정할 회원을 선택해주세요.' });
  if (!newHandle) return res.status(400).json({ error: 'ID를 입력해주세요.' });
  if (newHandle.length > MAX_HANDLE) return res.status(400).json({ error: `ID는 ${MAX_HANDLE}자 이내로 입력해주세요.` });
  if (newClan.length > MAX_CLAN) return res.status(400).json({ error: `CLAN은 ${MAX_CLAN}자 이내로 입력해주세요.` });

  const result = await tx(async (c) => {
    const cur = await c.query(`SELECT * FROM players WHERE handle = $1`, [oldHandle]);
    if (!cur.rows.length) return { error: '없는 회원입니다. 목록을 새로고침해주세요.' };

    const renamed = newHandle !== oldHandle;
    if (renamed) {
      const dup = await c.query(`SELECT 1 FROM players WHERE lower(handle) = lower($1)`, [newHandle]);
      // 대소문자만 바꾸는 것은 자기 자신이므로 막지 않는다
      if (dup.rows.length && newHandle.toLowerCase() !== oldHandle.toLowerCase()) {
        return { error: `이미 등록된 ID입니다: ${newHandle}` };
      }
    }

    const parsed = parseHandle(newHandle);
    await c.query(
      `UPDATE players SET handle = $1, clan = $2, name = $3 WHERE handle = $4`,
      [newHandle, newClan || parsed.clan, parsed.name, oldHandle]
    );
    if (hasEmail) {
      await c.query(`UPDATE players SET email = $1 WHERE handle = $2`, [newEmail, newHandle]);
    }

    let touched = 0;
    if (renamed) {
      // 경기 기록 안의 이름을 바꾼다. 건수가 적어 읽고 다시 쓰는 편이 안전하다.
      const ms = await c.query(
        `SELECT id, winners, losers FROM matches
          WHERE winners @> jsonb_build_array(jsonb_build_object('handle', $1::text))
             OR losers @> to_jsonb($1::text)`,
        [oldHandle]
      );
      for (const m of ms.rows) {
        const winners = (m.winners || []).map(w => (w.handle === oldHandle ? { ...w, handle: newHandle } : w));
        const losers = (m.losers || []).map(h => (h === oldHandle ? newHandle : h));
        await c.query(`UPDATE matches SET winners = $1, losers = $2 WHERE id = $3`,
          [JSON.stringify(winners), JSON.stringify(losers), m.id]);
        touched++;
      }
      await c.query(`UPDATE requests SET target_id = $1 WHERE target_id = $2`, [newHandle, oldHandle]);
      await c.query(`UPDATE requests SET new_id = $1 WHERE new_id = $2`, [newHandle, oldHandle]);
      await renameEverywhere(c, oldHandle, newHandle);
    }
    return { renamed, touched, before: cur.rows[0] };
  });

  if (result.error) return res.status(400).json({ error: result.error });

  const detail = { from: oldHandle, to: newHandle, clan: newClan, matches: result.touched };
  if (hasEmail && (result.before.email || null) !== newEmail) detail.email = newEmail;
  await audit(me, 'update_player', detail);
  res.status(200).json({ ok: true, matchesUpdated: result.touched });
}
