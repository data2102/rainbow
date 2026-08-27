/**
 * 기록된 경기를 다시 훑어 선수 점수를 현재 규칙으로 재계산합니다.
 *
 *   node scripts/recalc.mjs          미리보기만 (DB 를 바꾸지 않음)
 *   node scripts/recalc.mjs apply    실제로 반영
 *
 * 승리 점수는 경기에 기록된 값(gained)을 그대로 씁니다. 당시 연승 보너스가
 * 반영된 값이라 다시 계산하면 과거 기록이 달라집니다.
 * 패배 점수만 현재 규칙(api/_lib.js 의 lossGain)으로 다시 매깁니다.
 *
 * 승/패 횟수와 연승은 건드리지 않습니다. 이번 변경과 무관하기 때문입니다.
 * 다만 경기 기록과 어긋나면 경고로 알려줍니다.
 */
import { q, getPool, tx, audit, lossGain } from '../api/_lib.js';

const apply = process.argv[2] === 'apply';

const [players, matches] = await Promise.all([
  q(`SELECT handle, point, wins, losses FROM players ORDER BY handle`),
  q(`SELECT winners, losers FROM matches ORDER BY ts ASC`),
]);

if (!players.length) {
  console.log('\n등록된 선수가 없습니다.\n');
  await getPool().end();
  process.exit(0);
}

const calc = new Map(players.map(p => [p.handle, { point: 0, wins: 0, losses: 0 }]));
let skipped = 0;

for (const m of matches) {
  for (const w of (m.winners || [])) {
    const row = calc.get(w.handle);
    if (!row) { skipped++; continue; }
    row.point += (w.gained !== undefined && w.gained !== null) ? w.gained : 3;
    row.wins++;
  }
  for (const h of (m.losers || [])) {
    const row = calc.get(h);
    if (!row) { skipped++; continue; }
    row.point += lossGain();
    row.losses++;
  }
}

const rows = players.map(p => {
  const c = calc.get(p.handle);
  return { handle: p.handle, before: p.point, after: c.point, diff: c.point - p.point,
           wins: p.wins, losses: p.losses, calcWins: c.wins, calcLosses: c.losses };
});

const rankOf = (list, key) => {
  const sorted = [...list].sort((a, b) => b[key] - a[key] || a.handle.localeCompare(b.handle));
  return h => sorted.findIndex(x => x.handle === h) + 1;
};
const rankBefore = rankOf(rows, 'before');
const rankAfter = rankOf(rows, 'after');

const w = Math.max(...rows.map(r => r.handle.length));
console.log(`\n경기 ${matches.length}건을 다시 계산했습니다. (패배 ${lossGain() >= 0 ? '+' : ''}${lossGain()}점 기준)\n`);
console.log(`  ${'선수'.padEnd(w)}   현재 →   재계산   변화    순위`);
console.log('  ' + '-'.repeat(w + 36));

for (const r of [...rows].sort((a, b) => b.after - a.after || a.handle.localeCompare(b.handle))) {
  const rb = rankBefore(r.handle), ra = rankAfter(r.handle);
  const move = rb === ra ? '  -' : (ra < rb ? `▲${rb - ra}` : `▼${ra - rb}`);
  const d = r.diff === 0 ? '   ·' : (r.diff > 0 ? `+${r.diff}` : `${r.diff}`);
  console.log(`  ${r.handle.padEnd(w)}  ${String(r.before).padStart(5)} → ${String(r.after).padStart(6)}  ${d.padStart(5)}   ${String(rb).padStart(2)} → ${String(ra).padStart(2)} ${move}`);
}

const moved = rows.filter(r => rankBefore(r.handle) !== rankAfter(r.handle)).length;
console.log(`\n  점수가 바뀌는 선수 ${rows.filter(r => r.diff !== 0).length}명 · 순위가 바뀌는 선수 ${moved}명 / ${rows.length}명`);
if (skipped) console.log(`  ⚠ 명단에 없는 선수가 등장하는 기록 ${skipped}건은 건너뛰었습니다. (삭제된 회원)`);

const mismatch = rows.filter(r => r.wins !== r.calcWins || r.losses !== r.calcLosses);
if (mismatch.length) {
  console.log(`\n  ⚠ 저장된 승/패와 경기 기록이 다른 선수 ${mismatch.length}명 (승/패는 이번에 손대지 않습니다)`);
  for (const r of mismatch) {
    console.log(`     ${r.handle.padEnd(w)}  저장 ${r.wins}승 ${r.losses}패  ↔  기록 ${r.calcWins}승 ${r.calcLosses}패`);
  }
}

if (!apply) {
  console.log('\n※ 미리보기입니다. DB 는 바뀌지 않았습니다.');
  console.log('   실제로 반영하려면:  npm run recalc:apply');
  console.log('   되돌릴 수 없으니 ADMIN → 데이터 관리 → 내보내기로 먼저 백업하세요.\n');
  await getPool().end();
  process.exit(0);
}

await tx(async (c) => {
  for (const r of rows) {
    if (r.diff === 0) continue;
    await c.query(`UPDATE players SET point = $1 WHERE handle = $2`, [r.after, r.handle]);
  }
});
await audit(null, 'recalc_points_cli', {
  matches: matches.length,
  lossGain: lossGain(),
  before: Object.fromEntries(rows.filter(r => r.diff !== 0).map(r => [r.handle, r.before])),
});

console.log(`\n✅ 반영 완료 — 선수 ${rows.filter(r => r.diff !== 0).length}명의 점수를 갱신했습니다.`);
console.log('   변경 전 점수는 audit_log 에 recalc_points_cli 로 남겨두었습니다.\n');
await getPool().end();
