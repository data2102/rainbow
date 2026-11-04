import { q, body, methodGuard, requireAdmin, audit } from './_lib.js';

/**
 * 회차마다 참가 팀도 경기 방식도 다르다. 화면(app.js)의 TOURNAMENT_EDITIONS 와
 * 같아야 한다.
 *
 *   1회차 — 5팀. 예선 풀리그(group) 뒤 상위 4팀이 본선(final) 2패 탈락.
 *   2회차 — 4팀. 자리가 정해진 2패 탈락 여섯 판. 모두 3판 2선승.
 */
const TEAMS_BY_EDITION = {
  1: ['A', 'B', 'C', 'D', 'E'],
  2: ['A', 'B', 'C', 'D'],
};
const STAGES_BY_EDITION = {
  1: ['group', 'final'],
  2: ['q1', 'q2', 'wf', 'lf', 'ff', 'gf'],
};
/** 지금 진행 중인 회차 */
const LATEST_EDITION = 2;

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

/** 2회차 대진. 앞선 판이 정해지면 다음 판에 누가 오는지도 정해진다. */
function bracket2(rows) {
  const by = {};
  for (const m of rows) by[m.stage] = m;
  const won = (m) => (m ? m.winner : null);
  const lost = (m) => (m ? (m.winner === m.team_a ? m.team_b : m.team_a) : null);
  return {
    q1: ['A', 'B'],
    q2: ['C', 'D'],
    wf: [won(by.q1), won(by.q2)],
    lf: [lost(by.q1), lost(by.q2)],
    ff: [lost(by.wf), won(by.lf)],
    gf: [won(by.wf), won(by.ff)],
  };
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

/** 3판 2선승. 이긴 쪽은 반드시 2승, 진 쪽은 0 또는 1승이다. */
const WIN_GAMES = 2;

/** 2회차 자리 이름. 오류 문구에 그대로 쓴다. */
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
  ensured = true;
}

function rowToMatch(r) {
  return {
    id: Number(r.id),
    edition: Number(r.edition || 1),
    stage: r.stage,
    scoreA: r.score_a == null ? null : Number(r.score_a),
    scoreB: r.score_b == null ? null : Number(r.score_b),
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

  const { stage, teamA, teamB, winner, note, loserGames } = body(req);

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

  // 3판 2선승. 이긴 쪽은 2승 고정이고, 진 쪽이 0승인지 1승인지만 받는다.
  let lost = null;
  if (edition === 2) {
    lost = Number(loserGames);
    if (!Number.isInteger(lost) || lost < 0 || lost >= WIN_GAMES) {
      return res.status(400).json({ error: '3판 2선승이므로 2:0 또는 2:1 로만 기록할 수 있습니다.' });
    }
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

  // 2회차는 자리마다 한 판뿐이고, 붙을 두 팀도 앞선 결과가 정한다.
  // 화면에서도 그 두 팀만 누를 수 있지만, 여기서도 막는다 — 어긋난 기록
  // 하나가 대진표 전체를 엉뚱하게 만들기 때문이다.
  if (edition === 2) {
    const rows2 = await q(`SELECT * FROM tournament_matches WHERE edition = 2`);
    if (rows2.some(m => m.stage === stage)) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]} 결과는 이미 기록되어 있습니다. 다시 기록하려면 먼저 지워주세요.`,
      });
    }
    const want = bracket2(rows2)[stage];
    if (!want[0] || !want[1]) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]}에 오를 팀이 아직 정해지지 않았습니다. 앞 경기부터 기록해주세요.`,
      });
    }
    const same = (want.includes(teamA) && want.includes(teamB));
    if (!same) {
      return res.status(400).json({
        error: `${STAGE_LABEL[stage]}은 ${want[0]}팀과 ${want[1]}팀의 경기입니다.`,
      });
    }
  }

  const scoreA = edition === 2 ? (winner === teamA ? WIN_GAMES : lost) : null;
  const scoreB = edition === 2 ? (winner === teamB ? WIN_GAMES : lost) : null;

  const rows = await q(
    `INSERT INTO tournament_matches
       (edition, stage, team_a, team_b, winner, score_a, score_b, note, ts, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [edition, stage, teamA, teamB, winner, scoreA, scoreB,
     note ? String(note).trim() || null : null, Date.now(), me]
  );
  await audit(me, 'record_tournament_match', { edition, stage, teamA, teamB, winner, scoreA, scoreB });
  res.status(200).json({ ok: true, match: rowToMatch(rows[0]) });
}

async function remove(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) {
    return res.status(400).json({ error: '삭제할 기록을 찾을 수 없습니다.' });
  }
  // 2회차는 앞 판이 뒷 판의 두 팀을 정한다. 가운데를 먼저 지우면 뒤가 뜬금없어지므로
  // 뒤에서부터 지우게 한다. 조용히 따라 지우지 않는 까닭은, 한 번 누른 것으로
  // 결승 기록까지 사라지면 되돌릴 길이 없기 때문이다.
  const [target] = await q(`SELECT * FROM tournament_matches WHERE id = $1`, [Number(id)]);
  if (!target) return res.status(404).json({ error: '이미 삭제된 기록입니다.' });
  if (Number(target.edition) === 2) {
    const after = await q(
      `SELECT stage FROM tournament_matches WHERE edition = 2 AND stage = ANY($1)`,
      [DEPENDENTS[target.stage] || []]
    );
    if (after.length) {
      const names = after.map(r => STAGE_LABEL[r.stage]).join(' · ');
      return res.status(400).json({
        error: `${STAGE_LABEL[target.stage]} 결과는 ${names} 이(가) 남아 있는 동안 지울 수 없습니다. 뒤 경기부터 지워주세요.`,
      });
    }
  }

  const rows = await q(`DELETE FROM tournament_matches WHERE id = $1 RETURNING *`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 기록입니다.' });

  await audit(me, 'delete_tournament_match', rowToMatch(rows[0]));
  res.status(200).json({ ok: true });
}
