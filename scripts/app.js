/* ================= LADDER ZONE · r6rank.co.kr =================
   데이터는 서버(Postgres)에 저장됩니다. 이 스크립트는 API만 호출합니다.
   ============================================================== */

let players = [];
let matches = [];
let requests = [];
let admins = [];
let currentAdmin = null;
let authToken = null;       // 메모리에만 보관 (새로고침 시 재로그인)

let sortKey = 'point';
let sortDir = -1;

/* ---------- API ---------- */

function authHeaders() {
  return authToken ? { Authorization: 'Bearer ' + authToken } : {};
}

async function apiGet(url) {
  const r = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  return handleRes(r);
}

async function apiPost(url, payload) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return handleRes(r);
}

async function handleRes(r) {
  let data = null;
  try { data = await r.json(); } catch { /* noop */ }
  if (!r.ok) {
    if (r.status === 401) { authToken = null; currentAdmin = null; renderAuthBar(); }
    throw new Error((data && data.error) || `서버 오류 (${r.status})`);
  }
  return data;
}

/* ---------- 데이터 로드 ---------- */

async function loadState() {
  const d = await apiGet('/api/state');
  players = d.players || [];
  matches = d.matches || [];
  requests = d.requests || [];
}

async function loadAdmins() {
  if (!currentAdmin) { admins = []; return; }
  try {
    const d = await apiPost('/api/admin', { action: 'list' });
    admins = d.admins || [];
  } catch { admins = []; }
}

/* ---------- 계산 ---------- */

function ratio(p) {
  const total = p.wins + p.losses;
  if (total === 0) return 0;
  return Math.round((p.wins / total) * 1000) / 10;
}
function parity(p) { return p.wins * 5 + p.losses * 2; }
function findPlayer(handle) { return players.find(p => p.handle === handle); }
function medalClass(rank) { return rank === 1 ? 'rank1' : rank === 2 ? 'rank2' : rank === 3 ? 'rank3' : ''; }
function pad2(n) { return String(n).padStart(2, '0'); }
function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function sortedPlayers() {
  const arr = [...players];
  arr.sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'handle': return sortDir * a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
      case 'clan':   return sortDir * a.clan.toLowerCase().localeCompare(b.clan.toLowerCase());
      case 'point':  av = a.point; bv = b.point; break;
      case 'win':    av = a.wins; bv = b.wins; break;
      case 'loss':   av = a.losses; bv = b.losses; break;
      case 'ratio':  av = ratio(a); bv = ratio(b); break;
      case 'streak': av = a.streak; bv = b.streak; break;
      case 'parity': av = parity(a); bv = parity(b); break;
      default:       av = a.point; bv = b.point;
    }
    return sortDir * (av - bv);
  });
  return arr;
}

/* ---------- 렌더 ---------- */

