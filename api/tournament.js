import { randomInt } from 'node:crypto';
import {
  q, body, methodGuard, requireUser, requireStaff, requireAdmin, audit,
  ensureEvent, rowToEvent,
} from './_lib.js';

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
    // 이벤트(1:1 대회)는 tournament_matches 를 쓰지 않는다. 회차 대회 표를
    // 만드느라 기다릴 까닭이 없어 먼저 가른다.
    if (req.method === 'GET' && req.query && req.query.event) return await eventCurrent(res);

    await ensureTable();
    if (req.method === 'GET') return await listMatches(res);

    const b = body(req);
    const { action } = b;
    if (action === 'record') return await record(req, res);
    if (action === 'delete') return await remove(req, res);
    if (action === 'eventMake') return await eventMake(req, res, b);
    if (action === 'eventPick') return await eventPick(req, res, b, false);
    if (action === 'eventUndo') return await eventPick(req, res, b, true);
    if (action === 'eventClose') return await eventDelete(req, res, b);
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
  const me = await requireStaff(req, res);
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
 * 기록 삭제·되돌리기는 **리더·웹마스터**가 한다.
 *
 * 토너먼트는 앞 판이 뒷 판의 대진을 정해서, 한 판을 지우면 그 뒤가 전부 어긋난다.
 * 넣는 것은 다시 넣으면 그만이지만 지우는 것은 그렇지 않아 문을 좁혔다.
 */
async function remove(req, res) {
  const me = await requireAdmin(req, res);
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

/* ===================================================================
 * 이벤트 (1:1 대회)
 *
 * 여기 얹혀 있는 까닭: Vercel Hobby 는 서버리스 함수가 12개까지인데 지금
 * 11개라 새 파일을 만들 수 없다. 같은 '대회' 갈래라 여기에 둔다.
 *
 * 대진표는 **첫 줄 자리(slots)와 고른 승자(picks)만** 저장하고 나머지 줄은
 * 그때그때 다시 센다(_lib.js 의 ensureEvent 주석 참고). 되돌리기가 뒷정리를
 * 따로 하지 않아도 되는 것은 그래서다.
 * =================================================================== */

/** 한 대회에 설 수 있는 사람 수. 2명 미만은 대회가 아니고, 64명이면 6회전이다. */
const EVENT_MIN = 2;
const EVENT_MAX = 64;
/** 기록 줄은 이만큼만 남긴다. 한 대회에서 이보다 더 누를 일은 없다. */
const EVENT_LOG_MAX = 300;

/** 자리를 섞는다. api/match.js 의 shuffle 과 같은 방식(크립토 난수). */
function evShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 인원을 '조'로 나눈다 — 부전승이 생기지 않도록.
 *
 * 2의 제곱이 아닌 인원을 한 덩어리로 짜면 빈자리가 생기고, 그 옆에 선 사람은
 * 싸우지 않고 올라간다. 26명이면 32자리에 빈자리 6개다.
 *
 * 대신 **조로 쪼갠다.** 조 크기가 2의 제곱이면 조 안에 빈자리가 없고,
 * 조 개수도 2의 제곱이면 조별 승자끼리 붙는 뒷 단계에도 빈자리가 없다.
 *   26 = 8+8+8+2 → 조마다 한 명이 남아 넷, 그 넷이 준결승·결승. 부전승 0.
 *
 * 나누는 법은 인원의 2진수 그대로다(26 = 16+8+2). 그 자리 수가 조 개수가
 * 되는데 2의 제곱이 아니면, 가장 큰 조를 반으로 쪼개 개수를 맞춘다
 * (16+8+2 → 8+8+8+2). 홀수 인원만은 1인 조가 하나 남아 — 그 한 명은
 * 부전승이 된다. 홀수는 어떻게 짜도 한 명이 남는다.
 */
function evSplit(n) {
  if (n < 2) return null;
  const parts = [];
  for (let b = 1; b <= n; b <<= 1) if (n & b) parts.push(b);
  let k = 1;
  while (k < parts.length) k *= 2;
  while (parts.length < k) {
    parts.sort((a, b) => b - a);
    const big = parts.shift();
    if (big < 2) return null;
    parts.push(big / 2, big / 2);
  }
  return parts.sort((a, b) => b - a);
}

const isPow2 = (v) => Number.isInteger(v) && v >= 1 && (v & (v - 1)) === 0;

/** 조 나누기가 쓸 수 있는 값인지 */
function evGroupsOk(groups, n) {
  if (!Array.isArray(groups) || !groups.length) return '조를 나눠주세요.';
  if (!isPow2(groups.length)) {
    return `조 개수는 1·2·4·8… 이어야 합니다 (지금 ${groups.length}조) — 그래야 조별 승자끼리 빈자리 없이 붙습니다.`;
  }
  for (const g of groups) {
    if (!isPow2(g)) return `조 인원은 1·2·4·8·16… 이어야 합니다 (${g}명짜리 조가 있습니다).`;
  }
  const sum = groups.reduce((a, b) => a + b, 0);
  if (sum !== n) return `조 인원을 더하면 ${sum}명인데 고른 사람은 ${n}명입니다.`;
  return null;
}

/**
 * 조 나누기로 대진 나무를 세운다.
 *
 * 잎(선수가 설 자리)에 0..n-1 번을 매기고, 조마다 그 범위를 반씩 갈라 내려가
 * 꽉 찬 나무를 만든다. 그 다음 조의 뿌리들을 둘씩 묶어 결승까지 올린다.
 * 칸 이름은 그 칸이 덮는 잎 범위(`시작-끝`)다 — 사람 수와 조가 같으면 늘
 * 같은 이름이 나오므로, 적어둔 승자(picks)가 다시 셀 때마다 제자리를 찾는다.
 */
function evTree(groups) {
  const full = (from, to) => (to - from === 1)
    ? { leaf: from, from, to }
    : { from, to, a: full(from, (from + to) / 2), b: full((from + to) / 2, to) };

  let at = 0;
  let nodes = groups.map((sz) => { const nd = full(at, at + sz); at += sz; return nd; });
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const a = nodes[i], b = nodes[i + 1];
      next.push({ from: a.from, to: b.to, a, b });
    }
    nodes = next;
  }
  return nodes[0];
}

