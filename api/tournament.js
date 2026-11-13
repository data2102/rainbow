import { q, body, methodGuard, requireAdmin, requireMaster, audit } from './_lib.js';

/**
 * 회차마다 참가 팀도 경기 방식도 다르다. 화면(app.js)의 TOURNAMENT_EDITIONS 와
 * 같아야 한다.
 *
 *   1회차 — 5팀. 예선 풀리그(group) 뒤 상위 4팀이 본선(final) 2패 탈락.
 *   2회차 — 아직 정리되지 않았다. 기록을 받지 않는다.
 *   3회차 — 4팀. 자리가 정해진 2패 탈락 여섯 판. 모두 3판 2선승.
 */
const TEAMS_BY_EDITION = {
  1: ['A', 'B', 'C', 'D', 'E'],
  3: ['A', 'B', 'C', 'D'],
};
const STAGES_BY_EDITION = {
  1: ['group', 'final'],
  3: ['q1', 'q2', 'wf', 'lf', 'ff', 'gf'],
};
/** 지금 진행 중인 회차 */
const LATEST_EDITION = 3;

/**
 * 구분만 보고 몇 회차인지 안다.
 *
 * 새로고침하지 않은 옛 화면은 edition 을 안 보낸다. 그 화면이 쓰는 말은
 * group·final 뿐이므로 1회차로 흘려보내면 된다 — 끝난 대회에 잘못 꽂히는
 * 일이 없도록, 못 알아보는 구분은 아예 받지 않는다.
 */
function editionOf(stage) {
  for (const [ed, list] of Object.entries(STAGES_BY_EDITION)) {
    if (list.includes(stage)) return Number(ed);
  }
  return null;
}

/**
 * 첫 대진. 화면(app.js)의 KO_SEEDS 와 같아야 한다.
 */
const KO_SEEDS = { q1: ['A', 'C'], q2: ['B', 'D'] };

/** 토너먼트 대진. 앞선 판이 정해지면 다음 판에 누가 오는지도 정해진다. */
function bracketKo(rows) {
  const pair = { q1: [...KO_SEEDS.q1], q2: [...KO_SEEDS.q2] };
  // 그 경기의 승자. 아직 2승을 채운 팀이 없으면 null 이다.
  const won = (st) => seriesOf(rows, st).winner;
  // 진 팀은 '그 자리의 두 팀 중 이기지 않은 쪽'이다. 두 팀이 정해져 있어야 안다.
  const lost = (st) => {
    const w = won(st);
    if (!w) return null;
    const p = pair[st] || [];
    return p.find(t => t && t !== w) || null;
  };
  pair.wf = [won('q1'), won('q2')];
  pair.lf = [lost('q1'), lost('q2')];
  pair.ff = [lost('wf'), won('lf')];
  pair.gf = [won('wf'), won('ff')];
  return pair;
}

/** 그 판이 정해지면 따라서 무너지는 뒷 판들 */
const DEPENDENTS = {
  q1: ['wf', 'lf', 'ff', 'gf'],
  q2: ['wf', 'lf', 'ff', 'gf'],
  wf: ['ff', 'gf'],
  lf: ['ff', 'gf'],
  ff: ['gf'],
  gf: [],
};

/**
 * 3판 2선승.
 *
 * 한 줄이 **한 판**이다 (`game` = 1·2·3). 판마다 누가 이겼는지를 따로 남기고,
 * 그 경기의 승자는 거기서 계산한다 — 먼저 두 판을 가져간 팀이다.
 * 2:0 이면 두 줄, 2:1 이면 세 줄이 쌓인다.
 */
const WIN_GAMES = 2;
const MAX_GAMES = 3;

/** 한 경기(한 자리)의 판들을 모아 승패를 센다 */
function seriesOf(rows, stage) {
  const games = rows.filter(m => m.stage === stage)
    .slice().sort((a, b) => Number(a.game || 0) - Number(b.game || 0));
  const wins = {};
  for (const g of games) wins[g.winner] = (wins[g.winner] || 0) + 1;
  const winner = Object.keys(wins).find(t => wins[t] >= WIN_GAMES) || null;
  return { games, wins, winner };
}

/** 자리 이름. 오류 문구에 그대로 쓴다. */
const STAGE_LABEL = {
  group: '예선', final: '본선',
  q1: '예선 1경기', q2: '예선 2경기',
  wf: '승자전', lf: '패자전', ff: '최종전', gf: '결승전',
};

/**
 * 테이블이 없으면 만들어 둔다.
 * db:setup 을 다시 돌리지 않고 배포해도 대회 탭이 동작하도록 하기 위한 안전장치로,
 * 콜드 스타트마다 한 번만 실행된다.
 */
