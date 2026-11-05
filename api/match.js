import { randomInt } from 'node:crypto';
import {
  q, tx, body, methodGuard, requireUser, requireAdmin, currentAdmin, audit,
  winGain, lossGain, cleanReason, ensureMatchVoid, noScoreFor,
  ensureHostDraws, rowToDraw, TEAM_NAMES, replay, nightStart,
} from './_lib.js';
import { ensureSeason, ensureRescore } from './_season.js';

/**
 * GET  /api/match?host=1&page=N        호스트 뽑기 기록 (누구나 볼 수 있다)
 * POST /api/match                      경기 기록 (로그인한 회원 누구나)
 * POST /api/match {action:'void'}      기록 취소  (관리자 이상)
 * POST /api/match {action:'restore'}   취소 되돌리기 (관리자 이상)
 * POST /api/match {action:'host'}      팀 나누기 + 팀별 호스트 뽑기
 * POST /api/match {action:'hostResult'} 그 판의 승패 등록
 * POST /api/match {action:'hostManual'}  그 판은 리폿에서 손으로 썼다고 표시
 * POST /api/match {action:'hostClear'}  뽑기 기록 비우기 (관리자 이상)
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
  if (b.action === 'hostManual') return hostManual(req, res, b);
  if (b.action === 'hostClear') return hostClear(req, res, b);
  return record(req, res, b);
}

/* ---------- 기록 ---------- */

/** 한 팀의 최소 인원. 1:1 은 래더 경기로 치지 않는다. */
const MIN_SIDE = 2;

