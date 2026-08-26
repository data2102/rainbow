import { q, tx, body, methodGuard, requireAdmin, audit } from './_lib.js';

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