/**
 * 나무를 훑어 칸 목록을 만든다. 화면은 이 목록만 보고 그린다.
 *
 * **두 사람이 다 정해진 칸만 결과를 가진다.** 앞 칸을 되돌리면 뒷 칸의 한쪽이
 * 비는데, 그때 남아 있던 옛 승자를 그대로 두면 올라오지도 않은 사람이 다음
 * 칸에 서 있게 된다. 다시 셀 때마다 버리므로 되돌리기가 뒷정리를 하지 않아도 된다.
 *
 * row 는 그 칸이 덮는 잎의 한가운데다. 화면은 이 값으로 세로 자리를 잡는다 —
 * 종이 대진표에서 두 선이 만나는 높이와 같은 뜻이다.
 */
function evWalk(node, slots, picks, out, depth) {
  if (node.leaf !== undefined) {
    return { who: slots[node.leaf] || null, row: node.leaf, id: null };
  }
  const a = evWalk(node.a, slots, picks, out, depth + 1);
  const b = evWalk(node.b, slots, picks, out, depth + 1);
  const id = `${node.from}-${node.to}`;
  let win = picks[id] || null;
  if (!a.who || !b.who || (win !== a.who && win !== b.who)) win = null;
  const row = (a.row + b.row) / 2;
  out.push({
    id, depth, row, win,
    a: a.who, b: b.who,
    aId: a.id, bId: b.id,
    aRow: a.row, bRow: b.row,
  });
  return { who: win, row, id };
}

function evBoard(slots, groups, picks) {
  const root = evTree(groups);
  const out = [];
  const top = evWalk(root, slots, picks, out, 0);
  const maxDepth = out.reduce((m, x) => Math.max(m, x.depth), 0);
  out.sort((x, y) => (y.depth - x.depth) || (x.row - y.row));
  return { matches: out, maxDepth, champion: top.who || null, rootId: top.id };
}

/** 화면이 바로 그릴 수 있게 대진표까지 붙여서 내보낸다 */
function evView(row) {
  const ev = rowToEvent(row);
  const groups = ev.groups || [ev.slots.length];
  const board = evBoard(ev.slots, groups, ev.picks);
  return {
    ...ev,
    groups,
    entrants: ev.slots.filter(Boolean),
    n: ev.slots.length,
    matches: board.matches,
    maxDepth: board.maxDepth,
    champion: board.champion,
  };
}

/** 지금 열려 있는 대회 하나. 없으면 null. */
async function eventCurrent(res) {
  await ensureEvent();
  const rows = await q(
    `SELECT * FROM event_brackets WHERE closed_at IS NULL ORDER BY ts DESC LIMIT 1`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ event: rows.length ? evView(rows[0]) : null });
}

/** 기록 한 줄 붙이기 — 누가 무엇을 눌렀는지가 남아야 되돌린 것도 보인다 */
function evLogged(log, entry) {
  const next = [entry, ...(log || [])];
  return next.slice(0, EVENT_LOG_MAX);
}

