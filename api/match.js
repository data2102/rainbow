import {
  tx, body, methodGuard, requireUser, requireAdmin, audit,
  winGain, lossGain, cleanReason, ensureMatchVoid,
} from './_lib.js';
import { ensureSeason } from './_season.js';

/**
 * POST /api/match                     경기 기록 (로그인한 회원 누구나)
 * POST /api/match {action:'void'}     기록 취소  (관리자 이상)
 * POST /api/match {action:'restore'}  취소 되돌리기 (관리자 이상)
 */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const b = body(req);
  if (b.action === 'void') return voidMatch(req, res, b);
  if (b.action === 'restore') return restoreMatch(req, res, b);
  return record(req, res, b);
}

/* ---------- 기록 ---------- */

async function record(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { winners = [], losers = [] } = b;
  if (!Array.isArray(winners) || !Array.isArray(losers) || !winners.length || !losers.length) {
    return res.status(400).json({ error: '승리 팀과 패배 팀을 각각 1명 이상 선택해주세요.' });
  }
  const dup = winners.filter(w => losers.includes(w));
  if (dup.length) {
    return res.status(400).json({ error: '같은 선수를 양쪽에 동시에 넣을 수 없습니다: ' + dup.join(', ') });
  }

  try {
    const result = await tx(async (c) => {
      // 달이 바뀐 뒤 첫 기록이면 여기서 시즌을 넘긴다. 새 경기는 새 시즌에 들어간다.
      const season = await ensureSeason(c);
      const all = [...winners, ...losers];
      const { rows } = await c.query(
        `SELECT * FROM players WHERE handle = ANY($1) FOR UPDATE`, [all]
      );
      const found = new Set(rows.map(r => r.handle));
      const missing = all.filter(h => !found.has(h));
      if (missing.length) throw new Error('명단에 없는 선수입니다: ' + missing.join(', '));

      const now = new Date();
      const ts = now.getTime();
      const winnerResults = [];

      for (const h of winners) {
        const p = rows.find(r => r.handle === h);
        const streak = p.last_result === 'W' ? p.streak + 1 : 1;
        const gained = winGain(streak);
        await c.query(
          `UPDATE players SET point = point + $1, wins = wins + 1, streak = $2,
                  last_result = 'W', last_match = $3 WHERE handle = $4`,
          [gained, streak, now, h]
        );
        winnerResults.push({ handle: h, gained });
      }

      for (const h of losers) {
        const p = rows.find(r => r.handle === h);
        const streak = p.last_result === 'L' ? p.streak - 1 : -1;
        await c.query(
          `UPDATE players SET point = point + $1, losses = losses + 1, streak = $2,
                  last_result = 'L', last_match = $3 WHERE handle = $4`,
          [lossGain(), streak, now, h]
        );
      }

      await c.query(
        `INSERT INTO matches (winners, losers, ts, recorded_by, season) VALUES ($1, $2, $3, $4, $5)`,
        [JSON.stringify(winnerResults), JSON.stringify(losers), ts, me, season.current ? season.current.id : null]
      );

      return { winnerResults, ts };
    });

    await audit(me, 'record_match', { winners, losers });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/* ---------- 취소 · 되돌리기 ---------- */

async function voidMatch(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  let reason;
  try { reason = cleanReason(b.reason); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 기록인지 알 수 없습니다.' });
  }

  try {
    const at = Date.now();
    const m = await apply(id, async (c, row) => {
      if (row.voided_at != null) throw new Error('이미 취소된 기록입니다.');
      await c.query(
        `UPDATE matches SET voided_at = $1, voided_by = $2, void_reason = $3 WHERE id = $4`,
        [at, me, reason, id]
      );
    });
    await audit(me, 'void_match', {
      id, reason, ts: m.ts, winners: winnerHandles(m), losers: m.losers || [],
      recordedBy: m.recorded_by,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

async function restoreMatch(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 기록인지 알 수 없습니다.' });
  }

  try {
    const m = await apply(id, async (c, row) => {
      if (row.voided_at == null) throw new Error('취소된 기록이 아닙니다.');
      await c.query(
        `UPDATE matches SET voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = $1`,
        [id]
      );
    });
    await audit(me, 'restore_match', {
      id, ts: m.ts, winners: winnerHandles(m), losers: m.losers || [],
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * 기록 하나를 손보고 성적을 다시 계산한다.
 *
 * ensureSeason 이 거는 잠금 덕분에 새 경기 기록과 겹치지 않는다.
 * 두 사람이 동시에 취소를 눌러도 순서대로 한 번씩만 처리된다.
 */
async function apply(id, change) {
  await ensureMatchVoid();
  return tx(async (c) => {
    const season = await ensureSeason(c);
    const seasonId = season.current ? season.current.id : null;

    const { rows } = await c.query(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw new Error('없는 기록입니다.');
    const row = rows[0];

    // 마감된 달의 순위는 그대로 얼려둔다. 지난 기록을 건드리면 그때의
    // 최종 순위표와 어긋나므로, 진행 중인 달의 기록만 손댈 수 있다.
    if ((row.season || null) !== seasonId) {
      throw new Error('이미 마감된 달의 기록은 취소할 수 없습니다.');
    }

    await change(c, row);
    await replay(c, seasonId);
    return row;
  });
}

/**
 * 살아있는 기록만으로 시즌 성적을 처음부터 다시 계산한다.
 *
 * 취소한 경기의 점수만 빼는 방법은 쓸 수 없다. 연승 보너스 때문에 한 경기를
 * 들어내면 그 뒤 경기들의 획득 점수까지 달라지기 때문이다. 그래서 시즌 첫
 * 경기부터 순서대로 다시 돌린다. 한 달 경기 수가 많지 않아 이 편이 정확하고
 * 단순하다. 달라진 획득 점수는 기록에도 반영한다.
 */
async function replay(c, seasonId) {
  await c.query(
    `UPDATE players SET point = 0, wins = 0, losses = 0, streak = 0,
            last_result = NULL, last_match = NULL`
  );

  const { rows } = seasonId
    ? await c.query(
        `SELECT * FROM matches WHERE season = $1 AND voided_at IS NULL ORDER BY ts ASC, id ASC`,
        [seasonId])
    : await c.query(
        `SELECT * FROM matches WHERE season IS NULL AND voided_at IS NULL ORDER BY ts ASC, id ASC`);

  const stats = new Map();
  const of = (h) => {
    if (!stats.has(h)) {
      stats.set(h, { point: 0, wins: 0, losses: 0, streak: 0, lastResult: null, lastMatch: null });
    }
    return stats.get(h);
  };

  for (const m of rows) {
    const winners = Array.isArray(m.winners) ? m.winners : [];
    const losers = Array.isArray(m.losers) ? m.losers : [];
    const ts = Number(m.ts);
    const redone = [];

    for (const w of winners) {
      const h = typeof w === 'string' ? w : w.handle;
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'W' ? s.streak + 1 : 1;
      const gained = winGain(s.streak);
      s.point += gained;
      s.wins += 1;
      s.lastResult = 'W';
      s.lastMatch = ts;
      redone.push({ handle: h, gained });
    }

    for (const h of losers) {
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'L' ? s.streak - 1 : -1;
      s.point += lossGain();
      s.losses += 1;
      s.lastResult = 'L';
      s.lastMatch = ts;
    }

    if (JSON.stringify(redone) !== JSON.stringify(winners)) {
      await c.query(`UPDATE matches SET winners = $1 WHERE id = $2`, [JSON.stringify(redone), m.id]);
    }
  }

  for (const [handle, s] of stats) {
    await c.query(
      `UPDATE players SET point = $1, wins = $2, losses = $3, streak = $4,
              last_result = $5, last_match = $6 WHERE handle = $7`,
      [s.point, s.wins, s.losses, s.streak, s.lastResult,
       s.lastMatch == null ? null : new Date(s.lastMatch), handle]
    );
  }
}

function winnerHandles(row) {
  const w = Array.isArray(row.winners) ? row.winners : [];
  return w.map(x => (typeof x === 'string' ? x : x.handle));
}
