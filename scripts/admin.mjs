/**
 * 관리자 계정 도구 — 비밀번호를 잊었을 때 사용합니다.
 *
 *   node scripts/admin.mjs               관리자 목록 보기
 *   node scripts/admin.mjs reset <ID>    임시 비밀번호 재발급
 *
 * 선수 명단과 경기 기록은 전혀 건드리지 않습니다.
 * (db:seed 는 경기 기록을 시드 시점으로 되돌리므로 운영 중에는 쓰면 안 됩니다.)
 *
 * 실행 전 연결 문자열을 지정하세요.
 *   export DATABASE_URL="postgresql://..."      # Windows: $env:DATABASE_URL="..."
 */
import { randomBytes } from 'node:crypto';
import { q, getPool, hashPw, audit } from '../api/_lib.js';

const USAGE = `
사용법
  node scripts/admin.mjs               관리자 목록 보기
  node scripts/admin.mjs reset <ID>    임시 비밀번호 재발급
`;

/** 사람이 옮겨적을 수 있는 임시 비밀번호 */
function tempPw() {
  return 'R6-' + randomBytes(6).toString('base64url');
}

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

  const pw = tempPw();
  await q(`UPDATE admins SET pw_hash = $1, must_change = TRUE WHERE id = $2`, [hashPw(pw), id]);

  // 예전 비밀번호로 로그인해 있던 세션은 모두 끊는다
  const killed = await q(`DELETE FROM sessions WHERE admin_id = $1 RETURNING token`, [id]);
  await audit(null, 'reset_password_cli', { id });

  console.log(`\n✅ ${id} 의 비밀번호를 재발급했습니다.\n`);
  console.log(`   임시 비밀번호   ${pw}\n`);
  console.log('⚠ 이 값은 지금 이 화면에만 표시됩니다. 본인에게 직접 전달하고,');
  console.log('  로그인 후 즉시 변경하게 하세요. (첫 로그인 시 변경 창이 강제로 뜹니다)');
  if (killed.length) {
    console.log(`\n  기존 로그인 세션 ${killed.length}건을 함께 종료했습니다.`);
  }
  console.log('');
}

const [action, id] = process.argv.slice(2);

try {
  if (!action)                 await list();
  else if (action === 'list')  await list();
  else if (action === 'reset') await reset(id);
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