/** 대진표 만들기 — 리더·웹마스터만 */
async function eventMake(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  await ensureEvent();

  const entries = [...new Set((b.entries || []).map(h => String(h).trim()).filter(Boolean))];
  if (entries.length < EVENT_MIN) {
    return res.status(400).json({ error: `${EVENT_MIN}명 이상 골라주세요 · 지금 ${entries.length}명` });
  }
  if (entries.length > EVENT_MAX) {
    return res.status(400).json({ error: `${EVENT_MAX}명까지 넣을 수 있습니다 · 지금 ${entries.length}명` });
  }

  const found = new Set(
    (await q(`SELECT handle FROM players WHERE handle = ANY($1)`, [entries])).map(r => r.handle)
  );
  const missing = entries.filter(h => !found.has(h));
  if (missing.length) {
    return res.status(400).json({ error: '명단에 없는 선수입니다: ' + missing.join(', ') });
  }

  // 조 나누기. 적어 보내지 않으면 부전승이 가장 적게 나오는 쪽으로 서버가 고른다.
  const groups = Array.isArray(b.groups) && b.groups.length
    ? b.groups.map(v => Number(v))
    : evSplit(entries.length);
  if (!groups) {
    return res.status(400).json({ error: '이 인원은 조를 나눌 수 없습니다.' });
  }
  const bad = evGroupsOk(groups, entries.length);
  if (bad) return res.status(400).json({ error: bad });

  const title = String(b.title || '').trim().slice(0, 40);
  const ts = Date.now();
  // 선 차례를 섞는다. 고른 차례 그대로 세우면 누가 어느 조에 설지 미리 보인다.
  const slots = evShuffle(entries);

  // 열려 있던 대회는 닫는다. 지우지는 않는다 — 지난 대진표도 기록이다.
  await q(`UPDATE event_brackets SET closed_at = $1 WHERE closed_at IS NULL`, [ts]);

  const ins = await q(
    `INSERT INTO event_brackets (ts, made_by, title, slots, groups, picks, log)
     VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6) RETURNING *`,
    [ts, me, title || null, JSON.stringify(slots), JSON.stringify(groups),
     JSON.stringify([{ ts, by: me, what: 'make', n: entries.length, groups }])]
  );
  await audit(me, 'event_make', { id: Number(ins[0].id), n: entries.length, groups });
  res.status(200).json({ ok: true, event: evView(ins[0]) });
}

/** 그 칸에서 이긴 사람을 고른다 / 되돌린다 — 관리자 이상 */
async function eventPick(req, res, b, undo) {
  const me = await requireStaff(req, res);
  if (!me) return;
  await ensureEvent();

  const rows = await q(
    `SELECT * FROM event_brackets WHERE id = $1 AND closed_at IS NULL`, [Number(b.id)]
  );
  if (!rows.length) return res.status(404).json({ error: '지금 열려 있는 대회가 아닙니다.' });

  const ev = rowToEvent(rows[0]);
  const board = evBoard(ev.slots, ev.groups || [ev.slots.length], ev.picks);
  const key = String(b.match || '');
  const m = board.matches.find(x => x.id === key);
  if (!m) return res.status(400).json({ error: '없는 자리입니다.' });

  const picks = { ...ev.picks };
  let entry;

  if (undo) {
    if (!picks[key]) return res.status(400).json({ error: '아직 결과가 없는 자리입니다.' });
    entry = { ts: Date.now(), by: me, what: 'undo', match: key, was: picks[key] };
    delete picks[key];
  } else {
    if (!m.a || !m.b) return res.status(400).json({ error: '아직 두 사람이 다 정해지지 않았습니다.' });
    const win = String(b.winner || '').trim();
    if (win !== m.a && win !== m.b) {
      return res.status(400).json({ error: '그 자리에 있는 두 사람 중에서 고를 수 있습니다.' });
    }
    if (picks[key] === win) return res.status(400).json({ error: '이미 그렇게 적혀 있습니다.' });
    entry = { ts: Date.now(), by: me, what: 'pick', match: key, win, was: picks[key] || null };
    picks[key] = win;
  }

  const out = await q(
    `UPDATE event_brackets SET picks = $1, log = $2 WHERE id = $3 RETURNING *`,
    [JSON.stringify(picks), JSON.stringify(evLogged(ev.log, entry)), ev.id]
  );
  res.status(200).json({ ok: true, event: evView(out[0]) });
}

/** 대회 자체를 치운다 — 리더·웹마스터만 */
async function eventDelete(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;
  await ensureEvent();
  const rows = await q(
    `UPDATE event_brackets SET closed_at = $1 WHERE id = $2 AND closed_at IS NULL RETURNING id`,
    [Date.now(), Number(b.id)]
  );
  if (!rows.length) return res.status(404).json({ error: '이미 닫힌 대회입니다.' });
  await audit(me, 'event_close', { id: Number(rows[0].id) });
  res.status(200).json({ ok: true, event: null });
}
