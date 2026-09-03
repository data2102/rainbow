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
    const who = (req.query && req.query.career) || null;
    if (who) {
      const card = await career(String(who));
      // 명단에도 지난 기록에도 없는 이름이다. 서버 잘못이 아니므로 404 로 알린다.
      if (!card) return res.status(404).json({ error: '기록이 없는 아이디입니다.' });
      return res.status(200).json(card);
    }
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

/**
 * 한 사람의 전체 누적 성적.
 *
 * 순위표는 달마다 0 에서 다시 시작한다. 그래서 "이 사람이 지금까지 몇 승을
 * 했나"는 어느 한 달만 봐서는 알 수 없다. 마감된 달은 season_standings 에
 * 그대로 남아 있고, 진행 중인 달은 players 에 있다 — 둘을 더하면 전체다.
 * (마감할 때 players 를 0 으로 되돌리므로 겹쳐 세지 않는다)
 */
async function career(handle) {
  const [totals, mine, past, mate] = await Promise.all([
    // 모두의 누적 점수. 등수를 매기려면 남들 것도 있어야 한다.
    q(`SELECT handle,
              sum(point)::int  AS point,
              sum(wins)::int   AS wins,
              sum(losses)::int AS losses
         FROM ( SELECT handle, point, wins, losses FROM season_standings
                UNION ALL
                SELECT handle, point, wins, losses FROM players ) t
        GROUP BY handle`),
    q(`SELECT handle, clan FROM players WHERE handle = $1`, [handle]),
    // 명단에서 빠진 사람도 지난 기록은 남는다. 클랜은 마지막으로 적힌 것을 쓴다.
    q(`SELECT clan FROM season_standings WHERE handle = $1
        ORDER BY season_id DESC LIMIT 1`, [handle]),
    // 이 사람이 낀 경기만 가져온다. 취소된 경기는 점수가 되돌려진 경기다.
    q(`SELECT winners, losers FROM matches
        WHERE voided_at IS NULL
          AND (winners @> jsonb_build_array(jsonb_build_object('handle', $1::text))
               OR losers @> to_jsonb($1::text))`, [handle]),
  ]);

  const me = totals.find(t => t.handle === handle);
  if (!me) return null;

  // 같은 점수는 같은 등수다
  const rank = totals.filter(t => t.point > me.point).length + 1;
  const tied = totals.filter(t => t.point === me.point).length > 1;

  // 같은 편으로 몇 번 뛰었고 그중 몇 번 이겼는가.
  // 늦은 참석자는 어느 편도 아니어서 세지 않는다.
  const map = new Map();
  for (const m of mate) {
    const win = (m.winners || []).map(w => w.handle);
    const lose = m.losers || [];
    const won = win.includes(handle);
    const side = won ? win : (lose.includes(handle) ? lose : null);
    if (!side) continue;
    for (const h of side) {
      if (h === handle) continue;
      const st = map.get(h) || { handle: h, games: 0, wins: 0 };
      st.games += 1;
      if (won) st.wins += 1;
      map.set(h, st);
    }
  }

  return {
    handle,
    clan: (mine[0] && mine[0].clan) || (past[0] && past[0].clan) || '',
    point: me.point,
    wins: me.wins,
    losses: me.losses,
    rank,
    tied,
    of: totals.length,
    mates: [...map.values()],
  };
}