async function record(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const { winners = [], losers = [] } = b;
  if (!Array.isArray(winners) || !Array.isArray(losers)) {
    return res.status(400).json({ error: '승리 팀과 패배 팀을 선택해주세요.' });
  }
  // 1:1 은 경기로 치지 않는다. 2:2 부터 기록한다.
  if (winners.length < MIN_SIDE || losers.length < MIN_SIDE) {
    return res.status(400).json({
      error: `${MIN_SIDE}:${MIN_SIDE} 경기부터 기록할 수 있습니다 · 각 팀에 ${MIN_SIDE}명 이상 골라주세요.`,
    });
  }
  const dup = winners.filter(w => losers.includes(w));
  if (dup.length) {
    return res.status(400).json({ error: '같은 선수를 양쪽에 동시에 넣을 수 없습니다: ' + dup.join(', ') });
  }
  // 늦은 참석자 칸은 없앴다. 새로 들어오는 기록에는 담지 않는다 —
  // 새로고침하지 않은 화면이 아직 보내올 수 있어 조용히 흘린다.

  try {
    // 늦은 참석자 칸이 아직 없는 데이터베이스일 수 있다
    await ensureMatchVoid();
    // 점수 규칙이 바뀐 채로 배포됐으면 먼저 그 달을 다시 센다.
    // 트랜잭션 **바깥**이라야 한다 — 안에서 부르면 같은 잠금을 두고 서로 기다린다.
    await ensureRescore();
    const result = await tx((c) => recordCore(c, me, winners, losers));

    await audit(me, 'record_match', { winners, losers });
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
async function recordCore(c, me, winners, losers) {
  // 달이 바뀐 뒤 첫 기록이면 여기서 시즌을 넘긴다. 새 경기는 새 시즌에 들어간다.
  const season = await ensureSeason(c);
  const all = [...winners, ...losers];
  const { rows } = await c.query(
    `SELECT * FROM players WHERE handle = ANY($1) FOR UPDATE`, [all]
  );
  const found = new Set(rows.map(r => r.handle));
  const missing = all.filter(h => !found.has(h));
  if (missing.length) throw new Error('명단에 없는 선수입니다: ' + missing.join(', '));

  const now = new Date();
  const ts = now.getTime();

  // 11월부터는 그날 0시~18시에 출석 체크를 한 사람만 점수를 받는다.
  // 경기는 그대로 기록된다 — 빠지는 것은 점수뿐이다.
  const noScore = await noScoreFor(c, all, ts);
  const skipped = new Set(noScore);
  const winnerResults = [];

  for (const h of winners) {
    const p = rows.find(r => r.handle === h);
    const streak = p.last_result === 'W' ? p.streak + 1 : 1;
    const gained = skipped.has(h) ? 0 : winGain(streak, ts);
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
      [skipped.has(h) ? 0 : lossGain(ts), streak, now, h]
    );
  }

  const ins = await c.query(
    `INSERT INTO matches (winners, losers, late, noscore, ts, recorded_by, season)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [JSON.stringify(winnerResults), JSON.stringify(losers), JSON.stringify([]),
     JSON.stringify(noScore), ts, me, season.current ? season.current.id : null]
  );

  return { winnerResults, noScore, ts, matchId: Number(ins.rows[0].id), season };
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

function winnerHandles(row) {
  const w = Array.isArray(row.winners) ? row.winners : [];
  return w.map(x => (typeof x === 'string' ? x : x.handle));
}

/* ---------- 호스트 뽑기 ---------- */

/**
 * 모인 사람 수. 팀 수로 나누는 것이 아니라 머릿수로 받는다.
 *
 * 스물둘·스물여섯처럼 네 팀으로 딱 떨어지지 않는 수가 있어서다. 그때는
 * 경기 안에서만 인원을 맞춘다 — 22명이면 1경기 6:6, 2경기 5:5.
 * 한 경기 안의 두 팀은 언제나 같은 인원이다.
 */
const HOST_TOTAL_MIN = { 2: 4, 4: 8 };
const HOST_TOTAL_MAX = 26;

/**
 * 팀마다 몇 명씩 들어갈지. 앞에서부터 둘씩 한 경기가 된다.
 *   2팀 16명 → [8, 8]
 *   4팀 24명 → [6, 6, 6, 6]
 *   4팀 22명 → [6, 6, 5, 5]   (1경기 6:6 · 2경기 5:5)
 */
function groupSizes(total, teams) {
  if (teams === 2) return [total / 2, total / 2];
  const half = total / 2;              // 경기마다 한 팀씩 몫을 나눠 갖는다
  const big = Math.ceil(half / 2);
  return [big, big, half - big, half - big];
}
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
 * 몇 가지 조합을 만들어 보고 고를지. 여덟 명이면 서로 다른 조합이 35가지뿐이라
 * 이 정도면 거의 다 나온다.
 */
const SPLIT_TRIES = 300;
/**
 * 한 팀 평균 점수의 이만큼까지는 '고르게 나뉘었다'고 친다.
 *
 * 처음에는 15% 였다. 그런데 점수가 많이 벌어진 명단에서는 이 창이 너무 좁아,
 * 창 안에 드는 조합 자체가 **한쪽으로 치우쳐 있었다** — 꼴찌와 1등은 점수를
 * 맞추려면 거의 늘 한 편이어야 해서, 그 둘이 같은 편인 비율이 63%였다.
 * 아래 '신선도'를 아무리 세게 걸어도 창 밖은 고를 수 없으니 소용이 없었다.
 *
 * 그래서 창을 30%로 넓혔다. 여덟 명(160·140·125·110·95·80·60·45점,
 * 한 팀 평균 408점)으로 300판씩 돌려 잰 값이다:
 *
 *             가장 붙어다닌 짝   쏠림    조합    두 팀 점수 차(평균/최대)
 *   15%            63%         22%p    18가지     38점 / 65점
 *   25%            51%         18%p    23가지     62점 / 105점
 *   30%            54%        4.8%p    26가지     70점 / 125점   ← 여기
 *   40%            44%        0.9%p    14가지    101점 / 155점
 *
 * 40% 면 짝은 완벽하게 고루 섞이지만 두 팀 점수 차가 한 팀 몫의 1/4까지
 * 벌어진다 — 경기가 기운다. 30% 는 "맨날 쟤랑 같은 편"이라는 말이 나오지
 * 않을 만큼(63% → 54%, 쏠림 22%p → 5%p) 섞으면서 점수 차는 한 팀의
 * 17%에 묶어둔 자리다. 점수가 비슷한 명단에서는 두 팀 차가 13%까지 줄고
 * 짝은 41~44%로 거의 완전히 고르다.
 */
const SPLIT_SLACK = 0.30;
/**
 * '충분히 고른' 조합들 가운데, 가장 신선한 것보다 이만큼까지는 같이 친다.
 *
 * 0 에 가까우면 늘 가장 신선한 하나만 남아 조합이 **고리처럼 돌기** 시작한다
 * (0.1 로 두었더니 점수가 비슷한 명단에서 조합이 7가지로 줄어, 짝은 고루
 * 섞이는데 같은 진용이 일곱 판마다 돌아왔다). 1 이면 신선도를 안 보는 것과 같다.
 *
 * 같은 명단 300판 기준:
 *   0.1 → 조합  7가지, 짝 43%로 완전히 고름
 *   0.2 → 조합 34가지, 짝 41~44%     ← 여기
 *   0.5 → 조합 34가지, 짝 39~46%
 */
const REPEAT_SLACK = 0.2;

/**
 * 이 밤에 호스트로 뽑힌 횟수. 아이디(소문자)마다 몇 번인지 센다.
 * '이 밤'은 18시에 시작해 다음 날 18시에 끝난다(`nightStart` · _lib.js).
 *
 * 하룻밤에 두 번 맡는 일이 없게 하려고 본다. 사람이 적어 어쩔 수 없는 날에는
 * 두 번째도 맡아야 하므로 '못 한다'가 아니라 '뒤로 민다'로 쓴다.
 * 1순위만 센다 — 1순위가 못 잡아 2순위가 맡은 날까지는 알 길이 없다.
 */
async function hostCountToday(c) {
  const { rows } = await c.query(
    `SELECT teams, host_a, host_b FROM host_draws WHERE ts >= $1`, [nightStart()]
  );
  const n = new Map();
  const add = (h) => {
    if (!h) return;
    const k = String(h).toLowerCase();
    n.set(k, (n.get(k) || 0) + 1);
  };
  for (const r of rows) {
    // teams 가 생기기 전 기록은 host_a·host_b 에만 있다
    if (r.teams && r.teams.length) for (const t of r.teams) add((t.order || [])[0]);
    else { add(r.host_a); add(r.host_b); }
  }
  return n;
}

/**
 * 최근 몇 판을 돌아볼지. 열 판이면 하룻밤 치가 넉넉히 들어온다.
 */
const PAIR_WINDOW = 10;

/**
 * 최근에 같은 편이었던 짝을 센다. `a|b`(소문자, 가나다순) → 무게.
 *
 * 가까운 판일수록 무겁게 센다(가장 최근 판이 10, 열 판 전이 1). 어제 같은 편이었던
 * 것보다 **바로 앞 판에 같은 편이었던 것**이 훨씬 거슬리기 때문이다.
 */
async function recentTeammates(c) {
  const { rows } = await c.query(
    `SELECT teams, team_a, team_b FROM host_draws ORDER BY ts DESC LIMIT $1`, [PAIR_WINDOW]
  );
  const seen = new Map();
  rows.forEach((r, i) => {
    const weight = PAIR_WINDOW - i;
    // teams 가 생기기 전 기록은 team_a·team_b 에만 있다
    const parts = (r.teams && r.teams.length)
      ? r.teams.map(t => t.order || [])
      : [r.team_a || [], r.team_b || []];
    for (const part of parts) {
      for (let x = 0; x < part.length; x++) {
        for (let y = x + 1; y < part.length; y++) {
          const k = pairKey(part[x], part[y]);
          seen.set(k, (seen.get(k) || 0) + weight);
        }
      }
    }
  });
  return seen;
}

/** 짝 이름표. 순서를 타지 않게 가나다순으로 세운다. */
function pairKey(a, b) {
  const x = String(a).toLowerCase(), y = String(b).toLowerCase();
  return x < y ? x + '|' + y : y + '|' + x;
}

/**
 * 팀 안의 차례를 정한다. 이 차례가 곧 호스트 순번이다.
 *
 * 먼저 섞은 뒤 이 밤에 호스트를 맡은 횟수가 적은 사람부터 앞에 세운다.
 * 같은 횟수끼리는 섞인 차례 그대로다(정렬이 안정적이라 그렇다) — 그래서
 * 아직 안 맡은 사람들 사이에서는 여전히 제비뽑기다.
 */
function hostOrder(handles, today) {
  const n = (h) => today.get(String(h).toLowerCase()) || 0;
  return shuffle([...handles]).sort((a, b) => n(a) - n(b));
}

/**
 * 팀을 나눈다 — 이번 달 포인트로 균형을 맞추되, 매번 같은 짝이 되지 않게.
 *
 * 처음에는 차이가 가장 적은 조합을 끝까지 찾아 들어갔다. 그랬더니 점수가
 * 저마다 다른 날에는 답이 하나로 정해져, 같은 사람들로 돌리면 **늘 같은 팀**이
 * 나왔다(실제 순위 여덟 명으로 200번 돌려 조합이 한 가지였다).
 *
 * 그래서 가장 고른 하나를 찾지 않는다. 여러 조합을 만들어 본 뒤
 * '충분히 고른' 것들을 모아 그중에서 제비를 뽑는다. 몇 점 차이는 어차피
 * 경기에서 느껴지지 않고, 매번 다른 사람과 한 편이 되는 쪽이 낫다.
 *
 * 그런데 제비뽑기만으로는 모자랐다. 창 안에 든 조합이 스무 가지라도 어떤 짝은
 * 그중 열몇 가지에 들어 있다 — 점수가 그렇게 생겨 먹어서다. 그러면 아무리
 * 고르게 뽑아도 그 둘은 두 판에 한 판보다 자주 한 편이 되고, 당하는 사람
 * 눈에는 "맨날 쟤랑 같은 편"으로 보인다.
 *
 * 그래서 최근 열 판의 짝을 보고, **요즘 자주 같은 편이던 짝이 적게 든 조합**
 * 쪽으로 제비를 몰아준다(`seen`). 여전히 제비뽑기지만, 방금 한 편이었던
 * 사람과 또 묶이는 조합은 뒤로 빠진다.
 */
function splitTeams(rows, sizes, seen = new Map()) {
  const total = rows.reduce((n, p) => n + p.point, 0);
  // 점수가 전부 0인 달(새 시즌 첫날)에도 멈추지 않도록 바닥을 둔다
  const slack = Math.max(2, Math.round((total / sizes.length) * SPLIT_SLACK));

  const tries = [];
  for (let t = 0; t < SPLIT_TRIES; t++) {
    const mix = shuffle([...rows]);
    const parts = [];
    let at = 0;
    for (const n of sizes) { parts.push(mix.slice(at, at + n)); at += n; }

    // 맞붙는 두 팀끼리만 견준다. 6명 팀과 5명 팀의 합을 맞대는 것은 뜻이 없고,
    // 어차피 한 경기 안의 두 팀은 인원이 같다.
    const sum = (part) => part.reduce((n, p) => n + p.point, 0);
    let spread = 0;
    for (let i = 0; i < parts.length; i += 2) {
      spread = Math.max(spread, Math.abs(sum(parts[i]) - sum(parts[i + 1])));
    }

    // 이 조합이 품고 있는 '요즘 자주 보던 짝'의 무게. 낮을수록 새 얼굴이다.
    let repeat = 0;
    for (const part of parts) {
      for (let x = 0; x < part.length; x++) {
        for (let y = x + 1; y < part.length; y++) {
          repeat += seen.get(pairKey(part[x].handle, part[y].handle)) || 0;
        }
      }
    }
    tries.push({ parts, spread, repeat });
  }

  const best = Math.min(...tries.map(t => t.spread));
  const fair = tries.filter(t => t.spread <= best + slack);

  // 고른 것들 중에서 다시 신선한 쪽만 남긴다. 한계를 절대값이 아니라 이번에
  // 나온 폭(span)의 비율로 잡는 까닭은, 무게가 사람 수·판 수에 따라 몇 배씩
  // 달라지기 때문이다. 기록이 없어 다 똑같으면(span 0) 전부 남아 그냥 제비뽑기다.
  const reps = fair.map(t => t.repeat);
  const low = Math.min(...reps);
  const span = Math.max(...reps) - low;
  const limit = low + Math.max(1, Math.round(span * REPEAT_SLACK));
  const fresh = fair.filter(t => t.repeat <= limit);
  const pick = fresh[randomInt(fresh.length)];

  // 이름표도 섞어 붙인다. A 가 늘 센 팀이면 이름이 뜻을 가져버린다.
  // 다만 짝은 흐트러뜨리지 않는다 — 6명 팀이 5명 팀과 붙으면 안 된다.
  const pairs = [];
  for (let i = 0; i < pick.parts.length; i += 2) {
    pairs.push(shuffle([pick.parts[i], pick.parts[i + 1]]));
  }
  return shuffle(pairs).flat().map(part => part.map(p => p.handle));
}

/**
 * POST {action:'host', entries, teams}
 *
 * 팀을 나누고 팀마다 호스트 순번을 매긴다. 대진과 선호스트도 여기서 정한다.
 * teams 가 2 면 A·B 한 경기, 4 면 A·B / C·D 두 경기를 동시에 한다.
 * 인원은 entries 의 머릿수로 받는다 — 22명처럼 네 팀으로 딱 떨어지지 않아도
 * 경기 안에서만 맞추면 되기 때문이다(1경기 6:6 · 2경기 5:5).
 *
 * 팀도 순번도 서버가 고른다. 화면에서 짜 올리게 두면 돌리는 사람이 원하는
 * 대로 만들 수 있고, 그러면 기록을 남기는 뜻이 없어진다.
 */
async function hostDraw(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const teams = b.teams == null ? 2 : Number(b.teams);
  if (teams !== 2 && teams !== 4) {
    return res.status(400).json({ error: '두 팀 또는 네 팀으로만 나눌 수 있습니다.' });
  }
  const entries = Array.isArray(b.entries) ? b.entries.map(String) : null;
  if (!entries) return res.status(400).json({ error: '참가자 목록이 올바르지 않습니다.' });
  if (new Set(entries).size !== entries.length) {
    return res.status(400).json({ error: '같은 사람이 두 번 들어 있습니다.' });
  }

  const total = entries.length;
  const min = HOST_TOTAL_MIN[teams];
  if (total < min || total > HOST_TOTAL_MAX) {
    return res.status(400).json({
      error: `${teams}팀으로 나눌 때는 ${min}명부터 ${HOST_TOTAL_MAX}명까지 고를 수 있습니다 · 지금 ${total}명입니다.`,
    });
  }
  // 한 경기 안의 두 팀은 인원이 같아야 하므로 짝수여야 한다
  if (total % 2) {
    return res.status(400).json({ error: `짝수로 골라주세요 · 지금 ${total}명입니다.` });
  }
  const sizes = groupSizes(total, teams);
  if (sizes.some(n => n < 2)) {
    return res.status(400).json({ error: '한 팀에 두 명은 있어야 합니다.' });
  }
  // 표에 남기는 대표 인원. 경기마다 다를 수 있어 가장 큰 쪽을 적는다.
  const size = sizes[0];

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

      // 팀 안의 차례가 곧 호스트 순번이다 — 1순위가 호스트를 못 잡으면 2순위,
      // 그래도 안 되면 3순위가 맡는다. 이 밤에 이미 맡은 사람은 뒤로 민다.
      // 최근에 같은 편이었던 짝은 덜 묶이게 한다
      const seen = await recentTeammates(c);
      const parts = splitTeams(rows, sizes, seen);
      const names = TEAM_NAMES.slice(0, teams);
      const today = await hostCountToday(c);
      const teamRows = parts.map((handles, i) => ({ name: names[i], order: hostOrder(handles, today) }));

      // 앞에서부터 둘씩 붙여 대진을 만든다. 이름표를 이미 섞었으므로 어느 팀이
      // 어느 팀과 붙을지도 여기서 갈린다.
      const pairs = [];
      for (let i = 0; i < teams; i += 2) {
        pairs.push({
          a: names[i], b: names[i + 1],
          first: randomInt(2) ? names[i] : names[i + 1],
          result: null, matchId: null, by: null, at: null,
        });
      }

      const ts = Date.now();
      const ins = await c.query(
        `INSERT INTO host_draws
           (ts, size, team_a, team_b, host_a, host_b, first_team, drawn_by, season, teams, pairs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ts, size,
         // 옛 칸은 비워둘 수 없다. 앞의 두 팀을 그대로 적어 둔다.
         JSON.stringify(teamRows[0].order), JSON.stringify(teamRows[1].order),
         teamRows[0].order[0], teamRows[1].order[0], pairs[0].first,
         me, season.current ? season.current.id : null,
         JSON.stringify(teamRows), JSON.stringify(pairs)]
      );
      return rowToDraw(ins.rows[0]);
    });

    await audit(me, 'host_draw', { id: out.id, size, teams, total, sizes, pairs: out.pairs,
      order: out.teams.map(t => `${t.name}:${t.order.join('>')}`) });
    res.status(200).json({ ok: true, draw: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * POST {action:'hostResult', id, pair, winner}
 *
 * 나눠준 팀 그대로 승패를 매긴다. 점수 계산은 리폿과 같은 길을 쓴다.
 * 네 팀이면 경기가 둘이므로 pair 로 어느 경기인지 가린다.
 */
async function hostResult(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 판인지 알 수 없습니다.' });
  }
  const winner = String(b.winner || '').toUpperCase();
  const at = b.pair == null ? 0 : Number(b.pair);

  try {
    await ensureHostDraws();
    await ensureMatchVoid();
    await ensureRescore();
    const out = await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM host_draws WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows.length) throw new Error('없는 판입니다.');
      const d = rowToDraw(rows[0]);

      const pair = d.pairs[at];
      if (!pair) throw new Error('없는 경기입니다.');
      if (pair.result) throw new Error('이미 결과를 올린 경기입니다.');
      // 리폿에서 손으로 쓴 판이다. 여기서 또 올리면 점수가 두 번 들어간다.
      if (pair.manual) {
        throw new Error('수기작성으로 표시된 경기입니다. 표시를 지운 뒤 올려주세요.');
      }
      if (winner !== pair.a && winner !== pair.b) {
        throw new Error('이긴 팀을 골라주세요.');
      }

      const order = (name) => (d.teams.find(t => t.name === name) || { order: [] }).order;
      const winners = order(winner);
      const losers = order(winner === pair.a ? pair.b : pair.a);
      const r = await recordCore(c, me, winners, losers);

      const next = d.pairs.map((p, i) => i !== at ? p
        : { ...p, result: winner, matchId: r.matchId, by: me, at: r.ts });
      await c.query(`UPDATE host_draws SET pairs = $1 WHERE id = $2`, [JSON.stringify(next), id]);
      // 두 팀짜리는 옛 칸도 맞춰 둔다 — 그 칸만 보는 자리가 아직 있을 수 있다
      if (d.teams.length === 2) {
        await c.query(
          `UPDATE host_draws SET result = $1, match_id = $2, result_by = $3, result_ts = $4
            WHERE id = $5`,
          [winner, r.matchId, me, r.ts, id]
        );
      }
      return { ...r, winners, losers, pairs: next };
    });

    await audit(me, 'host_result', { id, pair: at, winner, winners: out.winners, losers: out.losers });
    res.status(200).json({ ok: true, winnerResults: out.winnerResults, noScore: out.noScore || [],
      ts: out.ts, pairs: out.pairs });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/** 수기작성 사유 최대 길이 */
