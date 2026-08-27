import { tx, body, methodGuard, requireAdmin, audit, winGain, lossGain } from './_lib.js';
import { ensureSeason } from './_season.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const me = await requireAdmin(req, res);
  if (!me) return;

  const { winners = [], losers = [] } = body(req);
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
