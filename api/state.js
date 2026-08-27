import { q, methodGuard, rowToPlayer, rowToMatch, rowToRequest } from './_lib.js';
import { syncSeason } from './_season.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    // 달이 바뀌었으면 여기서 지난 시즌을 마감하고 성적을 리셋한다.
    const season = await syncSeason();

    // 랭킹과 경기 기록은 이번 시즌 것만 보여준다. 지난 시즌 요약은 /api/season 이 준다.
    const [players, matches, requests] = await Promise.all([
      q(`SELECT * FROM players ORDER BY point DESC, wins DESC, handle ASC`),
      season
        ? q(`SELECT * FROM matches WHERE season = $1 ORDER BY ts ASC`, [season.id])
        : q(`SELECT * FROM matches ORDER BY ts ASC`),
      q(`SELECT * FROM requests ORDER BY requested_at ASC`),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      season,
      players: players.map(rowToPlayer),
      matches: matches.map(rowToMatch),
      requests: requests.map(rowToRequest),
    });
  } catch (e) {
    res.status(500).json({ error: 'DB 조회 실패: ' + e.message });
  }
}