function renderStanding() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const tbody = document.querySelector('#standingTable tbody');
  const ranked = sortedPlayers().map((p, i) => ({ ...p, rank: i + 1 }));
  const filtered = q
    ? ranked.filter(p => p.handle.toLowerCase().includes(q) || p.clan.toLowerCase().includes(q))
    : ranked;

  tbody.innerHTML = filtered.map(p => {
    let streakCell;
    if (p.streak >= 5)       streakCell = `<span class="up-badge">▲ +${p.streak}(UP)</span>`;
    else if (p.streak <= -5) streakCell = `<span class="down-badge">▼ ${p.streak}(DOWN)</span>`;
    else if (p.streak > 0)   streakCell = `<span class="streak-pos">+${p.streak}</span>`;
    else if (p.streak < 0)   streakCell = `<span class="streak-neg">${p.streak}</span>`;
    else                     streakCell = '0';
    return `<tr>
      <td class="rank-cell ${medalClass(p.rank)}">${p.rank}</td>
      <td>${esc(p.handle)}</td>
      <td class="clan-tag">${esc(p.clan)}</td>
      <td>${p.point}</td>
      <td class="win-txt">${p.wins}</td>
      <td class="loss-txt">${p.losses}</td>
      <td>${ratio(p)}%</td>
      <td>${streakCell}</td>
      <td>${parity(p)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="log-empty">검색 결과 없음</td></tr>';

  document.querySelectorAll('#standingTable th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
  });
}

function renderTop5() {
  const byPoint = [...players].sort((a, b) => b.point - a.point).slice(0, 10);
  const byWin = [...players].sort((a, b) => b.wins - a.wins).slice(0, 10);

  document.getElementById('topPointBody').innerHTML = byPoint.map((p, i) => `
    <tr><td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td><td>${esc(p.handle)}</td>
    <td class="clan-tag">${esc(p.clan)}</td><td>${p.point}</td>
    <td class="win-txt">${p.wins}</td><td class="loss-txt">${p.losses}</td></tr>`).join('');

  document.getElementById('topWinBody').innerHTML = byWin.map((p, i) => `
    <tr><td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td><td>${esc(p.handle)}</td>
    <td class="clan-tag">${esc(p.clan)}</td>
    <td class="win-txt">${p.wins}</td><td class="loss-txt">${p.losses}</td><td>${ratio(p)}%</td></tr>`).join('');
}

function getChecked(listId) {
  return Array.from(document.querySelectorAll(`#${listId} input[type=checkbox]:checked`)).map(el => el.value);
}

function renderChecklists() {
  const winChecked = new Set(getChecked('winList'));
  const loseChecked = new Set(getChecked('loseList'));

  const rowHtml = (p, side) => {
    const opposed = side === 'win' ? loseChecked : winChecked;
    const disabled = opposed.has(p.handle);
    const checked = side === 'win' ? winChecked.has(p.handle) : loseChecked.has(p.handle);
    return `<label class="check-item ${disabled ? 'disabled' : ''}">
      <input type="checkbox" value="${esc(p.handle)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-side="${side}">
      <span>${esc(p.handle)}</span> <span class="clan-mini">${esc(p.clan)}</span>
    </label>`;
  };

  const winList = document.getElementById('winList');
  const loseList = document.getElementById('loseList');
  if (!winList || !loseList) return;
  winList.innerHTML = players.map(p => rowHtml(p, 'win')).join('');
  loseList.innerHTML = players.map(p => rowHtml(p, 'lose')).join('');

  document.querySelectorAll('#winList input, #loseList input').forEach(el => {
    el.addEventListener('change', renderChecklists);
  });

  const submit = document.getElementById('submitMatch');
  if (submit) submit.disabled = !(getChecked('winList').length > 0 && getChecked('loseList').length > 0);
}

function matchLine(m) {
  const winners = m.winners || [];
  const losers = m.losers || [];
  return {
    win: winners.map(w => `${esc(w.handle)}(+${w.gained !== undefined ? w.gained : '-'})`).join(', '),
    lose: losers.map(esc).join(', '),
    wc: winners.length, lc: losers.length,
  };
}

function renderLog() {
  const box = document.getElementById('logBody');
  if (!box) return;
  if (!matches.length) { box.innerHTML = '<div class="log-empty">기록 없음</div>'; return; }
  box.innerHTML = [...matches].slice(-8).reverse().map(m => {
    const l = matchLine(m);
    return `<div class="log-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
      <div><span class="win-txt">WIN(${l.wc})</span> ${l.win}</div>
      <div><span class="loss-txt">LOSE(${l.lc})</span> ${l.lose}</div>
      <div class="log-meta">등록자 : ${esc(m.recordedBy || '-')} · 등록일시 : ${formatDateTime(m.ts)}</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const box = document.getElementById('historyList');
  if (!box) return;
  if (!matches.length) { box.innerHTML = '<div class="log-empty">기록 없음</div>'; return; }
  const all = [...matches].reverse();
  box.innerHTML = all.map((m, i) => {
    const l = matchLine(m);
    return `<div class="history-card">
      <div class="history-no">기록 #${all.length - i}</div>
      <div><span class="win-txt">WIN(${l.wc})</span> ${l.win}</div>
      <div><span class="loss-txt">LOSE(${l.lc})</span> ${l.lose}</div>
      <div class="log-meta">등록자 : ${esc(m.recordedBy || '-')} · 등록일시 : ${formatDateTime(m.ts)}</div>
    </div>`;
  }).join('');
}

function renderPending() {
  const box = document.getElementById('pendingList');
  if (!box) return;
  if (!requests.length) { box.innerHTML = '<div class="log-empty">대기 중인 요청이 없습니다.</div>'; return; }
  box.innerHTML = requests.map(r => {
    const head = r.type === 'add'
      ? `<span class="pill pill-add">신규등록</span>ID: <b>${esc(r.newId)}</b> · CLAN: <b>${esc(r.newClan)}</b>`
      : `<span class="pill pill-remove">삭제요청</span>ID: <b>${esc(r.targetId)}</b>`;
    return `<div class="req-row">
      <div>${head}</div>
      <div class="log-meta">신청일시 : ${formatDateTime(r.requestedAt)}</div>
      <div class="req-actions">
        <button class="btn-mini btn-approve" data-id="${esc(r.id)}" data-action="approve">승인</button>
        <button class="btn-mini btn-reject" data-id="${esc(r.id)}" data-action="reject">거절</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleRequestAction(btn.dataset.id, btn.dataset.action));
  });
}

