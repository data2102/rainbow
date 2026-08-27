import { q, tx, body, methodGuard, requireAdmin, audit, parseHandle } from './_lib.js';

/**
 * 관리자가 명단에서 회원을 바로 지운다.
 * '회원 삭제 요청 → 승인' 절차를 거치지 않는 즉시 삭제이므로 관리자만 호출할 수 있다.
 * 경기 기록(matches)은 그대로 둔다. 지난 기록까지 사라지면 랭킹 이력이 어긋난다.
 */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const { action } = body(req);
    if (action === 'remove') return await remove(req, res);
    if (action === 'update') return await update(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function remove(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const handle = String(body(req).handle || '').trim();
  if (!handle) return res.status(400).json({ error: '삭제할 회원을 선택해주세요.' });

  const removed = await tx(async (c) => {
    const { rows } = await c.query(`DELETE FROM players WHERE handle = $1 RETURNING *`, [handle]);
    if (!rows.length) return null;
    // 이 회원을 대상으로 남아 있던 삭제 요청은 함께 정리한다
    await c.query(`DELETE FROM requests WHERE type = 'remove' AND target_id = $1`, [handle]);
    return rows[0];
  });

  if (!removed) return res.status(404).json({ error: '이미 삭제된 회원입니다.' });

  await audit(me, 'remove_player', {
    handle, clan: removed.clan, point: removed.point, wins: removed.wins, losses: removed.losses,
  });
  res.status(200).json({ ok: true });
}

/**
 * 회원의 ID(handle)와 클랜을 고친다.
 *
 * ID 를 바꾸면 지난 경기 기록에 박혀 있는 이름도 함께 바꾼다.
 * 명단에서만 이름을 바꾸면 HISTORY 에는 STANDING 에 없는 이름이 남아,
 * 탈퇴한 사람처럼 보인다.
 */
async function update(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const oldHandle = String(body(req).handle || '').trim();
  const newHandle = String(body(req).newHandle || '').trim();
  const newClan = String(body(req).clan || '').trim();

  if (!oldHandle) return res.status(400).json({ error: '수정할 회원을 선택해주세요.' });
  if (!newHandle) return res.status(400).json({ error: 'ID를 입력해주세요.' });
  if (newHandle.length > 40) return res.status(400).json({ error: 'ID는 40자 이내로 입력해주세요.' });
  if (newClan.length > 20) return res.status(400).json({ error: 'CLAN은 20자 이내로 입력해주세요.' });

  const result = await tx(async (c) => {
    const cur = await c.query(`SELECT * FROM players WHERE handle = $1`, [oldHandle]);
    if (!cur.rows.length) return { error: '없는 회원입니다. 목록을 새로고침해주세요.' };

    const renamed = newHandle !== oldHandle;
    if (renamed) {
      const dup = await c.query(`SELECT 1 FROM players WHERE handle = $1`, [newHandle]);
      if (dup.rows.length) return { error: `이미 등록된 ID입니다: ${newHandle}` };
    }

    const parsed = parseHandle(newHandle);
    await c.query(
      `UPDATE players SET handle = $1, clan = $2, name = $3 WHERE handle = $4`,
      [newHandle, newClan || parsed.clan, parsed.name, oldHandle]
    );

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
    }
    return { renamed, touched };
  });

  if (result.error) return res.status(400).json({ error: result.error });

  await audit(me, 'update_player', { from: oldHandle, to: newHandle, clan: newClan, matches: result.touched });
  res.status(200).json({ ok: true, matchesUpdated: result.touched });
}
