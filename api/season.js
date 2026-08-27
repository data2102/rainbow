import { q, methodGuard } from './_lib.js';
import { syncSeason, rowToSeason } from './_season.js';

/** 요약 표에 보여줄 등수 */
const SUMMARY_TOP = 10;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const current = await syncSeason();

    const [seasons, standings, counts] = await Promise.all([
      q(`SELECT * FROM seasons ORDER BY starts_at DESC`),
      q(`SELECT * FROM season_standings WHERE rank <= $1 ORDER BY season_id, rank`, [SUMMARY_TOP]),
      q(`SELECT season, count(*)::int AS n FROM matches WHERE season IS NOT NULL GROUP BY season`),
    ]);

    const byId = new Map();
    for (const s of standings) {
      if (!byId.has(s.season_id)) byId.set(s.season_id, []);
      byId.get(s.season_id).push({
        rank: s.rank, handle: s.handle, clan: s.clan,
        point: s.point, wins: s.wins, losses: s.losses,
      });
    }
    const matchCount = new Map(counts.map(r => [r.season, r.n]));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      current,
      top: SUMMARY_TOP,
      seasons: seasons.map(r => ({
        ...rowToSeason(r),
        matches: matchCount.get(r.id) || 0,
        standings: byId.get(r.id) || [],
      })),
    });
  } catch (e) {
    res.status(500).json({ error: '시즌 조회 실패: ' + e.message });
  }
}
