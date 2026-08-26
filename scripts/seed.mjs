/**
 * 백업/시드 JSON을 DB에 적재합니다.
 *   node scripts/seed.mjs ./seed/ladder_seed.json
 *
 * - 구버전 1:1 경기기록은 자동으로 팀전 형식으로 변환합니다.
 * - 관리자 비밀번호가 파일에 없으면 임시 비밀번호를 발급해 화면에 출력합니다.
 *   (저장소에 올라가는 시드 파일에는 비밀번호를 넣지 않습니다.)
 * - 파일에 평문 비밀번호가 있으면 scrypt 해시로 변환해 저장합니다.
 * - 이미 존재하는 데이터는 덮어씁니다(선수/경기/요청 전체 교체).
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getPool, tx, hashPw, normalizeMatch, parseHandle } from '../api/_lib.js';

const file = process.argv[2] || './seed/ladder_seed.json';
if (!fs.existsSync(file)) {
  console.error(`파일을 찾을 수 없습니다: ${file}`);
  console.error('사용법: node scripts/seed.mjs <시드파일.json>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const players = data.players || [];
const matches = (data.matches || []).map(normalizeMatch);
const admins = data.admins || [];
const requests = data.requests || [];

/** 사람이 옮겨적을 수 있는 임시 비밀번호 */
function tempPw() {
  return 'R6-' + randomBytes(6).toString('base64url');
}

const issued = [];

await tx(async (c) => {
  await c.query('DELETE FROM matches');
  await c.query('DELETE FROM requests');
  await c.query('DELETE FROM sessions');
  await c.query('DELETE FROM players');

  for (const p of players) {
    const parsed = parseHandle(p.handle);
    await c.query(
      `INSERT INTO players (handle, clan, name, point, wins, losses, streak, last_result, last_match)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.handle, p.clan || parsed.clan, p.name || parsed.name, p.point || 0, p.wins || 0,
       p.losses || 0, p.streak || 0, p.lastResult || null, p.lastMatch || null]
    );
  }

  for (const m of matches) {
    await c.query(
      `INSERT INTO matches (winners, losers, ts, recorded_by) VALUES ($1,$2,$3,$4)`,
      [JSON.stringify(m.winners || []), JSON.stringify(m.losers || []),
       m.ts || Date.now(), m.recordedBy || '이전 기록']
    );
  }

  for (const r of requests) {
    await c.query(
      `INSERT INTO requests (id, type, new_id, new_clan, target_id, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.type, r.newId || null, r.newClan || null, r.targetId || null, r.requestedAt || Date.now()]
    );
  }

  for (const a of admins) {
    if (!a.id) continue;
    const generated = !a.password;
    const pw = a.password || tempPw();
    if (generated) issued.push([a.id, pw]);
    await c.query(
      `INSERT INTO admins (id, pw_hash, must_change) VALUES ($1,$2,TRUE)
       ON CONFLICT (id) DO UPDATE SET pw_hash = EXCLUDED.pw_hash, must_change = TRUE`,
      [a.id, hashPw(pw)]
    );
  }
});

console.log(`✅ 적재 완료 — 선수 ${players.length}명 / 경기 ${matches.length}건 / 관리자 ${admins.length}명 / 대기요청 ${requests.length}건`);

if (issued.length) {
  console.log('\n⚠ 아래 임시 비밀번호는 지금 이 화면에만 표시됩니다. 각 관리자에게 개별 전달하고 로그인 후 즉시 변경하게 하세요.\n');
  const w = Math.max(...issued.map(([id]) => id.length));
  for (const [id, pw] of issued) console.log(`   ${id.padEnd(w)}   ${pw}`);
  console.log('');
} else {
  console.log('⚠ 파일에 있던 비밀번호는 해시로 저장되었습니다. 로그인 후 반드시 변경하세요.');
}

await getPool().end();