const MAX_MANUAL = 100;

/**
 * POST {action:'hostManual', id, pair, reason}            수기작성으로 표시
 * POST {action:'hostManual', id, pair, clear:true}        그 표시를 지움
 *
 * 중간에 사람이 바뀌면 나눠준 팀과 실제로 뛴 팀이 달라서, 리폿 탭에서 손으로
 * 쓴다. 그런데 뽑기 기록에는 '결과 미등록' 으로 남아 있으니 아무도 안 쓴 줄
 * 알고 여기서 또 올려 **점수가 두 번 들어가는 일**이 잦았다. 그래서 '여기선
 * 올리지 마라' 는 표시를 남긴다.
 *
 * **점수는 건드리지 않는다.** 경기도 만들지 않는다. 표시일 뿐이다.
 * 잘못 눌렀으면 적은 사람이나 관리자가 지울 수 있다 — 점수가 걸려 있지 않으니
 * 되돌리는 데 관리자를 기다릴 까닭이 없다.
 */
async function hostManual(req, res, b) {
  const me = await requireUser(req, res);
  if (!me) return;

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '어떤 판인지 알 수 없습니다.' });
  }
  const at = b.pair == null ? 0 : Number(b.pair);
  const clear = b.clear === true;

  let reason = '';
  if (!clear) {
    reason = String(b.reason == null ? '' : b.reason).trim().replace(/\s+/g, ' ');
    if (!reason) return res.status(400).json({ error: '수기작성 사유를 적어주세요.' });
    if (reason.length > MAX_MANUAL) {
      return res.status(400).json({ error: `사유는 ${MAX_MANUAL}자까지 쓸 수 있습니다.` });
    }
  }

  try {
    await ensureHostDraws();
    const admin = await currentAdmin(req);
    const out = await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM host_draws WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows.length) throw new Error('없는 판입니다.');
      const d = rowToDraw(rows[0]);

      const pair = d.pairs[at];
      if (!pair) throw new Error('없는 경기입니다.');
      if (pair.result) throw new Error('이미 결과를 올린 경기입니다.');

      if (clear) {
        if (!pair.manual) throw new Error('수기작성으로 표시된 경기가 아닙니다.');
        if (pair.manual.by !== me && !admin) {
          throw new Error('적은 사람이나 관리자만 지울 수 있습니다.');
        }
      } else if (pair.manual) {
        throw new Error('이미 수기작성으로 표시된 경기입니다.');
      }

      const mark = clear ? null : { reason, by: me, at: Date.now() };
      const next = d.pairs.map((p, i) => {
        if (i !== at) return p;
        const { manual, ...rest } = p;
        return mark ? { ...rest, manual: mark } : rest;
      });
      await c.query(`UPDATE host_draws SET pairs = $1 WHERE id = $2`, [JSON.stringify(next), id]);
      return { pairs: next, manual: mark };
    });

    await audit(me, clear ? 'host_manual_clear' : 'host_manual', { id, pair: at, reason });
    res.status(200).json({ ok: true, pairs: out.pairs, manual: out.manual });
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

