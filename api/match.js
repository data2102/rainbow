import { randomInt } from 'node:crypto';
import {
  q, tx, body, methodGuard, requireUser, requireAdmin, audit,
  winGain, lossGain, lateGain, cleanReason, ensureMatchVoid,
  ensureHostDraws, rowToDraw,
} from './_lib.js';
import { ensureSeason } from './_season.js';

/**
 * GET  /api/match?host=1&page=N        호스트 뽑기 기록 (누구나 볼 수 있다)
 * POST /api/match                      경기 기록 (로그인한 회원 누구나)
 * POST /api/match {action:'void'}      기록 취소  (관리자 이상)
 * POST /api/match {action:'restore'}   취소 되돌리기 (관리자 이상)
 * POST /api/match {action:'host'}      팀 나누기 + 팀별 호스트 뽑기
 * POST /api/match {action:'hostResult'} 그 판의 승패 등록
 *
 * 호스트 뽑기가 여기 얹혀 있는 까닭: Vercel Hobby 는 서버리스 함수가 12개까지다.
 * 지금 11개라 새 파일을 만들 수 없다. 경기와 한 몸인 기능이라 여기에 둔다.
 */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return hostLog(req, res);
  const b = body(req);
  if (b.action === 'void') return voidMatch(req, res, b);
  if (b.action === 'restore') return restoreMatch(req, res, b);
  if (b.action === 'host') return hostDraw(req, res, b);
  if (b.action === 'hostResult') return hostResult(req, res, b);
  return record(req, res, b);
}

/* ---------- 기록 ---------- */

/** 한 팀의 최소 인원. 1:1 은 래더 경기로 치지 않는다. */
const MIN_SIDE = 2;

