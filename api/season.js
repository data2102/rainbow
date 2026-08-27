import { q, methodGuard, rowToMatch } from './_lib.js';
import { syncSeason, rowToSeason } from './_season.js';

/** 월간 결산 표에 보여줄 등수 */
const SUMMARY_TOP = 10;

/**
 * GET /api/season          → 시즌 목록(진행 중 + 마감된 달)
 * GET /api/season?id=2026-09 → 그 달의 전체 순위와 경기 기록
 */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const current = await syncSeason();
    const id = (req.query && req.query.id) || null;

    res.setHeader('Cache-Control', 'no-store');
    if (id) return res.status(200).json(await detail(id, current));

    const [seasons, counts] = await Promise.all([
      q(`SELECT * FROM seasons ORDER BY starts_at DESC`),
      q(`SELECT season, count(*)::int AS n FROM matches WHERE season IS NOT NULL GROUP BY season`),
    ]);
    const matchCount = new Map(counts.map(r => [r.season, r.n]));

    res.status(200).json({
      current,
      top: SUMMARY_TOP,
      seasons: seasons.map(r => ({ ...rowToSeason(r), matches: matchCount.get(r.id) || 0 })),
    });
  } catch (e) {
    res.status(500).json({ error: '시즌 조회 실패: ' + e.message });
  }
}

/**
 * 지난 달 화면을 그리는 데 필요한 것을 한 번에 준다.
 * 진행 중인 달은 /api/state 가 실시간으로 주므로 여기서 순위를 만들지 않는다.
 */
async function detail(id, current) {
  const [rows, standings, matches] = await Promise.all([
    q(`SELECT * FROM seasons WHERE id = $1`, [id]),
    q(`SELECT * FROM season_standings WHERE season_id = $1 ORDER BY rank`, [id]),
    q(`SELECT * FROM matches WHERE season = $1 ORDER BY ts ASC`, [id]),
  ]);
  if (!rows.length) throw new Error('없는 시즌입니다: ' + id);

  return {
    current,
    season: rowToSeason(rows[0]),
    players: standings.map(r => ({
      rank: r.rank,
      handle: r.handle,
      clan: r.clan,
      point: r.point,
      wins: r.wins,
      losses: r.losses,
      streak: r.streak,
    })),
    matches: matches.map(rowToMatch),
  };
}