function renderAdminList() {
  const box = document.getElementById('adminList');
  if (!box) return;
  box.innerHTML = admins.map(a => `
    <div class="req-row" style="flex-direction:row;align-items:center;justify-content:space-between;">
      <div>${esc(a.id)}${a.mustChangePassword ? ' <span class="pill pill-warn">비번변경 필요</span>' : ''}</div>
      <button class="btn-mini btn-reject" data-admin="${esc(a.id)}">삭제</button>
    </div>`).join('') || '<div class="log-empty">등록된 관리자가 없습니다.</div>';

  box.querySelectorAll('button[data-admin]').forEach(btn => {
    btn.addEventListener('click', () => removeAdmin(btn.dataset.admin));
  });
}

function renderAll() {
  renderStanding();
  renderTop5();
  renderChecklists();
  renderLog();
  renderHistory();
  renderPending();
  renderAdminList();
}

/* ---------- 토스트 / 모달 ---------- */

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function openModal(html, forced) {
  document.getElementById('modalContent').innerHTML = html;
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('show');
  overlay.classList.toggle('force', !!forced);
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}
window.closeModal = closeModal;

/* ---------- 인증 UI ---------- */

function renderAuthBar() {
  const bar = document.getElementById('authBar');
  const adminHtml = currentAdmin
    ? `<span class="auth-user">관리자 : ${esc(currentAdmin)}</span>
       <button class="auth-btn" id="btnChangePw">비밀번호 변경</button>
       <button class="auth-btn" id="btnAdminLogout">로그아웃</button>`
    : `<button class="auth-btn" id="btnAdminLogin">관리자 로그인</button>`;

  bar.innerHTML = `
    <button class="auth-btn" id="btnReqAdd">신규회원 등록 신청</button>
    <button class="auth-btn" id="btnReqRemove">회원 삭제 요청</button>
    ${adminHtml}`;

  document.getElementById('btnReqAdd').addEventListener('click', showRequestAddModal);
  document.getElementById('btnReqRemove').addEventListener('click', showRequestRemoveModal);
  if (currentAdmin) {
    document.getElementById('btnChangePw').addEventListener('click', () => showChangePasswordModal(false));
    document.getElementById('btnAdminLogout').addEventListener('click', doAdminLogout);
  } else {
    document.getElementById('btnAdminLogin').addEventListener('click', showAdminLoginModal);
  }
  renderAdminGate();
}

function renderAdminGate() {
  const locked = document.getElementById('adminLocked');
  const authed = document.getElementById('adminAuthed');
  if (!locked || !authed) return;
  locked.style.display = currentAdmin ? 'none' : 'block';
  authed.style.display = currentAdmin ? 'block' : 'none';
}

/* ---------- 회원 신청 ---------- */

function showRequestAddModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>신규회원 등록 신청</h3>
    <label>ID *</label><input type="text" id="reqAddId" maxlength="40">
    <label>CLAN *</label><input type="text" id="reqAddClan" maxlength="20">
    <div class="modal-error" id="reqAddErr"></div>
    <button class="btn" id="reqAddSubmit">신청하기</button>
    <div class="foot-note">신청 후 관리자 승인이 완료되면 명단에 자동으로 추가됩니다.</div>`);
  document.getElementById('reqAddSubmit').addEventListener('click', doRequestAdd);
}

async function doRequestAdd() {
  const id = document.getElementById('reqAddId').value.trim();
  const clan = document.getElementById('reqAddClan').value.trim();
  const err = document.getElementById('reqAddErr');
  try {
    await apiPost('/api/request', { action: 'createAdd', id, clan });
    await refreshAll();
    closeModal();
    showToast('등록 신청이 접수되었습니다. 관리자 승인을 기다려주세요.');
  } catch (e) { err.textContent = e.message; }
}

function showRequestRemoveModal() {
  if (!players.length) { showToast('삭제 요청할 수 있는 회원이 없습니다.'); return; }
  const opts = players.map(p => `<option value="${esc(p.handle)}">${esc(p.handle)} (${esc(p.clan)})</option>`).join('');
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>회원 삭제 요청</h3>
    <label>삭제를 요청할 회원 ID *</label>
    <select id="reqRemoveId">${opts}</select>
    <div class="modal-error" id="reqRemoveErr"></div>
    <button class="btn" id="reqRemoveSubmit">신청하기</button>
    <div class="foot-note">신청 후 관리자 승인이 완료되면 명단에서 삭제됩니다.</div>`);
  document.getElementById('reqRemoveSubmit').addEventListener('click', doRequestRemove);
}

