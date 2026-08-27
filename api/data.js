import {
  q, tx, body, methodGuard, requireAdmin, audit,
  normalizeMatch, parseHandle, hashPw, rowToPlayer, rowToMatch, rowToRequest,
} from './_lib.js';
import { syncSeason } from './_season.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const me = await requireAdmin(req, res);
  if (!me) return;

  try {
    if (req.method === 'GET') return await exportAll(res);
    const { action } = body(req);
    if (action === 'import') return await importAll(req, res, me);
    if (action === 'reset')  return await reset(req, res, me);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function exportAll(res) {
  const [players, matches, requests, admins] = await Promise.all([
    q(`SELECT * FROM players ORDER BY handle`),
    q(`SELECT * FROM matches ORDER BY ts`),
    q(`SELECT * FROM requests ORDER BY requested_at`),
    q(`SELECT id, must_change FROM admins ORDER BY id`),
  ]);
  res.status(200).json({
    players: players.map(rowToPlayer),
    matches: matches.map(rowToMatch),
    requests: requests.map(rowToRequest),
    // 비밀번호는 절대 내보내지 않습니다 (ID 목록만)
    admins: admins.map(a => ({ id: a.id, mustChangePassword: a.must_change })),
    exportedAt: Date.now(),
  });
}

async function importAll(req, res, me) {
  const { payload, mode = 'replace' } = body(req);
  await syncSeason();
  if (!payload || !Array.isArray(payload.players)) {
    return res.status(400).json({ error: '올바른 백업 형식이 아닙니다.' });
  }

  await tx(async (c) => {
    if (mode === 'replace') {
      await c.query(`DELETE FROM matches`);
      await c.query(`DELETE FROM requests`);
      await c.query(`DELETE FROM players`);
    }

    for (const p of payload.players) {
      const parsed = parseHandle(p.handle);
      await c.query(
        `INSERT INTO players (handle, clan, name, point, wins, losses, streak, last_result, last_match)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (handle) DO UPDATE SET
           clan=EXCLUDED.clan, name=EXCLUDED.name, point=EXCLUDED.point, wins=EXCLUDED.wins,
           losses=EXCLUDED.losses, streak=EXCLUDED.streak, last_result=EXCLUDED.last_result,
           last_match=EXCLUDED.last_match`,
        [p.handle, p.clan || parsed.clan, p.name || parsed.name, p.point || 0, p.wins || 0,
         p.losses || 0, p.streak || 0, p.lastResult || null, p.lastMatch || null]
      );
    }

    for (const raw of (payload.matches || [])) {
      const m = normalizeMatch(raw);
      await c.query(
        `INSERT INTO matches (winners, losers, ts, recorded_by, season) VALUES ($1,$2,$3,$4,$5)`,
        [JSON.stringify(m.winners || []), JSON.stringify(m.losers || []),
         m.ts || Date.now(), m.recordedBy || '이전 기록', m.season || null]
      );
    }

    for (const r of (payload.requests || [])) {
      await c.query(
        `INSERT INTO requests (id, type, new_id, new_clan, target_id, requested_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.type, r.newId || null, r.newClan || null, r.targetId || null, r.requestedAt || Date.now()]
      );
    }

    // 관리자 계정은 비밀번호가 포함된 경우에만 새로 추가 (기존 계정은 건드리지 않음)
    for (const a of (payload.admins || [])) {
      if (!a.id) continue;
      await c.query(
        `INSERT INTO admins (id, pw_hash, must_change) VALUES ($1,$2,TRUE) ON CONFLICT (id) DO NOTHING`,
        [a.id, hashPw(a.password && a.password.length >= 4 ? a.password : 'ChangeMe!' + Math.random().toString(36).slice(2, 8))]
      );
    }
  });

  await audit(me, 'import_data', { players: payload.players.length, matches: (payload.matches || []).length });
  res.status(200).json({ ok: true });
}

/**
 * 이번 시즌만 초기화한다. 지난 달 결산과 그 경기 기록은 그대로 둔다.
 * (매월 1일 자동 리셋과 같은 범위)
 */
async function reset(req, res, me) {
  const { keepPlayers = true } = body(req);
  const season = await syncSeason();
  await tx(async (c) => {
    if (season) await c.query(`DELETE FROM matches WHERE season = $1`, [season.id]);
    else await c.query(`DELETE FROM matches WHERE season IS NULL`);
    if (keepPlayers) {
      await c.query(`UPDATE players SET point=0, wins=0, losses=0, streak=0, last_result=NULL, last_match=NULL`);
    } else {
      await c.query(`DELETE FROM players`);
    }
  });
  await audit(me, 'reset', { keepPlayers, season: season ? season.id : null });
  res.status(200).json({ ok: true });
}