let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id          BIGSERIAL PRIMARY KEY,
      stage       TEXT NOT NULL CHECK (stage IN ('group','final')),
      team_a      TEXT NOT NULL,
      team_b      TEXT NOT NULL,
      winner      TEXT NOT NULL,
      note        TEXT,
      ts          BIGINT NOT NULL,
      recorded_by TEXT
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tmatches_ts ON tournament_matches (ts DESC)`);
  // 2회차를 열면서 붙인 칸들. 이미 쌓인 기록은 모두 1회차다.
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS edition INTEGER NOT NULL DEFAULT 1`);
  // 3판 2선승의 세부 점수 (2:0 / 2:1). 1회차 기록에는 없다.
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS score_a INTEGER`);
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS score_b INTEGER`);
  // stage 에 'group','final' 만 허용하던 검사를 푼다. 2회차는 자리 이름을 쓴다.
  // 어떤 말이 올 수 있는지는 STAGES_BY_EDITION 이 코드에서 지킨다.
  await q(`ALTER TABLE tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_stage_check`);
  // 한 줄이 한 판이 되면서 붙인 칸 (1·2·3). 1회차 기록에는 없다.
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS game INTEGER`);
  // 이 대회를 2회차로 열었다가 3회차로 고쳤다. 그 사이에 들어간 기록이 있으면
  // 옮겨준다 — 자리 이름이 이 방식의 것이므로 어느 회차인지 헷갈릴 일이 없다.
  await q(
    `UPDATE tournament_matches SET edition = $1
      WHERE edition = 2 AND stage = ANY($2)`,
    [LATEST_EDITION, STAGES_BY_EDITION[LATEST_EDITION]]
  );
  await spreadOldSeries();
  ensured = true;
}

/**
 * 처음에는 한 경기를 한 줄(2:0 · 2:1)로 적었다. 지금은 판마다 한 줄이다.
 * 그 사이에 쌓인 기록이 있으면 판별로 펴준다.
 *
 * 몇 번째 판에서 누가 이겼는지는 그 줄에 안 남아 있다. 2:1 이면 '이김-짐-이김'
 * 으로 적어둔다 — 경기 결과는 그대로고 순서만 짐작이다. 순서가 중요하면
 * 관리자가 지우고 다시 넣으면 된다.
 */
async function spreadOldSeries() {
  const rows = await q(
    `SELECT * FROM tournament_matches
      WHERE edition = $1 AND game IS NULL AND score_a IS NOT NULL`,
    [LATEST_EDITION]
  );
  for (const r of rows) {
    const win = r.winner;
    const lose = r.winner === r.team_a ? r.team_b : r.team_a;
    const loserGames = (r.winner === r.team_a ? r.score_b : r.score_a) || 0;
    const order = loserGames ? [win, lose, win] : [win, win];
    await q(`DELETE FROM tournament_matches WHERE id = $1`, [r.id]);
    for (let i = 0; i < order.length; i++) {
      await q(
        `INSERT INTO tournament_matches
           (edition, stage, game, team_a, team_b, winner, note, ts, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.edition, r.stage, i + 1, r.team_a, r.team_b, order[i], r.note,
         Number(r.ts) + i, r.recorded_by]
      );
    }
  }
}

function rowToMatch(r) {
  return {
    id: Number(r.id),
    edition: Number(r.edition || 1),
    stage: r.stage,
    game: r.game == null ? null : Number(r.game),
    teamA: r.team_a,
    teamB: r.team_b,
    winner: r.winner,
    note: r.note,
    ts: Number(r.ts),
    recordedBy: r.recorded_by,
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    await ensureTable();
    if (req.method === 'GET') return await listMatches(res);

    const { action } = body(req);
    if (action === 'record') return await record(req, res);
    if (action === 'delete') return await remove(req, res);
    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    res.status(500).json({ error: '처리 실패: ' + e.message });
  }
}

async function listMatches(res) {
  const rows = await q(`SELECT * FROM tournament_matches ORDER BY ts ASC`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ matches: rows.map(rowToMatch) });
}

