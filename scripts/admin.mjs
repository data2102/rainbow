/**
 * 관리자 계정 도구 — 비밀번호를 잊었을 때 사용합니다.
 *
 *   node scripts/admin.mjs                     관리자 목록 보기
 *   node scripts/admin.mjs reset <ID>          임시 비밀번호로 되돌리기
 *   node scripts/admin.mjs reset-all           전원 임시 비밀번호로 되돌리기
 *   node scripts/admin.mjs rename <옛ID> <새ID>  ID 변경 (비밀번호 유지)
 *
 * 선수 명단과 경기 기록은 전혀 건드리지 않습니다.
 * (db:seed 는 경기 기록을 시드 시점으로 되돌리므로 운영 중에는 쓰면 안 됩니다.)
 *
 * 실행 전 연결 문자열을 지정하세요.
 *   export DATABASE_URL="postgresql://..."      # Windows: $env:DATABASE_URL="..."
 */
import { q, getPool, hashPw, audit, TEMP_PASSWORD } from '../api/_lib.js';

const USAGE = `
사용법
  node scripts/admin.mjs                       관리자 목록 보기
  node scripts/admin.mjs reset <ID>            임시 비밀번호로 되돌리기
  node scripts/admin.mjs reset-all            전원 임시 비밀번호로 되돌리기
  node scripts/admin.mjs rename <옛ID> <새ID>    ID 변경 (비밀번호 유지)
`;

async function fetchAdmins() {
  return q(`SELECT id, must_change FROM admins ORDER BY id`);
}

async function list() {
  const rows = await fetchAdmins();
  if (!rows.length) {
    console.log('\n관리자 계정이 없습니다.\n');
    return;
  }
  const w = Math.max(...rows.map((r) => r.id.length));
  console.log(`\n관리자 ${rows.length}명\n`);
  for (const r of rows) {
    console.log(`   ${r.id.padEnd(w)}   ${r.must_change ? '임시 비밀번호 (첫 로그인 시 변경 필요)' : '비밀번호 설정 완료'}`);
  }
  console.log(USAGE);
}

async function reset(id) {
  if (!id) {
    console.error('재발급할 관리자 ID를 입력해주세요.');
    console.error(USAGE);
    await list();
    process.exitCode = 1;
    return;
  }

  const found = await q(`SELECT id FROM admins WHERE id = $1`, [id]);
  if (!found.length) {
    console.error(`\n'${id}' 라는 관리자가 없습니다.`);
    await list();
    process.exitCode = 1;
    return;
  }

  const pw = TEMP_PASSWORD;
  await q(`UPDATE admins SET pw_hash = $1, must_change = TRUE WHERE id = $2`, [hashPw(pw), id]);

  // 예전 비밀번호로 로그인해 있던 세션은 모두 끊는다
  const killed = await q(`DELETE FROM sessions WHERE admin_id = $1 RETURNING token`, [id]);
  await audit(null, 'reset_password_cli', { id });

  console.log(`\n✅ ${id} 의 비밀번호를 '${pw}' 로 되돌렸습니다.\n`);
  console.log('⚠ 본인에게 전달하고 로그인 후 즉시 변경하게 하세요.');
  console.log('  (첫 로그인 시 변경 창이 강제로 뜨며 8자 이상이어야 합니다)');
  if (killed.length) {
    console.log(`\n  기존 로그인 세션 ${killed.length}건을 함께 종료했습니다.`);
  }
  console.log('');
}

async function resetAll() {
  const rows = await fetchAdmins();
  if (!rows.length) {
    console.log('\n관리자 계정이 없습니다.\n');
    return;
  }
  const hash = hashPw(TEMP_PASSWORD);
  await q(`UPDATE admins SET pw_hash = $1, must_change = TRUE`, [hash]);
  const killed = await q(`DELETE FROM sessions RETURNING token`);
  await audit(null, 'reset_all_passwords_cli', { count: rows.length });

  console.log(`\n✅ 관리자 ${rows.length}명의 비밀번호를 모두 '${TEMP_PASSWORD}' 로 되돌렸습니다.\n`);
  for (const r of rows) console.log(`   ${r.id}`);
  console.log(`\n⚠ 전원 첫 로그인 시 비밀번호 변경 창이 뜹니다. 8자 이상으로 바꾸게 하세요.`);
  if (killed.length) console.log(`   기존 로그인 세션 ${killed.length}건을 함께 종료했습니다.`);
  console.log('');
}

async function rename(oldId, newId) {
  if (!oldId || !newId) {
    console.error('바꿀 관리자 ID와 새 ID를 모두 입력해주세요.');
    console.error(USAGE);
    await list();
    process.exitCode = 1;
    return;
  }

  const found = await q(`SELECT id FROM admins WHERE id = $1`, [oldId]);
  if (!found.length) {
    console.error(`\n'${oldId}' 라는 관리자가 없습니다. (대소문자까지 정확히 입력하세요)`);
    await list();
    process.exitCode = 1;
    return;
  }

  // 대소문자만 다른 ID 가 이미 있으면 로그인 시 어느 계정인지 가릴 수 없다
  const clash = await q(
    `SELECT id FROM admins WHERE lower(id) = lower($1) AND id <> $2`, [newId, oldId]
  );
  if (clash.length) {
    console.error(`\n'${clash[0].id}' 와 겹칩니다. 다른 ID를 쓰세요.`);
    process.exitCode = 1;
    return;
  }

  // sessions.admin_id 는 admins(id) 를 ON DELETE CASCADE 로 참조한다.
  // 이름을 바꾸면 참조가 따라가지 않으므로 해당 계정 세션은 정리한다.
  await q(`UPDATE admins SET id = $1 WHERE id = $2`, [newId, oldId]);
  const killed = await q(`DELETE FROM sessions WHERE admin_id = $1 RETURNING token`, [newId]);
  await audit(null, 'rename_admin_cli', { from: oldId, to: newId });

  console.log(`\n✅ ${oldId} → ${newId} 로 변경했습니다.`);
  console.log('   비밀번호는 그대로입니다.');
  if (killed.length) console.log(`   기존 로그인 세션 ${killed.length}건을 함께 종료했습니다.`);
  console.log('');
}

const [action, id, id2] = process.argv.slice(2);

try {
  if (!action)                 await list();
  else if (action === 'list')  await list();
  else if (action === 'reset')     await reset(id);
  else if (action === 'reset-all') await resetAll();
  else if (action === 'rename') await rename(id, id2);
  else {
    console.error(`\n알 수 없는 명령입니다: ${action}`);
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  console.error('\n실패:', e.message);
  if (/DATABASE_URL/.test(e.message)) {
    console.error('\n연결 문자열을 먼저 지정하세요.');
    console.error('  export DATABASE_URL="postgresql://..."      # Windows: $env:DATABASE_URL="..."');
  }
  process.exitCode = 1;
} finally {
  // DATABASE_URL 이 없으면 풀이 아예 만들어지지 않으므로 정리도 건너뛴다
  try { await getPool().end(); } catch { /* noop */ }
}
