import { q, methodGuard, rowToPlayer, rowToMatch, rowToRequest } from './_lib.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const [players, matches, requests] = await Promise.all([
      q(`SELECT * FROM players ORDER BY point DESC, wins DESC, handle ASC`),
      q(`SELECT * FROM matches ORDER BY ts ASC`),
      q(`SELECT * FROM requests ORDER BY requested_at ASC`),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      players: players.map(rowToPlayer),
      matches: matches.map(rowToMatch),
      requests: requests.map(rowToRequest),
    });
  } catch (e) {
    res.status(500).json({ error: 'DB 조회 실패: ' + e.message });
  }
}