/**
 * POST {action:'hostClear'} — 뽑기 기록을 통째로 비운다.
 *
 * 시험 삼아 돌려본 것들을 치우려고 둔 길이다. 되돌릴 수 없다.
 *
 * 경기 기록(matches)과 점수는 건드리지 않는다. 결과까지 올린 판이 있으면
 * 그 경기는 리폿에 그대로 남아 있다 — 점수를 되돌리려면 리폿에서 따로
 * 취소해야 한다. 여기서 같이 지우면 지운 줄 모르고 순위가 틀어진다.
 */
async function hostClear(req, res, b) {
  const me = await requireAdmin(req, res);
  if (!me) return;

  try {
    await ensureHostDraws();
    const before = await q(`SELECT count(*)::int AS n FROM host_draws`);
    const n = before[0].n;

    // 결과까지 올린 판이 섞여 있으면 한 번 더 확인받는다. 화면에서 보여준
    // 숫자와 지금 숫자가 다르면(그 사이 누가 돌렸으면) 멈춘다.
    const expect = b.expect == null ? null : Number(b.expect);
    if (expect != null && expect !== n) {
      return res.status(409).json({
        error: `그 사이 기록이 바뀌었습니다 (${expect}건 → ${n}건) · 새로고침한 뒤 다시 눌러주세요.`,
      });
    }

    // 네 팀짜리는 결과가 pairs 안에 들어 있다. 옛 칸만 보면 세지 못한다.
    const withResult = await q(
      `SELECT count(*)::int AS n FROM host_draws
        WHERE result IS NOT NULL
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pairs, '[]'::jsonb)) e
                       WHERE e->>'result' IS NOT NULL)`
    );
    await q(`DELETE FROM host_draws`);
    await audit(me, 'host_clear', { removed: n, withResult: withResult[0].n });
    res.status(200).json({ ok: true, removed: n, withResult: withResult[0].n });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