async function record(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { winners = [], losers = [], late = [] } = b;
  if (!Array.isArray(winners) || !Array.isArray(losers)) {
    return res.status(400).json({ error: '승리 팀과 패배 팀을 선택해주세요.' });
  }
  // 1:1 은 경기로 치지 않는다. 2:2 부터 기록한다.
  if (winners.length < MIN_SIDE || losers.length < MIN_SIDE) {
    return res.status(400).json({
      error: `${MIN_SIDE}:${MIN_SIDE} 경기부터 기록할 수 있습니다 · 각 팀에 ${MIN_SIDE}명 이상 골라주세요.`,
    });
  }
  if (!Array.isArray(late)) {
    return res.status(400).json({ error: '늦은 참석자 목록이 올바르지 않습니다.' });
  }
  const dup = winners.filter(w => losers.includes(w));
  if (dup.length) {
    return res.status(400).json({ error: '같은 선수를 양쪽에 동시에 넣을 수 없습니다: ' + dup.join(', ') });
  }
  // 늦은 참석자는 승패 어느 쪽도 아니다. 양쪽에 겹치면 점수가 두 번 들어간다.
  const both = late.filter(h => winners.includes(h) || losers.includes(h));
  if (both.length) {
    return res.status(400).json({
      error: '늦은 참석자는 승리·패배 팀에 함께 넣을 수 없습니다: ' + both.join(', '),
    });
  }

  try {
    // 늦은 참석자 칸이 아직 없는 데이터베이스일 수 있다
    await ensureMatchVoid();
    const result = await tx((c) => recordCore(c, me, winners, losers, late));

    await audit(me, 'record_match', { winners, losers, late });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * 점수를 매기고 경기 한 줄을 남긴다. 트랜잭션 안에서 부른다.
 *
 * 리폿 화면과 호스트 뽑기 화면이 같은 길을 쓴다 — 어느 쪽으로 넣든
 * 점수가 달라지면 안 되기 때문이다.
 */
async function recordCore(c, me, winners, losers, late) {
  // 달이 바뀐 뒤 첫 기록이면 여기서 시즌을 넘긴다. 새 경기는 새 시즌에 들어간다.
  const season = await ensureSeason(c);
  const all = [...winners, ...losers, ...late];
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

  // 늦은 참석자는 전적에 넣지 않는다 — 경기 수도, 승도, 패도, 연승도
  // 건드리지 않고 점수만 얹는다. 어느 편으로 세도 사실과 달라지기 때문이다.
  for (const h of late) {
    await c.query(
      `UPDATE players SET point = point + $1 WHERE handle = $2`, [lateGain(), h]
    );
  }

  const ins = await c.query(
    `INSERT INTO matches (winners, losers, late, ts, recorded_by, season)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [JSON.stringify(winnerResults), JSON.stringify(losers), JSON.stringify(late),
     ts, me, season.current ? season.current.id : null]
  );

  return { winnerResults, ts, matchId: Number(ins.rows[0].id), season };
}

/* ---------- 취소 · 되돌리기 ---------- */

async function voidMatch(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  let reason;
  try { reason = cleanReason(b.reason); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 기록인지 알 수 없습니다.' });
  }

  try {
    const at = Date.now();
    const m = await apply(id, async (c, row) => {
      if (row.voided_at != null) throw new Error('이미 취소된 기록입니다.');
      await c.query(
        `UPDATE matches SET voided_at = $1, voided_by = $2, void_reason = $3 WHERE id = $4`,
        [at, me, reason, id]
      );
    });
    await audit(me, 'void_match', {
      id, reason, ts: m.ts, winners: winnerHandles(m), losers: m.losers || [],
      late: m.late || [], recordedBy: m.recorded_by,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

async function restoreMatch(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 기록인지 알 수 없습니다.' });
  }

  try {
    const m = await apply(id, async (c, row) => {
      if (row.voided_at == null) throw new Error('취소된 기록이 아닙니다.');
      await c.query(
        `UPDATE matches SET voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = $1`,
        [id]
      );
    });
    await audit(me, 'restore_match', {
      id, ts: m.ts, winners: winnerHandles(m), losers: m.losers || [],
      late: m.late || [],
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * 기록 하나를 손보고 성적을 다시 계산한다.
 *
 * ensureSeason 이 거는 잠금 덕분에 새 경기 기록과 겹치지 않는다.
 * 두 사람이 동시에 취소를 눌러도 순서대로 한 번씩만 처리된다.
 */
async function apply(id, change) {
  await ensureMatchVoid();
  return tx(async (c) => {
    const season = await ensureSeason(c);
    const seasonId = season.current ? season.current.id : null;

    const { rows } = await c.query(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw new Error('없는 기록입니다.');
    const row = rows[0];

    // 마감된 달의 순위는 그대로 얼려둔다. 지난 기록을 건드리면 그때의
    // 최종 순위표와 어긋나므로, 진행 중인 달의 기록만 손댈 수 있다.
    if ((row.season || null) !== seasonId) {
      throw new Error('이미 마감된 달의 기록은 취소할 수 없습니다.');
    }

    await change(c, row);
    await replay(c, seasonId);
    return row;
  });
}

/**
 * 살아있는 기록만으로 시즌 성적을 처음부터 다시 계산한다.
 *
 * 취소한 경기의 점수만 빼는 방법은 쓸 수 없다. 연승 보너스 때문에 한 경기를
 * 들어내면 그 뒤 경기들의 획득 점수까지 달라지기 때문이다. 그래서 시즌 첫
 * 경기부터 순서대로 다시 돌린다. 한 달 경기 수가 많지 않아 이 편이 정확하고
 * 단순하다. 달라진 획득 점수는 기록에도 반영한다.
 */
async function replay(c, seasonId) {
  await c.query(
    `UPDATE players SET point = 0, wins = 0, losses = 0, streak = 0,
            last_result = NULL, last_match = NULL`
  );

  const { rows } = seasonId
    ? await c.query(
        `SELECT * FROM matches WHERE season = $1 AND voided_at IS NULL ORDER BY ts ASC, id ASC`,
        [seasonId])
    : await c.query(
        `SELECT * FROM matches WHERE season IS NULL AND voided_at IS NULL ORDER BY ts ASC, id ASC`);

  const stats = new Map();
  const of = (h) => {
    if (!stats.has(h)) {
      stats.set(h, { point: 0, wins: 0, losses: 0, streak: 0, lastResult: null, lastMatch: null });
    }
    return stats.get(h);
  };

  for (const m of rows) {
    const winners = Array.isArray(m.winners) ? m.winners : [];
    const losers = Array.isArray(m.losers) ? m.losers : [];
    const ts = Number(m.ts);
    const redone = [];

    for (const w of winners) {
      const h = typeof w === 'string' ? w : w.handle;
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'W' ? s.streak + 1 : 1;
      const gained = winGain(s.streak);
      s.point += gained;
      s.wins += 1;
      s.lastResult = 'W';
      s.lastMatch = ts;
      redone.push({ handle: h, gained });
    }

    for (const h of losers) {
      if (!h) continue;
      const s = of(h);
      s.streak = s.lastResult === 'L' ? s.streak - 1 : -1;
      s.point += lossGain();
      s.losses += 1;
      s.lastResult = 'L';
      s.lastMatch = ts;
    }

    // 늦은 참석자는 점수만 받는다. 연승도, 마지막 경기일도 건드리지 않는다 —
    // 전적에 없는 경기가 연승을 끊거나 이어붙이면 사실과 어긋난다.
    for (const h of (Array.isArray(m.late) ? m.late : [])) {
      if (!h) continue;
      of(h).point += lateGain();
    }

    if (JSON.stringify(redone) !== JSON.stringify(winners)) {
      await c.query(`UPDATE matches SET winners = $1 WHERE id = $2`, [JSON.stringify(redone), m.id]);
    }
  }

  for (const [handle, s] of stats) {
    await c.query(
      `UPDATE players SET point = $1, wins = $2, losses = $3, streak = $4,
              last_result = $5, last_match = $6 WHERE handle = $7`,
      [s.point, s.wins, s.losses, s.streak, s.lastResult,
       s.lastMatch == null ? null : new Date(s.lastMatch), handle]
    );
  }
}

function winnerHandles(row) {
  const w = Array.isArray(row.winners) ? row.winners : [];
  return w.map(x => (typeof x === 'string' ? x : x.handle));
}

/* ---------- 호스트 뽑기 ---------- */

/** 한 팀 인원. 1:1 은 래더 경기가 아니고, 9:9 는 방이 안 찬다. */
const HOST_MIN = 2;
const HOST_MAX = 8;
/** 한 쪽에 보여줄 기록 수 */
const LOG_PER = 10;

/** 고른 난수로 자리를 섞는다 (Fisher–Yates) */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 팀을 나눈다 — 이번 달 포인트로 균형을 맞춘다.
 *
 * 점수 높은 순으로 줄을 세우고 ABBA ABBA 로 번갈아 넣는다(스네이크 드래프트).
 * 1·4등이 한 팀, 2·3등이 한 팀이 되는 식이라 양쪽 합계가 가깝게 떨어진다.
 * 같은 점수끼리는 미리 섞으므로 매번 같은 팀이 되지는 않는다.
 * 마지막에 A·B 라벨도 동전을 던져 바꾼다 — A 가 늘 센 팀이면 이름이 뜻을 가져버린다.
 */
function splitTeams(rows) {
  const byPoint = shuffle([...rows]).sort((x, y) => y.point - x.point);
  const a = [], b = [];
  byPoint.forEach((p, i) => (i % 4 === 0 || i % 4 === 3 ? a : b).push(p));

  // 드래프트만으로는 한쪽이 기울 때가 있다. 한 명씩 맞바꿔 보고 차이가
  // 줄어들면 바꾼다. 더 줄일 수 없을 때까지만 — 여덟 명이면 한눈에 끝난다.
  const sum = (t) => t.reduce((n, p) => n + p.point, 0);
  for (let round = 0; round < rows.length; round++) {
    let gap = Math.abs(sum(a) - sum(b));
    let best = null;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const d = Math.abs((sum(a) - a[i].point + b[j].point) - (sum(b) - b[j].point + a[i].point));
        if (d < gap) { gap = d; best = [i, j]; }
      }
    }
    if (!best) break;
    const [i, j] = best;
    [a[i], b[j]] = [b[j], a[i]];
  }

  const ha = a.map(p => p.handle), hb = b.map(p => p.handle);
  return randomInt(2) ? [ha, hb] : [hb, ha];
}


/**
 * POST {action:'host', size, entries}
 * 팀을 나누고 팀마다 호스트 순번을 매긴다. 선호스트도 여기서 정한다.
 * team_a·team_b 에 담긴 차례가 곧 호스트 순번이고, 맨 앞이 host_a·host_b 다.
 *
 * 팀도 호스트도 서버가 고른다. 화면에서 정해 올리게 두면 돌리는 사람이
 * 원하는 대로 짤 수 있고, 그러면 기록을 남기는 뜻이 없어진다.
 */
async function hostDraw(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const size = Number(b.size);
  if (!Number.isInteger(size) || size < HOST_MIN || size > HOST_MAX) {
    return res.status(400).json({ error: `${HOST_MIN}:${HOST_MIN} 부터 ${HOST_MAX}:${HOST_MAX} 까지 고를 수 있습니다.` });
  }
  const entries = Array.isArray(b.entries) ? b.entries.map(String) : null;
  if (!entries) return res.status(400).json({ error: '참가자 목록이 올바르지 않습니다.' });
  if (new Set(entries).size !== entries.length) {
    return res.status(400).json({ error: '같은 사람이 두 번 들어 있습니다.' });
  }
  if (entries.length !== size * 2) {
    return res.status(400).json({
      error: `${size}:${size} 경기는 ${size * 2}명을 골라야 합니다 · 지금 ${entries.length}명입니다.`,
    });
  }

  try {
    await ensureHostDraws();
    const out = await tx(async (c) => {
      const season = await ensureSeason(c);
      // 포인트는 지금 명단에서 읽는다 — 화면이 보낸 값을 믿지 않는다
      const { rows } = await c.query(
        `SELECT handle, point FROM players WHERE handle = ANY($1)`, [entries]
      );
      const found = new Set(rows.map(r => r.handle));
      const missing = entries.filter(h => !found.has(h));
      if (missing.length) throw new Error('명단에 없는 선수입니다: ' + missing.join(', '));

      // 팀 안의 차례를 섞는다. 이 순서가 곧 호스트 순번이다 —
      // 1번이 호스트를 못 잡으면 2번, 그래도 안 되면 3번이 맡는다.
      // 다시 뽑지 않아도 되도록 처음부터 끝까지 정해 둔다.
      const [splitA, splitB] = splitTeams(rows);
      const teamA = shuffle(splitA);
      const teamB = shuffle(splitB);
      const hostA = teamA[0];
      const hostB = teamB[0];
      const first = randomInt(2) ? 'A' : 'B';
      const ts = Date.now();

      const ins = await c.query(
        `INSERT INTO host_draws
           (ts, size, team_a, team_b, host_a, host_b, first_team, drawn_by, season)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ts, size, JSON.stringify(teamA), JSON.stringify(teamB),
         hostA, hostB, first, me, season.current ? season.current.id : null]
      );
      return rowToDraw(ins.rows[0]);
    });

    await audit(me, 'host_draw', { id: out.id, size, teamA: out.teamA, teamB: out.teamB,
      hostA: out.hostA, hostB: out.hostB, first: out.first });
    res.status(200).json({ ok: true, draw: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * POST {action:'hostResult', id, winner:'A'|'B'}
 * 나눠준 팀 그대로 승패를 매긴다. 점수 계산은 리폿과 같은 길을 쓴다.
 */
async function hostResult(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 판인지 알 수 없습니다.' });
  }
  const winner = String(b.winner || '').toUpperCase();
  if (winner !== 'A' && winner !== 'B') {
    return res.status(400).json({ error: '이긴 팀을 골라주세요.' });
  }

  try {
    await ensureHostDraws();
    await ensureMatchVoid();
    const out = await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM host_draws WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows.length) throw new Error('없는 판입니다.');
      const d = rowToDraw(rows[0]);
      if (d.result) throw new Error('이미 결과를 올린 판입니다.');

      const winners = winner === 'A' ? d.teamA : d.teamB;
      const losers = winner === 'A' ? d.teamB : d.teamA;
      const r = await recordCore(c, me, winners, losers, []);

      await c.query(
        `UPDATE host_draws SET result = $1, match_id = $2, result_by = $3, result_ts = $4
          WHERE id = $5`,
        [winner, r.matchId, me, r.ts, id]
      );
      return { ...r, winners, losers };
    });

    await audit(me, 'host_result', { id, winner, winners: out.winners, losers: out.losers });
    res.status(200).json({ ok: true, winnerResults: out.winnerResults, ts: out.ts });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/** GET ?host=1&page=N — 진행 기록. 로그인하지 않아도 볼 수 있다. */
async function hostLog(req, res) {
  const want = req.query && (req.query.host || req.query.draws);
  if (!want) return res.status(400).json({ error: '무엇을 찾는지 알 수 없습니다.' });

  try {
    await ensureHostDraws();
    const page = Math.max(1, Number((req.query && req.query.page) || 1) || 1);
    const [cnt, rows] = await Promise.all([
      q(`SELECT count(*)::int AS n FROM host_draws`),
      q(`SELECT * FROM host_draws ORDER BY ts DESC, id DESC LIMIT $1 OFFSET $2`,
        [LOG_PER, (page - 1) * LOG_PER]),
    ]);
    const total = cnt[0].n;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      page, per: LOG_PER, total,
      pages: Math.max(1, Math.ceil(total / LOG_PER)),
      draws: rows.map(rowToDraw),
    });
  } catch (e) {
    res.status(500).json({ error: '기록을 불러오지 못했습니다: ' + e.message });
  }
}
