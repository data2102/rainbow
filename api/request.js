import {
  q, body, methodGuard, requireAdmin, audit, genReqId, parseHandle,
  hashPw, TEMP_PASSWORD,
} from './_lib.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const { action } = body(req);
  try {
    if (action === 'createAdd')    return await createAdd(req, res);
    if (action === 'createRemove') return await createRemove(req, res);
    if (action === 'approve' || action === 'reject') return await resolve(req, res, action);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function createAdd(req, res) {
  const { id, clan } = body(req);
  if (!id || !clan) return res.status(400).json({ error: 'ID와 CLAN을 모두 입력해주세요.' });
  if (id.length > 40 || clan.length > 20) return res.status(400).json({ error: '입력값이 너무 깁니다.' });

  const p = await q(`SELECT 1 FROM players WHERE handle = $1`, [id]);
  if (p.length) return res.status(400).json({ error: '이미 등록된 ID입니다.' });
  const r = await q(`SELECT 1 FROM requests WHERE type='add' AND new_id = $1`, [id]);
  if (r.length) return res.status(400).json({ error: '이미 신청 대기 중인 ID입니다.' });

  await q(
    `INSERT INTO requests (id, type, new_id, new_clan, requested_at) VALUES ($1,'add',$2,$3,$4)`,
    [genReqId(), id, clan, Date.now()]
  );
  res.status(200).json({ ok: true });
}

async function createRemove(req, res) {
  const { targetId } = body(req);
  if (!targetId) return res.status(400).json({ error: '삭제할 회원을 선택해주세요.' });
  const p = await q(`SELECT 1 FROM players WHERE handle = $1`, [targetId]);
  if (!p.length) return res.status(400).json({ error: '명단에 없는 회원입니다.' });
  const r = await q(`SELECT 1 FROM requests WHERE type='remove' AND target_id = $1`, [targetId]);
  if (r.length) return res.status(400).json({ error: '이미 삭제 신청 대기 중인 회원입니다.' });

  await q(
    `INSERT INTO requests (id, type, target_id, requested_at) VALUES ($1,'remove',$2,$3)`,
    [genReqId(), targetId, Date.now()]
  );
  res.status(200).json({ ok: true });
}

async function resolve(req, res, action) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  const { id } = body(req);
  const rows = await q(`SELECT * FROM requests WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: '이미 처리된 요청입니다.' });
  const r = rows[0];

  if (action === 'approve') {
    if (r.type === 'add') {
      const exists = await q(`SELECT 1 FROM players WHERE handle = $1`, [r.new_id]);
      if (exists.length) {
        await q(`DELETE FROM requests WHERE id = $1`, [id]);
        return res.status(400).json({ error: '이미 존재하는 ID라 요청을 삭제했습니다.' });
      }
      // 승인과 동시에 로그인할 수 있는 계정이 된다. 권한은 일반부터.
      const parsed = parseHandle(r.new_id);
      await q(
        `INSERT INTO players (handle, clan, name, email, pw_hash, role)
         VALUES ($1,$2,$3,$4,$5,'member')`,
        [r.new_id, r.new_clan || parsed.clan, parsed.name, r.email || null, hashPw(TEMP_PASSWORD)]
      );
    } else {
      await q(`DELETE FROM players WHERE handle = $1`, [r.target_id]);
      await q(`DELETE FROM sessions WHERE admin_id = $1`, [r.target_id]);
    }
  }

  await q(`DELETE FROM requests WHERE id = $1`, [id]);
  // 누가 언제 승인·삭제했는지 남긴다 (ts 는 audit_log 가 자동으로 찍는다)
  const what = action === 'reject' ? 'reject_request'
    : (r.type === 'add' ? 'approve_add' : 'approve_remove');
  await audit(me, what, { target: r.new_id || r.target_id, clan: r.new_clan, email: r.email });
  res.status(200).json({ ok: true });
}
