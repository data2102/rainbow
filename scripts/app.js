/* ================= LADDER ZONE · r6rank.co.kr =================
   데이터는 서버(Postgres)에 저장됩니다. 이 스크립트는 API만 호출합니다.
   ============================================================== */

let players = [];
let matches = [];
let requests = [];
let admins = [];
let tMatches = [];          // 대회 경기 기록

/* 대회 참가 팀. api/tournament.js 의 TEAMS 와 id 가 일치해야 합니다. */
const TOURNAMENT_TEAMS = [
  { id: 'A', label: 'A팀', members: ['레나', '네오', '블루베리', '키스'] },
  { id: 'B', label: 'B팀', members: ['현정', '구짭', '범상', '짱가'] },
  { id: 'C', label: 'C팀', members: ['멘탈', '메가', '소소', '보리'] },
  { id: 'D', label: 'D팀', members: ['진원', '람보', '플라스', '수까락'] },
  { id: 'E', label: 'E팀', members: ['벨리', '까를', '티얼', '조커'] },
];
const MERCENARIES = ['렌보짱', '럭키', '호신', '실장'];
const ADVANCING = 4;        // 예선 통과 팀 수

function teamLabel(id) {
  const t = TOURNAMENT_TEAMS.find(t => t.id === id);
  return t ? t.label : id;
}
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

async function loadTournament() {
  try {
    const d = await apiGet('/api/tournament');
    tMatches = d.matches || [];
  } catch { tMatches = []; }
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
  const tbody = document.querySelector('#historyTable tbody');
  const wrap = document.getElementById('historyTableWrap');
  const empty = document.getElementById('historyEmpty');
  if (!tbody || !wrap || !empty) return;

  if (!matches.length) {
    tbody.innerHTML = '';
    wrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  wrap.style.display = '';
  empty.style.display = 'none';

  const all = [...matches].reverse();
  tbody.innerHTML = all.map((m, i) => {
    const winners = m.winners || [];
    const losers = m.losers || [];
    const d = new Date(m.ts);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

    const winChips = winners.map(w =>
      `<span class="h-chip w">${esc(w.handle)}<span class="h-gain">+${w.gained !== undefined ? w.gained : '-'}</span></span>`
    ).join('') || '<span class="h-chip l">-</span>';
    const loseChips = losers.map(h => `<span class="h-chip l">${esc(h)}</span>`).join('')
      || '<span class="h-chip l">-</span>';

    return `<tr>
      <td class="h-no-cell h-inline" data-l="기록">#${all.length - i}</td>
      <td class="h-inline" data-l="일시"><div class="h-date">${date}</div><div class="h-time">${time}</div></td>
      <td class="h-size-cell h-inline" data-l="규모">${winners.length} : ${losers.length}</td>
      <td data-l="승리 · WIN">${winChips}</td>
      <td data-l="패배 · LOSE">${loseChips}</td>
      <td class="h-by-cell" data-l="등록자">${esc(m.recordedBy || '-')}</td>
    </tr>`;
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
  renderTournament();
}

/* ---------- 대회 (TOURNAMENT) ---------- */

/** 예선 순위: 승 많은 순 → 패 적은 순 → 팀 순 */
function groupStandings() {
  const rows = TOURNAMENT_TEAMS.map(t => ({ ...t, played: 0, wins: 0, losses: 0 }));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));

  for (const m of tMatches) {
    if (m.stage !== 'group') continue;
    const a = byId[m.teamA];
    const b = byId[m.teamB];
    if (!a || !b) continue;
    a.played++; b.played++;
    if (m.winner === m.teamA) { a.wins++; b.losses++; }
    else                      { b.wins++; a.losses++; }
  }

  rows.sort((x, y) => y.wins - x.wins || x.losses - y.losses || x.id.localeCompare(y.id));

  // 전적이 같으면 같은 순위를 준다. 순위를 임의로 갈라놓으면
  // 아직 정해지지 않은 순서가 정해진 것처럼 보이기 때문이다.
  let rank = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (prev && prev.wins === r.wins && prev.losses === r.losses) r.rank = prev.rank;
    else r.rank = ++rank;
    if (prev && prev.rank === r.rank) { prev.tied = true; r.tied = true; }
    rank = Math.max(rank, i + 1);
  });
  return rows;
}

function renderTeamCards() {
  const el = document.getElementById('teamCards');
  if (!el) return;
  const teams = TOURNAMENT_TEAMS.map(t => `
    <div class="team-card">
      <div class="tc-name">${esc(t.label)}</div>
      <div class="tc-roster">${t.members.map(esc).join(' · ')}</div>
    </div>`).join('');
  el.innerHTML = teams + `
    <div class="team-card is-merc">
      <div class="tc-name">용병</div>
      <div class="tc-roster">${MERCENARIES.map(esc).join(' · ')}<br><em>그 외 상황 봐서</em></div>
    </div>`;
}