async function record(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const { stage, teamA, teamB, winner, note } = body(req);

  const edition = editionOf(stage);
  if (!edition) return res.status(400).json({ error: '어느 경기인지 알 수 없습니다.' });
  const TEAMS = TEAMS_BY_EDITION[edition];

  if (!TEAMS.includes(teamA) || !TEAMS.includes(teamB)) {
    return res.status(400).json({ error: '대회에 없는 팀입니다.' });
  }
  if (teamA === teamB) {
    return res.status(400).json({ error: '서로 다른 두 팀을 선택해주세요.' });
  }
  if (winner !== teamA && winner !== teamB) {
    return res.status(400).json({ error: '승리 팀은 선택한 두 팀 중 하나여야 합니다.' });
  }
  if (note && String(note).length > 60) {
    return res.status(400).json({ error: '메모는 60자 이내로 입력해주세요.' });
  }

  // 1회차 예선은 같은 팀끼리 한 번만 붙는다. 중복 기록은 순위를 왜곡한다.
  if (stage === 'group') {
    const dup = await q(
      `SELECT 1 FROM tournament_matches
        WHERE stage = 'group'
          AND ((team_a = $1 AND team_b = $2) OR (team_a = $2 AND team_b = $1))`,
      [teamA, teamB]
    );
    if (dup.length) {
      return res.status(400).json({
        error: `${teamA}팀과 ${teamB}팀의 예선 경기는 이미 기록되어 있습니다. 다시 기록하려면 기존 기록을 먼저 삭제하세요.`,
      });
    }
  }

  // 토너먼트는 붙을 두 팀을 앞선 결과가 정하고, 한 경기는 3판 2선승이다.
  // 화면에서도 그 두 팀만 누를 수 있지만 여기서도 막는다 — 어긋난 기록
  // 하나가 대진표 전체를 엉뚱하게 만들기 때문이다.
  let game = null;
  if (edition === LATEST_EDITION) {
    const rows2 = await q(`SELECT * FROM tournament_matches WHERE edition = $1`, [edition]);
    const want = bracketKo(rows2)[stage];
    if (!want[0] || !want[1]) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]}에 오를 팀이 아직 정해지지 않았습니다. 앞 경기부터 기록해주세요.`,
      });
    }
    if (!want.includes(teamA) || !want.includes(teamB)) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]}은 ${want[0]}팀과 ${want[1]}팀의 경기입니다.`,
      });
    }
    const series = seriesOf(rows2, stage);
    if (series.winner) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]}은 ${series.winner}팀이 ${WIN_GAMES}승으로 이미 끝났습니다.`,
      });
    }
    // 몇 번째 판인지는 서버가 센다. 화면이 보낸 값을 믿지 않는다.
    game = series.games.length + 1;
    if (game > MAX_GAMES) {
      return res.status(400).json({ error: `한 경기는 ${MAX_GAMES}판까지입니다.` });
    }
  }

  const rows = await q(
    `INSERT INTO tournament_matches
       (edition, stage, game, team_a, team_b, winner, note, ts, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [edition, stage, game, teamA, teamB, winner,
     note ? String(note).trim() || null : null, Date.now(), me]
  );
  await audit(me, 'record_tournament_match', { edition, stage, game, teamA, teamB, winner });
  res.status(200).json({ ok: true, match: rowToMatch(rows[0]) });
}

/**
 * 기록 삭제·되돌리기는 **리더만** 한다 (등록은 웹마스터도 된다).
 *
 * 토너먼트는 앞 판이 뒷 판의 대진을 정해서, 한 판을 지우면 그 뒤가 전부 어긋난다.
 * 넣는 것은 다시 넣으면 그만이지만 지우는 것은 그렇지 않아 문을 좁혔다.
 */
async function remove(req, res) {
  const me = await requireMaster(req, res);
  if (!me) return;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) {
    return res.status(400).json({ error: '삭제할 기록을 찾을 수 없습니다.' });
  }
  // 토너먼트는 앞 판이 뒷 판의 두 팀을 정한다. 가운데를 먼저 지우면 뒤가 뜬금없어지므로
  // 뒤에서부터 지우게 한다. 조용히 따라 지우지 않는 까닭은, 한 번 누른 것으로
  // 결승 기록까지 사라지면 되돌릴 길이 없기 때문이다.
  const [target] = await q(`SELECT * FROM tournament_matches WHERE id = $1`, [Number(id)]);
  if (!target) return res.status(404).json({ error: '이미 삭제된 기록입니다.' });
  if (Number(target.edition) === LATEST_EDITION) {
    const after = await q(
      `SELECT DISTINCT stage FROM tournament_matches WHERE edition = $1 AND stage = ANY($2)`,
      [target.edition, DEPENDENTS[target.stage] || []]
    );
    if (after.length) {
      const names = after.map(r => STAGE_LABEL[r.stage]).join(' · ');
      return res.status(400).json({
        error: `${STAGE_LABEL[target.stage]} 기록은 ${names} 이(가) 남아 있는 동안 지울 수 없습니다. 뒤 경기부터 지워주세요.`,
      });
    }
    // 같은 경기 안에서도 뒤 판부터 지운다. 2차전을 먼저 지우면 3차전이
    // 몇 번째 판인지 알 수 없어진다.
    const later = await q(
      `SELECT game FROM tournament_matches
        WHERE edition = $1 AND stage = $2 AND game > $3 ORDER BY game`,
      [target.edition, target.stage, Number(target.game || 0)]
    );
    if (later.length) {
      return res.status(400).json({
        error: `${STAGE_LABEL[target.stage]} ${target.game}차전은 ${later.map(r => r.game + '차전').join(' · ')}이 남아 있는 동안 지울 수 없습니다. 뒤 판부터 지워주세요.`,
      });
    }
  }

  const rows = await q(`DELETE FROM tournament_matches WHERE id = $1 RETURNING *`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 기록입니다.' });

  await audit(me, 'delete_tournament_match', rowToMatch(rows[0]));
  res.status(200).json({ ok: true });
}