async function doRequestRemove() {
  const targetId = document.getElementById('reqRemoveId').value;
  const err = document.getElementById('reqRemoveErr');
  try {
    await apiPost('/api/request', { action: 'createRemove', targetId });
    await refreshAll();
    closeModal();
    showToast('삭제 요청이 접수되었습니다. 관리자 승인을 기다려주세요.');
  } catch (e) { err.textContent = e.message; }
}

async function handleRequestAction(reqId, action) {
  try {
    await apiPost('/api/request', { action, id: reqId });
    await refreshAll();
    showToast(action === 'approve' ? '요청을 승인했습니다.' : '요청을 거절했습니다.');
  } catch (e) { showToast(e.message); }
}

/* ---------- 관리자 ---------- */

function showAdminLoginModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>관리자 로그인 · ADMIN LOGIN</h3>
    <label>관리자 ID</label><input type="text" id="adminLoginId">
    <label>비밀번호</label><input type="password" id="adminLoginPw">
    <div class="modal-error" id="adminLoginErr"></div>
    <button class="btn" id="adminLoginSubmit">로그인</button>
    <div class="foot-note">로그인 상태는 12시간 유지되며, 페이지를 새로고침하면 다시 로그인해야 합니다.</div>`);
  document.getElementById('adminLoginSubmit').addEventListener('click', doAdminLogin);
  document.getElementById('adminLoginPw').addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdminLogin();
  });
}

async function doAdminLogin() {
  const id = document.getElementById('adminLoginId').value.trim();
  const password = document.getElementById('adminLoginPw').value;
  const err = document.getElementById('adminLoginErr');
  try {
    const d = await apiPost('/api/admin', { action: 'login', id, password });
    authToken = d.token;
    currentAdmin = d.admin;
    closeModal();
    await refreshAll();
    renderAuthBar();
    if (d.mustChangePassword) {
      showToast(`${d.admin}님 로그인되었습니다. 비밀번호를 변경해주세요.`);
      showChangePasswordModal(true);
    } else {
      showToast(`${d.admin}님 로그인되었습니다.`);
    }
  } catch (e) { err.textContent = e.message; }
}

async function doAdminLogout() {
  try { await apiPost('/api/admin', { action: 'logout' }); } catch { /* noop */ }
  authToken = null;
  currentAdmin = null;
  admins = [];
  renderAuthBar();
  renderAll();
  showToast('로그아웃되었습니다.');
}

function showChangePasswordModal(forced) {
  openModal(`
    ${forced ? '' : '<button class="modal-x" onclick="closeModal()">✕</button>'}
    <h3>비밀번호 변경${forced ? ' · 최초 로그인' : ''}</h3>
    ${forced ? '<div class="warn-box">⚠ 초기 비밀번호 상태입니다. 보안을 위해 변경 후 이용해주세요.</div>' : ''}
    <label>기존 비밀번호</label><input type="password" id="cpOld">
    <label>새 비밀번호 (8자 이상)</label><input type="password" id="cpNew1">
    <label>새 비밀번호 확인</label><input type="password" id="cpNew2">
    <div class="modal-error" id="cpErr"></div>
    <button class="btn" id="cpSubmit">변경하기</button>`, forced);
  document.getElementById('cpSubmit').addEventListener('click', () => doChangePassword(forced));
}

async function doChangePassword() {
  const oldPassword = document.getElementById('cpOld').value;
  const n1 = document.getElementById('cpNew1').value;
  const n2 = document.getElementById('cpNew2').value;
  const err = document.getElementById('cpErr');
  if (n1 !== n2) { err.textContent = '새 비밀번호가 서로 일치하지 않습니다.'; return; }
  try {
    await apiPost('/api/admin', { action: 'changePassword', oldPassword, newPassword: n1 });
    document.getElementById('modalOverlay').classList.remove('force');
    closeModal();
    await loadAdmins();
    renderAdminList();
    showToast('비밀번호가 변경되었습니다.');
  } catch (e) { err.textContent = e.message; }
}

async function addAdmin() {
  const input = document.getElementById('newAdminId');
  const id = input.value.trim();
  if (!id) { showToast('ID를 입력해주세요.'); return; }
  try {
    const d = await apiPost('/api/admin', { action: 'add', id });
    input.value = '';
    await loadAdmins();
    renderAdminList();
    alert(`${id} 관리자가 추가되었습니다.\n\n초기 비밀번호 : ${d.tempPassword}\n\n이 창을 닫으면 다시 볼 수 없으니 본인에게 전달해주세요.`);
  } catch (e) { showToast(e.message); }
}

async function removeAdmin(id) {
  if (!confirm(`${id} 관리자를 삭제하시겠습니까?`)) return;
  try {
    await apiPost('/api/admin', { action: 'remove', id });
    if (currentAdmin === id) { authToken = null; currentAdmin = null; renderAuthBar(); }
    await loadAdmins();
    renderAdminList();
    showToast('관리자가 삭제되었습니다.');
  } catch (e) { showToast(e.message); }
}

/* ---------- 경기 기록 ---------- */

async function recordTeamMatch(winners, losers) {
  const btn = document.getElementById('submitMatch');
  btn.disabled = true;
  try {
    await apiPost('/api/match', { winners, losers });
    await refreshAll();
    document.querySelectorAll('#winList input, #loseList input').forEach(el => { el.checked = false; });
    renderChecklists();
    showToast(`승리 ${winners.length}명 / 패배 ${losers.length}명 기록 완료`);
  } catch (e) {
    showToast(e.message);
    btn.disabled = false;
  }
}

/* ---------- 데이터 관리 ---------- */

async function exportData() {
  try {
    const d = await apiGet('/api/data');
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ladder_backup_${formatDateTime(Date.now()).replace(/[: ]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('데이터를 내보냈습니다.');
  } catch (e) { showToast(e.message); }
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('가져오기를 진행하면 현재 랭킹·기록이 모두 덮어써집니다. 계속하시겠습니까?')) {
    e.target.value = ''; return;
  }
  try {
    const payload = JSON.parse(await file.text());
    await apiPost('/api/data', { action: 'import', payload, mode: 'replace' });
    await refreshAll();
    showToast('데이터를 가져왔습니다.');
  } catch (err) {
    showToast('가져오기 실패: ' + err.message);
  }
  e.target.value = '';
}

/* ---------- 초기화 ---------- */

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'history') refreshAll();
    });
  });
}

function initStandingEvents() {
  document.getElementById('searchInput').addEventListener('input', renderStanding);
  document.querySelectorAll('#standingTable th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (key === 'rank') return;
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
      renderStanding();
    });
  });
}

function initAdminEvents() {
  document.getElementById('adminLockedLoginBtn').addEventListener('click', showAdminLoginModal);
  document.getElementById('addAdminBtn').addEventListener('click', addAdmin);
  document.getElementById('historyRefreshBtn').addEventListener('click', async () => {
    await refreshAll();
    showToast('최신 기록을 불러왔습니다.');
  });
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', handleImportFile);

  document.getElementById('submitMatch').addEventListener('click', async () => {
    const winners = getChecked('winList');
    const losers = getChecked('loseList');
    if (!winners.length || !losers.length) return;
    await recordTeamMatch(winners, losers);
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('모든 선수의 승/패/포인트를 0으로 초기화하고 경기 기록을 삭제합니다. 계속하시겠습니까?')) return;
    try {
      await apiPost('/api/data', { action: 'reset', keepPlayers: true });
      await refreshAll();
      showToast('전체 기록이 초기화되었습니다.');
    } catch (e) { showToast(e.message); }
  });

  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay' && !e.currentTarget.classList.contains('force')) closeModal();
  });
}

async function refreshAll() {
  await loadState();
  await loadAdmins();
  renderAll();
}

function showFatal(msg) {
  const el = document.getElementById('connBanner');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function boot() {
  initTabs();
  initStandingEvents();
  initAdminEvents();
  renderAuthBar();
  try {
    await refreshAll();
  } catch (e) {
    showFatal('⚠ 서버에 연결하지 못했습니다. (' + e.message + ') — 이 페이지는 서버(API)와 함께 배포해야 동작합니다.');
  }
  // 30초마다 자동 갱신 (STANDING 탭이 열려 있을 때만)
  setInterval(async () => {
    if (document.getElementById('tab-standing').classList.contains('active')) {
      try { await loadState(); renderStanding(); renderTop5(); } catch { /* noop */ }
    }
  }, 30000);
}

boot();