function renderGroupTable() {
  const tbody = document.querySelector('#groupTable tbody');
  if (!tbody) return;
  const rows = groupStandings();
  const anyPlayed = rows.some(r => r.played > 0);

  tbody.innerHTML = rows.map(r => {
    const rate = r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0;
    // 자기 순위까지의 팀 수가 진출 정원을 넘지 않아야 진출 확정이다.
    // 정원 경계에서 동률이면 그 팀들은 아직 확정이 아니라 '경합' 상태다.
    const upTo = rows.filter(o => o.rank <= r.rank).length;
    const settled = anyPlayed && upTo <= ADVANCING;
    const contesting = anyPlayed && !settled && r.rank <= ADVANCING;
    const tag = settled ? '<span class="adv-tag">본선</span>'
              : contesting ? '<span class="vie-tag">경합</span>' : '';
    return `<tr class="${settled ? 'is-adv' : ''}">
      <td class="rank-cell ${anyPlayed ? medalClass(r.rank) : ''}">${anyPlayed ? r.rank : '-'}${r.tied && anyPlayed ? '<span class="tie-tag">동률</span>' : ''}</td>
      <td><b>${esc(r.label)}</b> ${tag}</td>
      <td>${r.played}</td>
      <td class="win-txt">${r.wins}</td>
      <td class="loss-txt">${r.losses}</td>
      <td>${rate}%</td>
    </tr>`;
  }).join('');

  const note = document.getElementById('groupNote');
  if (note) {
    const played = tMatches.filter(m => m.stage === 'group').length;
    const hasTie = anyPlayed && rows.some(r =>
      r.rank <= ADVANCING && rows.filter(o => o.rank <= r.rank).length > ADVANCING);
    note.innerHTML = anyPlayed
      ? `예선 ${played}경기 반영 · 상위 ${ADVANCING}팀이 본선에 진출합니다.`
        + (hasTie ? ' <b style="color:var(--amber);">마지막 진출 자리를 두고 동률이 있습니다 — 경합 팀 중 진출 팀은 따로 정하세요.</b>' : '')
      : '아직 기록된 예선 경기가 없습니다. 경기를 기록하면 순위가 자동으로 계산됩니다.';
  }
}

function renderTournamentForm() {
  const form = document.getElementById('tForm');
  const hint = document.getElementById('tFormHint');
  if (!form || !hint) return;

  form.style.display = currentAdmin ? 'block' : 'none';
  hint.style.display = currentAdmin ? 'none' : 'block';
  if (!currentAdmin) return;

  // 팀 선택지는 한 번만 채운다
  const selA = document.getElementById('tTeamA');
  if (selA && !selA.options.length) {
    const opts = TOURNAMENT_TEAMS.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
    selA.innerHTML = opts;
    document.getElementById('tTeamB').innerHTML = opts;
    document.getElementById('tTeamB').selectedIndex = 1;
  }
  syncWinnerOptions();
}

/** 승리 팀 선택지를 현재 고른 두 팀으로 맞춘다 */
function syncWinnerOptions() {
  const a = document.getElementById('tTeamA');
  const b = document.getElementById('tTeamB');
  const w = document.getElementById('tWinner');
  if (!a || !b || !w) return;
  const prev = w.value;
  w.innerHTML = [a.value, b.value]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map(id => `<option value="${id}">${esc(teamLabel(id))} 승리</option>`)
    .join('');
  if ([a.value, b.value].includes(prev)) w.value = prev;
}

function renderTournamentLog() {
  const el = document.getElementById('tMatchLog');
  if (!el) return;
  if (!tMatches.length) {
    el.innerHTML = '<div class="log-empty">아직 기록된 대회 경기가 없습니다.</div>';
    return;
  }

  el.innerHTML = [...tMatches].reverse().map(m => {
    const loser = m.winner === m.teamA ? m.teamB : m.teamA;
    return `<div class="tlog">
      <div class="tlog-top">
        <span class="stage-tag ${m.stage}">${m.stage === 'group' ? '예선' : '본선'}</span>
        <span class="tlog-teams">
          <b class="win-txt">${esc(teamLabel(m.winner))}</b>
          <span class="tlog-vs">승</span>
          <span class="loss-txt">${esc(teamLabel(loser))}</span>
        </span>
        ${m.note ? `<span class="tlog-note">${esc(m.note)}</span>` : ''}
        ${currentAdmin ? `<button class="btn-mini btn-reject" data-tdel="${m.id}">삭제</button>` : ''}
      </div>
      <div class="tlog-meta">등록자 : ${esc(m.recordedBy || '-')} · ${formatDateTime(m.ts)}</div>
    </div>`;
  }).join('');
}

function renderTournament() {
  renderTeamCards();
  renderGroupTable();
  renderTournamentForm();
  renderTournamentLog();
}

async function recordTournamentMatch() {
  const stage = document.getElementById('tStage').value;
  const teamA = document.getElementById('tTeamA').value;
  const teamB = document.getElementById('tTeamB').value;
  const winner = document.getElementById('tWinner').value;
  const note = document.getElementById('tNote').value.trim();

  if (teamA === teamB) return showToast('서로 다른 두 팀을 선택해주세요.');

  try {
    await apiPost('/api/tournament', { action: 'record', stage, teamA, teamB, winner, note });
    document.getElementById('tNote').value = '';
    await loadTournament();
    renderTournament();
    showToast(`${teamLabel(winner)} 승리로 기록했습니다.`);
  } catch (e) { showToast(e.message); }
}

async function deleteTournamentMatch(id) {
  if (!confirm('이 대회 경기 기록을 삭제할까요? 예선 순위에서도 함께 빠집니다.')) return;
  try {
    await apiPost('/api/tournament', { action: 'delete', id: Number(id) });
    await loadTournament();
    renderTournament();
    showToast('기록을 삭제했습니다.');
  } catch (e) { showToast(e.message); }
}

function initTournamentEvents() {
  const a = document.getElementById('tTeamA');
  const b = document.getElementById('tTeamB');
  if (a) a.addEventListener('change', syncWinnerOptions);
  if (b) b.addEventListener('change', syncWinnerOptions);

  const btn = document.getElementById('tRecordBtn');
  if (btn) btn.addEventListener('click', recordTournamentMatch);

  const log = document.getElementById('tMatchLog');
  if (log) log.addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.tdel;
    if (id) deleteTournamentMatch(id);
  });
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
  await loadTournament();
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
  initTournamentEvents();
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
