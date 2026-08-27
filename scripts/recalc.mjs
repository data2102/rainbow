/**
 * 기록된 경기를 처음부터 다시 훑어 선수 전적을 현재 규칙으로 맞춥니다.
 *
 *   node scripts/recalc.mjs          미리보기만 (DB 를 바꾸지 않음)
 *   node scripts/recalc.mjs apply    실제로 반영
 *
 * 맞추는 값: 점수 · 승 · 패 · 연승 · 최근 결과 · 최근 경기일시
 * 모두 경기 기록(matches)에서 나오는 값이라, 어긋나 있으면 화면의 승률과
 * 연승 표시가 실제 기록과 달라집니다.
 *
 * 승리 점수는 경기에 기록된 값(gained)을 그대로 씁니다. 당시 연승 보너스가
 * 반영된 값이라 다시 계산하면 과거 기록 자체가 달라집니다.
 * 패배 점수만 현재 규칙(api/_lib.js 의 lossGain)으로 다시 매깁니다.
 */
import { q, getPool, tx, audit, lossGain } from '../api/_lib.js';

const apply = process.argv[2] === 'apply';

const [players, matches] = await Promise.all([
  q(`SELECT handle, point, wins, losses, streak, last_result FROM players ORDER BY handle`),
  q(`SELECT winners, losers, ts FROM matches ORDER BY ts ASC`),
]);

if (!players.length) {
  console.log('\n등록된 선수가 없습니다.\n');
  await getPool().end();
  process.exit(0);
}

const calc = new Map(players.map(p => [p.handle, {
  point: 0, wins: 0, losses: 0, streak: 0, lastResult: null, lastMatch: null,
}]));
let skipped = 0;

for (const m of matches) {
  const ts = Number(m.ts);
  for (const w of (m.winners || [])) {
    const r = calc.get(w.handle);
    if (!r) { skipped++; continue; }
    r.point += (w.gained !== undefined && w.gained !== null) ? w.gained : 3;
    r.wins++;
    r.streak = r.lastResult === 'W' ? r.streak + 1 : 1;
    r.lastResult = 'W';
    r.lastMatch = ts;
  }
  for (const h of (m.losers || [])) {
    const r = calc.get(h);
    if (!r) { skipped++; continue; }
    r.point += lossGain();
    r.losses++;
    r.streak = r.lastResult === 'L' ? r.streak - 1 : -1;
    r.lastResult = 'L';
    r.lastMatch = ts;
  }
}

const rows = players.map(p => {
  const c = calc.get(p.handle);
  return {
    handle: p.handle,
    before: { point: p.point, wins: p.wins, losses: p.losses, streak: p.streak, lastResult: p.last_result || null },
    after: c,
    pointDiff: c.point - p.point,
    recordChanged: p.wins !== c.wins || p.losses !== c.losses
      || p.streak !== c.streak || (p.last_result || null) !== c.lastResult,
  };
});

const rankOf = (key) => {
  const sorted = [...rows].sort((a, b) => b[key].point - a[key].point || a.handle.localeCompare(b.handle));
  return h => sorted.findIndex(x => x.handle === h) + 1;
};
const rankBefore = rankOf('before');
const rankAfter = rankOf('after');

const w = Math.max(...rows.map(r => r.handle.length));
console.log(`\n경기 ${matches.length}건을 다시 계산했습니다. (패배 ${lossGain() >= 0 ? '+' : ''}${lossGain()}점 기준)\n`);
console.log(`  ${'선수'.padEnd(w)}   현재 →   재계산   변화    순위`);
console.log('  ' + '-'.repeat(w + 36));

for (const r of [...rows].sort((a, b) => b.after.point - a.after.point || a.handle.localeCompare(b.handle))) {
  const rb = rankBefore(r.handle), ra = rankAfter(r.handle);
  const move = rb === ra ? '  -' : (ra < rb ? `▲${rb - ra}` : `▼${ra - rb}`);
  const d = r.pointDiff === 0 ? '   ·' : (r.pointDiff > 0 ? `+${r.pointDiff}` : `${r.pointDiff}`);
  console.log(`  ${r.handle.padEnd(w)}  ${String(r.before.point).padStart(5)} → ${String(r.after.point).padStart(6)}  ${d.padStart(5)}   ${String(rb).padStart(2)} → ${String(ra).padStart(2)} ${move}`);
}

const pointChanged = rows.filter(r => r.pointDiff !== 0).length;
const moved = rows.filter(r => rankBefore(r.handle) !== rankAfter(r.handle)).length;
console.log(`\n  점수가 바뀌는 선수 ${pointChanged}명 · 순위가 바뀌는 선수 ${moved}명 / ${rows.length}명`);
if (skipped) console.log(`  ⚠ 명단에 없는 선수가 등장하는 기록 ${skipped}건은 건너뛰었습니다. (삭제된 회원)`);

const recordDiff = rows.filter(r => r.recordChanged);
if (recordDiff.length) {
  console.log(`\n  승/패·연승이 경기 기록과 어긋난 선수 ${recordDiff.length}명 — 함께 맞춥니다`);
  for (const r of recordDiff) {
    const b = r.before, a = r.after;
    console.log(`     ${r.handle}`);
    console.log(`       현재   ${b.wins}승 ${b.losses}패  연승 ${b.streak}  최근 ${b.lastResult || '-'}`);
    console.log(`       재계산 ${a.wins}승 ${a.losses}패  연승 ${a.streak}  최근 ${a.lastResult || '-'}`);
  }
} else {
  console.log('\n  승/패·연승은 경기 기록과 일치합니다.');
}

if (!apply) {
  console.log('\n※ 미리보기입니다. DB 는 바뀌지 않았습니다.');
  console.log('   실제로 반영하려면:  npm run recalc:apply');
  console.log('   되돌릴 수 없으니 ADMIN → 데이터 관리 → 내보내기로 먼저 백업하세요.\n');
  await getPool().end();
  process.exit(0);
}

const changed = rows.filter(r => r.pointDiff !== 0 || r.recordChanged);

await tx(async (c) => {
  for (const r of changed) {
    await c.query(
      `UPDATE players SET point = $1, wins = $2, losses = $3, streak = $4,
              last_result = $5, last_match = $6 WHERE handle = $7`,
      [r.after.point, r.after.wins, r.after.losses, r.after.streak,
       r.after.lastResult, r.after.lastMatch ? new Date(r.after.lastMatch) : null, r.handle]
    );
  }
});
await audit(null, 'recalc_points_cli', {
  matches: matches.length,
  lossGain: lossGain(),
  before: Object.fromEntries(changed.map(r => [r.handle, r.before])),
});

console.log(`\n✅ 반영 완료 — 선수 ${changed.length}명의 전적을 갱신했습니다.`);
console.log('   변경 전 값은 audit_log 에 recalc_points_cli 로 남겨두었습니다.\n');
await getPool().end();
