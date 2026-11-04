import { q, body, methodGuard, requireAdmin, audit } from './_lib.js';

/** 1회차 대회에 참가한 팀. 화면(app.js)의 TOURNAMENT_TEAMS 와 같아야 한다. */
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const STAGES = ['group', 'final'];

/**
 * 3회차 대진. 화면(app.js)의 T3_TEAMS · T3_SLOTS 와 같아야 한다.
 *
 * 모든 판이 3판 2선승이다. 예선 두 판의 승자는 승자전, 패자는 패자전으로 가고
 * 승자전 승자와 패자전 승자가 결승에서 만난다.
 *
 * 1회차와 달리 화면은 팀을 보내지 않는다 — 누가 붙는지는 앞 판 결과로 정해지므로
 * 서버가 여기서 계산한다. 화면이 정하게 두면 대진에 없는 짝이 기록될 수 있다.
 */
const T3_TEAMS = ['A', 'B', 'C', 'D'];
const T3_SLOTS = ['q1', 'q2', 'wb', 'lb', 'gf'];
const T3_SCORES = ['2:0', '2:1'];
/** 이 판이 끝나야 정해지는 다음 판. 앞 판을 지우면 뒤 판이 근거를 잃는다. */
const T3_NEXT = { q1: ['wb', 'lb'], q2: ['wb', 'lb'], wb: ['gf'], lb: ['gf'], gf: [] };

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
      stage       TEXT NOT NULL,
      team_a      TEXT NOT NULL,
      team_b      TEXT NOT NULL,
      winner      TEXT NOT NULL,
      note        TEXT,
      ts          BIGINT NOT NULL,
      recorded_by TEXT
    )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tmatches_ts ON tournament_matches (ts DESC)`);
  // 회차가 생기기 전에 만든 표에는 stage 가 예선/본선 둘로 묶여 있다.
  // 3회차는 판 이름(q1·wb…)을 stage 에 담으므로 그 제약을 풀고, 회차와 세트 점수 칸을 더한다.
  // 예전 기록은 모두 1회차로 남는다(DEFAULT 1).
  await q(`ALTER TABLE tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_stage_check`);
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS edition INT NOT NULL DEFAULT 1`);
  await q(`ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS score TEXT`);
  ensured = true;
}

function rowToMatch(r) {
  return {
    id: Number(r.id),
    edition: Number(r.edition || 1),
    stage: r.stage,
    score: r.score || null,
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
    if (action === 'record') {
      return Number(body(req).edition) === 3 ? await record3(req, res) : await record(req, res);
    }
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

  if (!STAGES.includes(stage)) {
    return res.status(400).json({ error: '예선 또는 본선을 선택해주세요.' });
  }
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

  // 예선은 같은 팀끼리 한 번만 붙는다. 중복 기록은 순위를 왜곡하므로 막는다.
  if (stage === 'group') {
    const dup = await q(
      `SELECT 1 FROM tournament_matches
        WHERE stage = 'group' AND edition = 1
          AND ((team_a = $1 AND team_b = $2) OR (team_a = $2 AND team_b = $1))`,
      [teamA, teamB]
    );
    if (dup.length) {
      return res.status(400).json({
        error: `${teamA}팀과 ${teamB}팀의 예선 경기는 이미 기록되어 있습니다. 다시 기록하려면 기존 기록을 먼저 삭제하세요.`,
      });
    }
  }

  const rows = await q(
    `INSERT INTO tournament_matches (stage, team_a, team_b, winner, note, ts, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [stage, teamA, teamB, winner, note ? String(note).trim() || null : null, Date.now(), me]
  );
  await audit(me, 'record_tournament_match', { stage, teamA, teamB, winner });
  res.status(200).json({ ok: true, match: rowToMatch(rows[0]) });
}

/** 3회차에서 이 판에 누가 붙는지. 앞 판이 아직이면 null */
function t3Pair(slot, bySlot) {
  const won = m => (m ? m.winner : null);
  const lost = m => (m ? (m.winner === m.team_a ? m.team_b : m.team_a) : null);
  const pair = {
    q1: ['A', 'B'],
    q2: ['C', 'D'],
    wb: [won(bySlot.q1), won(bySlot.q2)],
    lb: [lost(bySlot.q1), lost(bySlot.q2)],
    gf: [won(bySlot.wb), won(bySlot.lb)],
  }[slot];
  return pair && pair[0] && pair[1] ? pair : null;
}

async function record3(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const { stage, winner, score } = body(req);
  if (!T3_SLOTS.includes(stage)) return res.status(400).json({ error: '대진에 없는 경기입니다.' });
  if (!T3_SCORES.includes(score)) return res.status(400).json({ error: '세트 점수는 2:0 또는 2:1 이어야 합니다.' });

  const rows = await q(`SELECT * FROM tournament_matches WHERE edition = 3`);
  const bySlot = Object.fromEntries(rows.map(r => [r.stage, r]));
  if (bySlot[stage]) {
    return res.status(400).json({ error: '이미 결과가 기록된 경기입니다. 다시 기록하려면 기존 기록을 먼저 삭제하세요.' });
  }
  const pair = t3Pair(stage, bySlot);
  if (!pair) return res.status(400).json({ error: '앞 경기 결과가 아직 없어 누가 붙는지 정해지지 않았습니다.' });
  if (!pair.includes(winner) || !T3_TEAMS.includes(winner)) {
    return res.status(400).json({ error: '승리 팀은 이 경기에 나선 두 팀 중 하나여야 합니다.' });
  }

  const ins = await q(
    `INSERT INTO tournament_matches (edition, stage, team_a, team_b, winner, score, ts, recorded_by)
     VALUES (3,$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [stage, pair[0], pair[1], winner, score, Date.now(), me]
  );
  await audit(me, 'record_tournament_match', { edition: 3, stage, teamA: pair[0], teamB: pair[1], winner, score });
  res.status(200).json({ ok: true, match: rowToMatch(ins[0]) });
}

async function remove(req, res) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const { id } = body(req);
  if (!Number.isInteger(Number(id))) {
    return res.status(400).json({ error: '삭제할 기록을 찾을 수 없습니다.' });
  }
  // 3회차는 앞 판 결과로 뒤 판의 팀이 정해진다. 뒤 판이 남은 채 앞 판만 지우면
  // 뒤 판이 대진에 없는 짝이 되므로, 뒤 판부터 지우게 한다.
  const target = await q(`SELECT * FROM tournament_matches WHERE id = $1`, [Number(id)]);
  if (target.length && Number(target[0].edition) === 3) {
    const next = T3_NEXT[target[0].stage] || [];
    if (next.length) {
      const after = await q(
        `SELECT 1 FROM tournament_matches WHERE edition = 3 AND stage = ANY($1::text[])`, [next]);
      if (after.length) {
        return res.status(400).json({ error: '이 경기 결과로 정해진 다음 경기가 있습니다. 다음 경기 기록부터 삭제하세요.' });
      }
    }
  }

  const rows = await q(`DELETE FROM tournament_matches WHERE id = $1 RETURNING *`, [Number(id)]);
  if (!rows.length) return res.status(404).json({ error: '이미 삭제된 기록입니다.' });

  await audit(me, 'delete_tournament_match', rowToMatch(rows[0]));
  res.status(200).json({ ok: true });
}
