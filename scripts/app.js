/* ================= LADDER ZONE · r6rank.co.kr =================
   데이터는 서버(Postgres)에 저장됩니다. 이 스크립트는 API만 호출합니다.
   ============================================================== */

let players = [];
let matches = [];
let requests = [];
let admins = [];
let tMatches = [];          // 대회 경기 기록
let posts = [];             // 게시판 글
let season = null;          // 진행 중인 시즌
let seasons = [];           // 시즌 목록(진행 중 + 마감)
let seasonTop = 10;         // 월간 결산 표에 보여줄 등수
let viewSeasonId = null;    // 화면에서 보고 있는 달. null 이면 진행 중인 달
const seasonCache = {};     // 지난 달 상세 (id -> {players, matches})
let attLogs = [];           // 보고 있는 달의 출퇴근 기록
let attLoaded = null;       // 그 기록이 어느 달 것인지
let playSlots = [];         // 고를 수 있는 시간대
let playSchedule = [];      // [{handle, slot}] 접속 예상 시간
let openCommentForm = null; // 댓글 입력창이 열린 글 id

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
const CLAN_TOP = 5;         // 클랜 순위에 보여줄 등수
const TOP_N = 5;            // 개인 순위 표에 보여줄 인원
const STANDING_HIGHLIGHT = 5; // STANDING 표에서 색을 달리 줄 상위 등수

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
  season = d.season || null;
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

async function loadSeasons() {
  try {
    const d = await apiGet('/api/season');
    season = d.current || season;
    seasons = d.seasons || [];
    if (d.top) seasonTop = d.top;
  } catch { seasons = []; }
}

/** 지난 달 상세는 고를 때 한 번만 받아 두고 재사용한다 */
async function loadSeasonDetail(id) {
  if (seasonCache[id]) return seasonCache[id];
  const d = await apiGet('/api/season?id=' + encodeURIComponent(id));
  seasonCache[id] = { players: d.players || [], matches: d.matches || [], season: d.season };
  return seasonCache[id];
}

/* ---------- 보고 있는 달 ---------- */

/** 진행 중인 달을 보고 있으면 true. 이때는 실시간 데이터를 그대로 쓴다. */
function isLiveView() {
  return !viewSeasonId || (season && viewSeasonId === season.id);
}
function viewPlayers() {
  if (isLiveView()) return players;
  const d = seasonCache[viewSeasonId];
  return d ? d.players : [];
}
function viewMatches() {
  if (isLiveView()) return matches;
  const d = seasonCache[viewSeasonId];
  return d ? d.matches : [];
}
function viewSeason() {
  if (isLiveView()) return season;
  return seasons.find(s => s.id === viewSeasonId) || null;
}

async function loadAttendance(id) {
  const target = id || (viewSeason() ? viewSeason().id : null);
  if (!target) { attLogs = []; attLoaded = null; return; }
  try {
    const d = await apiGet('/api/attendance?season=' + encodeURIComponent(target));
    attLogs = d.logs || [];
    if (d.slots) playSlots = d.slots;
    playSchedule = d.schedule || [];
    attLoaded = target;
  } catch { attLogs = []; attLoaded = null; }
}

async function loadPosts() {
  try {
    const d = await apiGet('/api/post');
    posts = d.posts || [];
  } catch { posts = []; }
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
  const arr = [...viewPlayers()];
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
    // 상위 등수는 STANDING 표에서만 색을 달리한다 (2페이지 순위표는 그대로 둔다)
    const topRow = p.rank <= STANDING_HIGHLIGHT ? ' class="top-rank-row"' : '';
    return `<tr${topRow}>
      <td class="rank-cell ${medalClass(p.rank)}">${p.rank}</td>
      <td>${esc(p.handle)}</td>
      <td class="clan-tag">${esc(p.clan)}</td>
      <td>${p.point}</td>
      <td class="win-txt">${p.wins}</td>
      <td class="loss-txt">${p.losses}</td>
      <td>${ratio(p)}%</td>
      <td>${streakCell}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="log-empty">검색 결과 없음</td></tr>';

  document.querySelectorAll('#standingTable th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
  });
}

function renderTop5() {
  const list = viewPlayers();
  const byPoint = [...list].sort((a, b) => b.point - a.point).slice(0, TOP_N);
  const byWin = [...list].sort((a, b) => b.wins - a.wins).slice(0, TOP_N);

  document.getElementById('topPointBody').innerHTML = byPoint.map((p, i) => `
    <tr><td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td><td>${esc(p.handle)}</td>
    <td class="clan-tag">${esc(p.clan)}</td><td>${p.point}</td>
    <td class="win-txt">${p.wins}</td><td class="loss-txt">${p.losses}</td></tr>`).join('');

  document.getElementById('topWinBody').innerHTML = byWin.map((p, i) => `
    <tr><td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td><td>${esc(p.handle)}</td>
    <td class="clan-tag">${esc(p.clan)}</td>
    <td class="win-txt">${p.wins}</td><td class="loss-txt">${p.losses}</td><td>${ratio(p)}%</td></tr>`).join('');

  // 승률은 경기를 치른 선수만 대상으로 한다. 0전 0승이 100%로 잡히거나
  // 0%로 목록을 채우는 것을 막기 위해서다.
  // 승률이 같으면 승수가 많은 쪽을 위로 둔다. 1승 0패와 9승 0패는 같은 100%지만
  // 무게가 다르기 때문이다.
  const byRatio = list
    .filter(p => p.wins + p.losses > 0)
    .sort((a, b) => ratio(b) - ratio(a) || b.wins - a.wins || a.handle.localeCompare(b.handle))
    .slice(0, TOP_N);

  const ratioBody = document.getElementById('topRatioBody');
  if (ratioBody) {
    ratioBody.innerHTML = byRatio.map((p, i) => `
      <tr><td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td><td>${esc(p.handle)}</td>
      <td class="clan-tag">${esc(p.clan)}</td>
      <td>${ratio(p)}%</td>
      <td class="win-txt">${p.wins}</td><td class="loss-txt">${p.losses}</td>
      <td>${p.wins + p.losses}</td></tr>`).join('')
      || '<tr><td colspan="7" class="log-empty">아직 경기 기록이 없습니다.</td></tr>';
  }
}

/** 클랜별 합산 순위. 소속 선수들의 포인트·승·패를 더한다. */
function clanStandings() {
  const map = new Map();
  for (const p of viewPlayers()) {
    const clan = (p.clan || '').trim();
    // '-' 는 클랜이 아니라 무소속 표시라 순위에서 뺀다
    if (!clan || clan === '-') continue;
    if (!map.has(clan)) map.set(clan, { clan, members: 0, point: 0, wins: 0, losses: 0 });
    const c = map.get(clan);
    c.members++;
    c.point += p.point;
    c.wins += p.wins;
    c.losses += p.losses;
  }

  const list = [...map.values()].sort((a, b) =>
    b.point - a.point || b.wins - a.wins || a.losses - b.losses || a.clan.localeCompare(b.clan));

  // 전적이 같으면 같은 등수를 준다. 5위에 동률이 걸리면 그 클랜들을 모두 보여준다.
  list.forEach((c, i) => {
    const prev = list[i - 1];
    const same = prev && prev.point === c.point && prev.wins === c.wins && prev.losses === c.losses;
    c.rank = same ? prev.rank : i + 1;
    if (same) { prev.tied = true; c.tied = true; }
  });
  return list.filter(c => c.rank <= CLAN_TOP);
}

function renderClanTop() {
  const tbody = document.getElementById('clanBody');
  const note = document.getElementById('clanNote');
  if (!tbody || !note) return;

  const list = clanStandings();
  tbody.innerHTML = list.map(c => {
    const total = c.wins + c.losses;
    const rate = total ? Math.round((c.wins / total) * 1000) / 10 : 0;
    return `<tr>
      <td class="rank-cell ${medalClass(c.rank)}">${c.rank}${c.tied ? '<span class="tie-tag">동률</span>' : ''}</td>
      <td class="clan-tag" style="font-size:15px;">${esc(c.clan)}</td>
      <td>${c.members}명</td>
      <td>${c.point}</td>
      <td class="win-txt">${c.wins}</td>
      <td class="loss-txt">${c.losses}</td>
      <td>${rate}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="log-empty">클랜에 소속된 선수가 없습니다.</td></tr>';

  const tied = list.some(c => c.tied);
  note.innerHTML = '소속 선수들의 포인트·승·패를 합산했습니다 · 포인트 합계가 높은 순 · 클랜이 없는 선수(<b>-</b>)는 제외'
    + (tied ? ' · <b style="color:var(--amber);">전적이 같은 클랜은 같은 등수로 함께 표시됩니다.</b>' : '');
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

  const rows = viewMatches();
  if (!rows.length) {
    tbody.innerHTML = '';
    wrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  wrap.style.display = '';
  empty.style.display = 'none';

  const all = [...rows].reverse();
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

function renderMemberList() {
  const box = document.getElementById('memberList');
  const count = document.getElementById('memberCount');
  const search = document.getElementById('memberSearch');
  if (!box || !count) return;

  const q = search ? search.value.trim().toLowerCase() : '';
  const list = q
    ? players.filter(p => p.handle.toLowerCase().includes(q) || (p.clan || '').toLowerCase().includes(q))
    : players;

  box.innerHTML = list.map(p => `
    <div class="member-row">
      <div>
        <div class="member-id">${esc(p.handle)} <span class="clan-tag">${esc(p.clan)}</span></div>
        <div class="member-meta">${p.point}점 · ${p.wins}승 ${p.losses}패</div>
      </div>
      <span class="member-actions">
        <button class="btn-mini btn-edit" data-medit="${esc(p.handle)}">수정</button>
        <button class="btn-mini btn-reject" data-member="${esc(p.handle)}">삭제</button>
      </span>
    </div>`).join('')
    || `<div class="log-empty">${q ? '검색 결과 없음' : '등록된 회원이 없습니다.'}</div>`;

  count.textContent = q
    ? `${players.length}명 중 ${list.length}명 표시`
    : `등록된 회원 ${players.length}명`;
}

function showMemberEditModal(handle) {
  const p = players.find(x => x.handle === handle);
  if (!p) return;
  openModal(`
    <h3>회원 정보 수정</h3>
    <label>ID</label>
    <input type="text" id="meId" maxlength="40" value="${esc(p.handle)}">
    <label>CLAN</label>
    <input type="text" id="meClan" maxlength="20" value="${esc(p.clan)}">
    <div class="foot-note" style="margin-top:8px;">
      ID를 바꾸면 지난 경기 기록에 남은 이름도 함께 바뀝니다 · 점수와 전적은 그대로입니다.
    </div>
    <div class="modal-error" id="meErr"></div>
    <button class="btn" id="meSubmit">저장</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>
  `);
  const err = document.getElementById('meErr');
  document.getElementById('meSubmit').addEventListener('click', async () => {
    const newHandle = document.getElementById('meId').value.trim();
    const clan = document.getElementById('meClan').value.trim();
    if (!newHandle) { err.textContent = 'ID를 입력해주세요.'; return; }
    try {
      const d = await apiPost('/api/player', { action: 'update', handle, newHandle, clan });
      closeModal();
      await refreshAll();
      showToast(d.matchesUpdated
        ? `수정했습니다. 경기 기록 ${d.matchesUpdated}건의 이름도 함께 바꿨습니다.`
        : '수정했습니다.');
    } catch (e) { err.textContent = e.message; }
  });
}

async function removeMember(handle) {
  if (!confirm(`'${handle}' 회원을 명단에서 삭제할까요?\n\n랭킹에서 즉시 사라집니다. 지난 경기 기록은 HISTORY에 그대로 남습니다.`)) return;
  try {
    await apiPost('/api/player', { action: 'remove', handle });
    await refreshAll();
    showToast(`${handle} 회원을 삭제했습니다.`);
  } catch (e) { showToast(e.message); }
}

function renderAll() {
  renderStanding();
  renderTop5();
  renderClanTop();
  renderChecklists();
  renderLog();
  renderHistory();
  renderPending();
  renderAdminList();
  renderMemberList();
  renderTournament();
  renderBoard();
  renderAttendance();
  renderMonthPickers();
  renderSeasons();
}

/* ---------- 접속 예상 시간 ---------- */

/** handle -> Set(시간대) */
function scheduleMap() {
  const map = new Map();
  for (const r of playSchedule) {
    if (!map.has(r.handle)) map.set(r.handle, new Set());
    map.get(r.handle).add(r.slot);
  }
  return map;
}

/** 시간대별로 누가 오는지 */
function renderSlotSummary() {
  const el = document.getElementById('slotSummary');
  if (!el) return;
  if (!playSlots.length) { el.innerHTML = ''; return; }

  // 명단에 있는 회원만 센다. 탈퇴한 아이디가 남아 보이지 않게.
  const roster = new Set(players.map(p => p.handle));
  const bySlot = new Map(playSlots.map(s => [s, []]));
  for (const r of playSchedule) {
    if (roster.has(r.handle) && bySlot.has(r.slot)) bySlot.get(r.slot).push(r.handle);
  }

  el.innerHTML = playSlots.map(slot => {
    const names = bySlot.get(slot).sort((a, b) => a.localeCompare(b));
    return `<div class="slot-col${names.length ? ' busy' : ''}">
      <div class="slot-col-h">
        <span class="slot-col-t">${slot}시대</span>
        <span class="slot-col-n">${names.length}명</span>
      </div>
      <div class="slot-names">${names.length
        ? names.map(h => `<span class="slot-name">${esc(h)}</span>`).join('')
        : '<span class="slot-none">아직 없음</span>'}</div>
    </div>`;
  }).join('');
}

/** 회원별 시간대 체크 판 */
function renderSlotBoard() {
  const el = document.getElementById('slotBoard');
  if (!el) return;

  const search = document.getElementById('slotSearch');
  const query = search ? search.value.trim().toLowerCase() : '';
  const map = scheduleMap();

  const list = players.filter(p =>
    !query || p.handle.toLowerCase().includes(query) || (p.clan || '').toLowerCase().includes(query));

  el.innerHTML = list.map(p => {
    const on = map.get(p.handle) || new Set();
    return `<div class="slot-row">
      <span class="slot-row-id">${esc(p.handle)}</span>
      <span class="slot-chips">${playSlots.map(slot =>
        `<button type="button" class="slot-chip${on.has(slot) ? ' on' : ''}"
          data-slot="${slot}" data-handle="${esc(p.handle)}"
          aria-pressed="${on.has(slot)}">${slot}</button>`).join('')}</span>
    </div>`;
  }).join('') || '<div class="att-empty">해당하는 회원이 없습니다.</div>';
}

function renderSchedule() {
  renderSlotSummary();
  renderSlotBoard();
}

/** 칩 하나를 눌러 그 시간대를 켜고 끈다 */
async function toggleSlot(handle, slot) {
  const map = scheduleMap();
  const on = new Set(map.get(handle) || []);
  if (on.has(slot)) on.delete(slot); else on.add(slot);
  const next = [...on];

  // 먼저 화면에 반영하고, 실패하면 되돌린다
  const before = playSchedule;
  playSchedule = playSchedule.filter(r => r.handle !== handle)
    .concat(next.map(s => ({ handle, slot: s })));
  renderSchedule();

  try {
    await apiPost('/api/attendance', { action: 'schedule', handle, slots: next });
  } catch (e) {
    playSchedule = before;
    renderSchedule();
    showToast(e.message);
  }
}

function initScheduleEvents() {
  const search = document.getElementById('slotSearch');
  if (search) search.addEventListener('input', renderSlotBoard);

  const board = document.getElementById('slotBoard');
  if (board) board.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slot]');
    if (btn) toggleSlot(btn.dataset.handle, Number(btn.dataset.slot));
  });
}

/* ---------- 출퇴근 (ATTENDANCE) ---------- */

const ATT_TOP = 5;          // 출근·게임시간 표에 보여줄 인원

/** 밀리초를 '3시간 20분' 처럼 읽히게 */
function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function formatClock(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 아직 퇴근을 안 찍었으면 지금까지를 센다.
 * 지난 달을 보고 있을 때는 그 달이 끝난 시각에서 멈춘다.
 */
function logDuration(log) {
  const s = viewSeason();
  const end = log.clockOut != null ? log.clockOut
    : Math.min(Date.now(), s ? s.endsAt : Date.now());
  return Math.max(0, end - log.clockIn);
}

/** 사람별로 출근 횟수와 게임시간을 합산한다 */
function attendanceTotals() {
  const map = new Map();
  for (const log of attLogs) {
    if (!map.has(log.handle)) map.set(log.handle, { handle: log.handle, count: 0, ms: 0 });
    const t = map.get(log.handle);
    t.count++;
    t.ms += logDuration(log);
  }
  for (const t of map.values()) {
    const p = findPlayer(t.handle);
    t.clan = p ? p.clan : '-';
  }
  return [...map.values()];
}

function attendanceRows(bodyId, list, timeFirst) {
  const el = document.getElementById(bodyId);
  if (!el) return;
  el.innerHTML = list.map((t, i) => `<tr>
    <td class="rank-cell ${medalClass(i + 1)}">${i + 1}</td>
    <td>${esc(t.handle)}</td>
    <td class="clan-tag">${esc(t.clan)}</td>
    ${timeFirst
      ? `<td class="att-dur">${formatDuration(t.ms)}</td><td>${t.count}회</td>`
      : `<td>${t.count}회</td><td class="att-dur">${formatDuration(t.ms)}</td>`}
  </tr>`).join('') || '<tr><td colspan="5" class="log-empty">기록 없음</td></tr>';
}

/** 출근/퇴근 버튼 판 — STANDING 에 있는 회원 전원 */
function renderAttendanceBoard() {
  const el = document.getElementById('attBoard');
  if (!el) return;

  const live = isLiveView();
  const search = document.getElementById('attSearch');
  const query = search ? search.value.trim().toLowerCase() : '';

  const open = new Map();
  for (const log of attLogs) if (log.clockOut == null) open.set(log.handle, log);

  const list = players.filter(p =>
    !query || p.handle.toLowerCase().includes(query) || (p.clan || '').toLowerCase().includes(query));

  el.innerHTML = list.map(p => {
    const on = open.get(p.handle);
    return `<div class="att-card${on ? ' on' : ''}">
      <div class="att-who">
        <div class="att-id">${esc(p.handle)}</div>
        <div class="att-state">${on
          ? `${formatClock(on.clockIn)} 출근 · ${formatDuration(Date.now() - on.clockIn)}째`
          : '퇴근 상태'}</div>
      </div>
      <button type="button" class="att-btn ${on ? 'out' : 'in'}"
        data-att="${on ? 'out' : 'in'}" data-handle="${esc(p.handle)}"
        ${live ? '' : 'disabled'}>${on ? '퇴근' : '출근'}</button>
    </div>`;
  }).join('') || '<div class="att-empty">해당하는 회원이 없습니다.</div>';
}

function renderAttendance() {
  renderSchedule();
  renderAttendanceBoard();

  // 기록 목록 (최근 것이 위로)
  const tbody = document.querySelector('#attLogTable tbody');
  const empty = document.getElementById('attLogEmpty');
  const wrap = document.getElementById('attLogWrap');
  if (tbody && empty && wrap) {
    const rows = [...attLogs].reverse();
    wrap.style.display = rows.length ? '' : 'none';
    empty.style.display = rows.length ? 'none' : 'block';
    tbody.innerHTML = rows.map((log, i) => `<tr>
      <td class="h-no-cell h-inline" data-l="기록">#${rows.length - i}</td>
      <td class="h-inline" data-l="ID">${esc(log.handle)}</td>
      <td class="h-inline" data-l="출근">${formatClock(log.clockIn)}</td>
      <td class="h-inline" data-l="퇴근">${log.clockOut != null
        ? formatClock(log.clockOut) : '<span class="att-live">게임 중</span>'}</td>
      <td class="h-inline att-dur" data-l="시간">${formatDuration(logDuration(log))}</td>
      <td class="h-by-cell">${currentAdmin
        ? `<button class="btn-mini btn-reject" data-attdel="${log.id}">삭제</button>` : ''}</td>
    </tr>`).join('');
  }

  // 아래 두 표. 두 표 모두 동점이면 출근 횟수가 많은 쪽을 위로 둔다.
  const totals = attendanceTotals();
  attendanceRows('attCountBody', [...totals]
    .sort((a, b) => b.count - a.count || b.ms - a.ms || a.handle.localeCompare(b.handle))
    .slice(0, ATT_TOP), false);
  attendanceRows('attTimeBody', [...totals]
    .sort((a, b) => b.ms - a.ms || b.count - a.count || a.handle.localeCompare(b.handle))
    .slice(0, ATT_TOP), true);

  const note = document.getElementById('attNote');
  if (note) {
    note.innerHTML = '동점이면 <b>출근 횟수</b>가 많은 회원이 위로 갑니다 · '
      + '퇴근을 누르지 않은 기록은 지금까지의 시간으로 계산하고, 달이 바뀌면 그 달 마지막 시각에서 멈춥니다.';
  }
}

async function punchAttendance(action, handle) {
  try {
    await apiPost('/api/attendance', { action, handle });
    await loadAttendance();
    renderAttendance();
    showToast(`${handle} · ${action === 'in' ? '출근' : '퇴근'} 기록했습니다.`);
  } catch (e) { showToast(e.message); }
}

async function deleteAttendance(id) {
  if (!confirm('이 출퇴근 기록을 지울까요?')) return;
  try {
    await apiPost('/api/attendance', { action: 'remove', id: Number(id) });
    await loadAttendance();
    renderAttendance();
    showToast('기록을 삭제했습니다.');
  } catch (e) { showToast(e.message); }
}

function initAttendanceEvents() {
  const search = document.getElementById('attSearch');
  if (search) search.addEventListener('input', renderAttendanceBoard);

  const panel = document.getElementById('tab-attendance');
  if (!panel) return;
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-att], [data-attdel]');
    if (!btn) return;
    if (btn.dataset.attdel) return deleteAttendance(btn.dataset.attdel);
    punchAttendance(btn.dataset.att, btn.dataset.handle);
  });

  // 게임 중인 사람의 경과 시간을 1분마다 갱신한다
  setInterval(() => {
    if (panel.classList.contains('active') && attLogs.some(l => l.clockOut == null)) {
      renderAttendanceBoard();
    }
  }, 60000);
}

/* ---------- 월 선택(달력) ---------- */

/**
 * 고를 수 있는 달 목록. 첫 시즌은 8월 27일에 시작하지만 9월에 끝나므로
 * "2026년 9월" 하나로만 보여준다. (8월 기록은 9월에 합산되어 있다)
 */
function monthOptions() {
  const list = seasons.length
    ? [...seasons]
    : (season ? [season] : []);
  list.sort((a, b) => b.startsAt - a.startsAt);
  return list.map(s => {
    const d = new Date(s.endsAt - 1 + 9 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const live = season && s.id === season.id;
    return { id: s.id, text: `${y}년 ${m}월` + (live ? ' (진행 중)' : '') };
  });
}

function renderMonthPickers() {
  const opts = monthOptions();
  const selected = viewSeasonId || (season ? season.id : (opts[0] ? opts[0].id : ''));
  const html = opts.map(o =>
    `<option value="${esc(o.id)}"${o.id === selected ? ' selected' : ''}>${esc(o.text)}</option>`
  ).join('');

  document.querySelectorAll('.month-select').forEach(sel => {
    sel.innerHTML = html || '<option value="">기록 없음</option>';
    sel.value = selected;
    sel.disabled = opts.length <= 1;
  });

  const cur = viewSeason();
  const badge = isLiveView() ? '' : (cur ? `지난 기록 · ${esc(cur.label)}` : '지난 기록');
  document.querySelectorAll('.month-past').forEach(el => { el.innerHTML = badge; });
}

/** 달을 바꾸면 1~4페이지가 모두 그 달 기준으로 다시 그려진다 */
async function selectMonth(id) {
  if (!id || id === viewSeasonId) return;
  viewSeasonId = id;
  if (!isLiveView()) {
    try { await loadSeasonDetail(id); }
    catch (e) { showToast(e.message); viewSeasonId = null; }
  }
  await loadAttendance(id);
  renderMonthPickers();
  renderStanding();
  renderTop5();
  renderClanTop();
  renderHistory();
  renderAttendance();
  renderSeasons();
}

function initMonthPickers() {
  document.querySelectorAll('.month-select').forEach(sel => {
    sel.addEventListener('change', () => selectMonth(sel.value));
  });
}

/* ---------- 월간 결산 (MONTHLY) ---------- */

/** epoch ms 를 한국 시각 기준 'YYYY-MM-DD' 로 */
function formatKstDate(ts) {
  const d = new Date(ts + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 시즌이 끝나는 시각은 다음 시즌의 시작이므로, 표기는 하루 앞당긴다 */
function seasonRange(s) {
  return `${formatKstDate(s.startsAt)} ~ ${formatKstDate(s.endsAt - 1)}`;
}

function seasonRatio(r) {
  const total = r.wins + r.losses;
  return total === 0 ? 0 : Math.round((r.wins / total) * 1000) / 10;
}

function seasonTable(rows) {
  if (!rows.length) return '<div class="season-empty">경기 기록이 없습니다.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Rank</th><th>ID</th><th>Clan</th><th>Win</th><th>Loss</th><th>Ratio</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr><td class="rank-cell ${medalClass(r.rank)}">${r.rank}</td>
      <td>${esc(r.handle)}</td><td class="clan-tag">${esc(r.clan)}</td>
      <td class="win-txt">${r.wins}</td><td class="loss-txt">${r.losses}</td>
      <td>${seasonRatio(r)}%</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderSeasons() {
  const nowEl = document.getElementById('seasonNow');
  const listEl = document.getElementById('seasonList');
  if (!nowEl || !listEl) return;

  const s = viewSeason();
  if (!s) { nowEl.innerHTML = ''; listEl.innerHTML = '<div class="season-empty">기록이 없습니다.</div>'; return; }

  const live = isLiveView();
  const games = viewMatches().length;
  const left = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 86400000));

  nowEl.innerHTML = `<div class="season-now">
    <div><span class="season-now-k">${live ? '진행 중' : '마감'}</span>
         <span class="season-now-v em">${esc(s.label)}</span></div>
    <div><span class="season-now-k">기간</span><span class="season-now-v">${seasonRange(s)}</span></div>
    ${live
      ? `<div><span class="season-now-k">남은 기간</span><span class="season-now-v">${left}일</span></div>`
      : ''}
    <div><span class="season-now-k">경기</span><span class="season-now-v">${games}건</span></div>
  </div>`;

  // 요약의 등수는 STANDING 과 반드시 같아야 한다.
  // 마감된 달은 저장해 둔 등수를 그대로 쓰고, 진행 중인 달만 여기서 매긴다.
  const played = viewPlayers().filter(p => p.wins + p.losses > 0);
  const ranked = (live
    ? [...played]
        .sort((a, b) => b.point - a.point || b.wins - a.wins
          || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
        .map((p, i) => ({ ...p, rank: i + 1 }))
    : played)
    .slice(0, seasonTop);

  listEl.innerHTML = `<div class="season-card">
    <div class="season-head">
      <span class="season-title">${esc(s.label)} 요약</span>
      <span class="season-range">상위 ${seasonTop}위</span>
      <span class="season-count">${live ? '진행 중 · 실시간' : '마감된 기록'}</span>
    </div>
    ${seasonTable(ranked)}
  </div>`;
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

/** 예선 전체 대진(팀 조합)과 각 경기의 기록 여부 */
function groupFixtures() {
  const list = [];
  for (let i = 0; i < TOURNAMENT_TEAMS.length; i++) {
    for (let j = i + 1; j < TOURNAMENT_TEAMS.length; j++) {
      const a = TOURNAMENT_TEAMS[i].id;
      const b = TOURNAMENT_TEAMS[j].id;
      const match = tMatches.find(m => m.stage === 'group'
        && ((m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a)));
      list.push({ a, b, match: match || null });
    }
  }
  return list;
}

function renderGroupFixtures() {
  const box = document.getElementById('groupFixtures');
  const note = document.getElementById('fixtureNote');
  if (!box || !note) return;

  const list = groupFixtures();
  const done = list.filter(f => f.match).length;

  note.textContent = currentAdmin
    ? `${list.length}경기 중 ${done}경기 완료 · 이긴 팀을 누르면 바로 기록되고 위 순위표에 반영됩니다.`
    : `${list.length}경기 중 ${done}경기 완료 · 결과 등록은 관리자만 할 수 있습니다.`;

  box.innerHTML = list.map(f => {
    if (f.match) {
      const loser = f.match.winner === f.match.teamA ? f.match.teamB : f.match.teamA;
      return `<div class="fx done">
        <span class="fx-pair">
          <b class="win-txt">${esc(teamLabel(f.match.winner))}</b>
          <span class="fx-vs">승</span>
          <span class="loss-txt">${esc(teamLabel(loser))}</span>
        </span>
        ${currentAdmin ? `<button class="btn-mini btn-reject" data-tdel="${f.match.id}">삭제</button>` : ''}
      </div>`;
    }
    return `<div class="fx">
      <span class="fx-pair">${esc(teamLabel(f.a))}<span class="fx-vs">vs</span>${esc(teamLabel(f.b))}</span>
      ${currentAdmin
        ? `<span class="fx-actions">
             <button class="btn-mini btn-approve" data-fx="${f.a}:${f.b}:${f.a}">${esc(teamLabel(f.a))} 승</button>
             <button class="btn-mini btn-approve" data-fx="${f.a}:${f.b}:${f.b}">${esc(teamLabel(f.b))} 승</button>
           </span>`
        : '<span class="fx-todo">미진행</span>'}
    </div>`;
  }).join('');
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
  renderGroupFixtures();
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

/** 예선 대진에서 이긴 팀 버튼을 눌러 바로 기록 */
async function recordFixture(a, b, winner) {
  try {
    await apiPost('/api/tournament', { action: 'record', stage: 'group', teamA: a, teamB: b, winner });
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

  const fx = document.getElementById('groupFixtures');
  if (fx) fx.addEventListener('click', e => {
    const d = e.target.dataset || {};
    if (d.tdel) return deleteTournamentMatch(d.tdel);
    if (d.fx) {
      const [a, b, winner] = d.fx.split(':');
      recordFixture(a, b, winner);
    }
  });
}

/* ---------- 게시판 ---------- */

function renderBoard() {
  const list = document.getElementById('postList');
  const count = document.getElementById('postCount');
  const bar = document.getElementById('postAdminBar');
  if (!list || !count || !bar) return;

  bar.style.display = currentAdmin && posts.length ? 'flex' : 'none';
  const checkAll = document.getElementById('postCheckAll');
  if (checkAll) checkAll.checked = false;

  count.textContent = posts.length ? `총 ${posts.length}개의 글` : '';

  if (!posts.length) {
    list.innerHTML = '<div class="log-empty">아직 등록된 글이 없습니다. 첫 의견을 남겨주세요.</div>';
    return;
  }

  list.innerHTML = posts.map(p => `
    <div class="post" data-post="${p.id}">
      <div class="post-head">
        ${currentAdmin ? `<input type="checkbox" class="post-pick" value="${p.id}">` : ''}
        <span class="post-author">${esc(p.author)}</span>
        <span class="post-date">${formatDateTime(p.createdAt)}</span>
        ${p.updatedAt ? '<span class="post-edited">수정됨</span>' : ''}
        <span class="post-actions">
          <button class="btn-mini btn-edit" data-edit="${p.id}">수정</button>
          <button class="btn-mini btn-reject" data-del="${p.id}">삭제</button>
        </span>
      </div>
      <div class="post-body">${esc(p.body)}</div>
      ${renderComments(p)}
    </div>`).join('');
}

function renderComments(post) {
  const list = post.comments || [];
  const open = openCommentForm === post.id;

  const items = list.map(c => `
    <div class="cmt">
      <div class="cmt-head">
        <span class="cmt-author">${esc(c.author)}</span>
        <span class="cmt-date">${formatDateTime(c.createdAt)}</span>
        <span class="cmt-actions">
          <button class="btn-mini btn-reject" data-cdel="${c.id}">삭제</button>
        </span>
      </div>
      <div class="cmt-body">${esc(c.body)}</div>
    </div>`).join('');

  const form = open ? `
    <div class="cmt-form">
      <input type="text" data-cauthor="${post.id}" maxlength="20" placeholder="ID">
      <input type="password" data-cpw="${post.id}" maxlength="4" inputmode="numeric" placeholder="비밀번호 4자리">
      <textarea class="cmt-text" data-cbody="${post.id}" maxlength="300" rows="2" placeholder="댓글을 입력하세요."></textarea>
      <button class="btn-mini btn-approve" data-csubmit="${post.id}">댓글 등록</button>
    </div>` : '';

  return `<div class="cmt-wrap">
    ${items}
    <button class="cmt-toggle" data-ctoggle="${post.id}">${open ? '✕ 댓글 쓰기 닫기' : `💬 댓글 ${list.length}${list.length ? '개' : ' 쓰기'}`}</button>
    ${form}
  </div>`;
}

async function createComment(postId) {
  const author = document.querySelector(`[data-cauthor="${postId}"]`).value.trim();
  const password = document.querySelector(`[data-cpw="${postId}"]`).value;
  const body = document.querySelector(`[data-cbody="${postId}"]`).value.trim();

  if (!author) return showToast('ID를 입력해주세요.');
  if (!/^\d{4}$/.test(password)) return showToast('비밀번호는 숫자 4자리로 입력해주세요.');
  if (!body) return showToast('댓글 내용을 입력해주세요.');

  try {
    await apiPost('/api/post', { action: 'comment', postId: Number(postId), author, password, body });
    openCommentForm = null;
    await loadPosts();
    renderBoard();
    showToast('댓글을 등록했습니다.');
  } catch (e) { showToast(e.message); }
}

/** 댓글 삭제: 관리자는 비밀번호 없이, 그 외에는 비밀번호를 확인한다 */
function deleteComment(id) {
  if (currentAdmin) {
    if (!confirm('이 댓글을 삭제할까요?')) return;
    return submitCommentDelete(id, null).catch(e => showToast(e.message));
  }
  openModal(`
    <h3>댓글 삭제</h3>
    <label>비밀번호 (숫자 4자리)</label>
    <input type="password" id="cdelPw" maxlength="4" inputmode="numeric" placeholder="0000">
    <div class="modal-error" id="cdelErr"></div>
    <button class="btn" id="cdelSubmit">삭제하기</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>
  `);
  const err = document.getElementById('cdelErr');
  document.getElementById('cdelSubmit').addEventListener('click', async () => {
    const password = document.getElementById('cdelPw').value;
    if (!/^\d{4}$/.test(password)) { err.textContent = '비밀번호는 숫자 4자리입니다.'; return; }
    try {
      await submitCommentDelete(id, password);
      closeModal();
    } catch (e) { err.textContent = e.message; }
  });
}

async function submitCommentDelete(id, password) {
  const payload = { action: 'removeComment', id: Number(id) };
  if (password !== null) payload.password = password;
  await apiPost('/api/post', payload);
  await loadPosts();
  renderBoard();
  showToast('댓글을 삭제했습니다.');
}

async function createPost() {
  const author = document.getElementById('postAuthor').value.trim();
  const password = document.getElementById('postPw').value;
  const body = document.getElementById('postBody').value.trim();

  if (!author) return showToast('ID를 입력해주세요.');
  if (!/^\d{4}$/.test(password)) return showToast('비밀번호는 숫자 4자리로 입력해주세요.');
  if (!body) return showToast('내용을 입력해주세요.');

  try {
    await apiPost('/api/post', { action: 'create', author, password, body });
    document.getElementById('postPw').value = '';
    document.getElementById('postBody').value = '';
    await loadPosts();
    renderBoard();
    showToast('글을 등록했습니다.');
  } catch (e) { showToast(e.message); }
}

/** 수정: 글쓴이만 가능하므로 관리자도 비밀번호를 입력해야 한다 */
function showEditModal(id) {
  const post = posts.find(p => p.id === Number(id));
  if (!post) return;
  openModal(`
    <h3>글 수정</h3>
    <label>내용</label>
    <textarea id="editBody" maxlength="1000" rows="5">${esc(post.body)}</textarea>
    <label>비밀번호 (숫자 4자리)</label>
    <input type="password" id="editPw" maxlength="4" inputmode="numeric" placeholder="0000">
    <div class="modal-error" id="editErr"></div>
    <button class="btn" id="editSubmit">수정하기</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>
  `);
  const err = document.getElementById('editErr');
  document.getElementById('editSubmit').addEventListener('click', async () => {
    const body = document.getElementById('editBody').value.trim();
    const password = document.getElementById('editPw').value;
    if (!body) { err.textContent = '내용을 입력해주세요.'; return; }
    if (!/^\d{4}$/.test(password)) { err.textContent = '비밀번호는 숫자 4자리입니다.'; return; }
    try {
      await apiPost('/api/post', { action: 'update', id: Number(id), password, body });
      closeModal();
      await loadPosts();
      renderBoard();
      showToast('글을 수정했습니다.');
    } catch (e) { err.textContent = e.message; }
  });
}

/** 삭제: 관리자는 비밀번호 없이, 그 외에는 비밀번호를 확인한다 */
function deletePost(id) {
  if (currentAdmin) {
    if (!confirm('이 글을 삭제할까요?')) return;
    return submitDelete(id, null);
  }
  openModal(`
    <h3>글 삭제</h3>
    <label>비밀번호 (숫자 4자리)</label>
    <input type="password" id="delPw" maxlength="4" inputmode="numeric" placeholder="0000">
    <div class="modal-error" id="delErr"></div>
    <button class="btn" id="delSubmit">삭제하기</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>
  `);
  const err = document.getElementById('delErr');
  document.getElementById('delSubmit').addEventListener('click', async () => {
    const password = document.getElementById('delPw').value;
    if (!/^\d{4}$/.test(password)) { err.textContent = '비밀번호는 숫자 4자리입니다.'; return; }
    try {
      await submitDelete(id, password);
      closeModal();
    } catch (e) { err.textContent = e.message; }
  });
}

async function submitDelete(id, password) {
  const payload = { action: 'remove', id: Number(id) };
  if (password !== null) payload.password = password;
  await apiPost('/api/post', payload);
  await loadPosts();
  renderBoard();
  showToast('글을 삭제했습니다.');
}

async function deleteSelectedPosts() {
  const ids = Array.from(document.querySelectorAll('.post-pick:checked')).map(el => Number(el.value));
  if (!ids.length) return showToast('삭제할 글을 선택해주세요.');
  if (!confirm(`선택한 ${ids.length}개의 글을 삭제할까요?`)) return;
  try {
    const d = await apiPost('/api/post', { action: 'removeMany', ids });
    await loadPosts();
    renderBoard();
    showToast(`${d.deleted}개의 글을 삭제했습니다.`);
  } catch (e) { showToast(e.message); }
}

async function deleteAllPosts() {
  if (!posts.length) return showToast('삭제할 글이 없습니다.');
  if (!confirm(`게시판의 글 ${posts.length}개를 모두 삭제할까요?\n\n되돌릴 수 없습니다.`)) return;
  try {
    const d = await apiPost('/api/post', { action: 'clear' });
    await loadPosts();
    renderBoard();
    showToast(`${d.deleted}개의 글을 모두 삭제했습니다.`);
  } catch (e) { showToast(e.message); }
}

function initBoardEvents() {
  const submit = document.getElementById('postSubmit');
  if (submit) submit.addEventListener('click', createPost);

  const list = document.getElementById('postList');
  if (list) list.addEventListener('click', e => {
    const d = e.target.dataset || {};
    if (d.edit) showEditModal(d.edit);
    if (d.del) deletePost(d.del);
    if (d.ctoggle) {
      openCommentForm = openCommentForm === Number(d.ctoggle) ? null : Number(d.ctoggle);
      renderBoard();
    }
    if (d.csubmit) createComment(d.csubmit);
    if (d.cdel) deleteComment(d.cdel);
  });

  const checkAll = document.getElementById('postCheckAll');
  if (checkAll) checkAll.addEventListener('change', () => {
    document.querySelectorAll('.post-pick').forEach(el => { el.checked = checkAll.checked; });
  });

  const sel = document.getElementById('postDeleteSelected');
  if (sel) sel.addEventListener('click', deleteSelectedPosts);
  const all = document.getElementById('postDeleteAll');
  if (all) all.addEventListener('click', deleteAllPosts);
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
    <label>관리자 ID</label><input type="text" id="adminLoginId" autocomplete="username">
    <label>비밀번호</label><input type="password" id="adminLoginPw" autocomplete="current-password">
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

function activateTab(name) {
  const panel = document.getElementById('tab-' + name);
  if (!panel) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');

  if (name === 'standing') {
    // 브라우저가 검색창을 자동으로 채워두면 목록이 비어 보인다.
    // STANDING 으로 올 때는 항상 전체 목록부터 보여준다.
    const search = document.getElementById('searchInput');
    if (search && search.value) { search.value = ''; }
    renderStanding();
  }
  if (name === 'history') refreshAll();
  if (name === 'attendance') { loadAttendance().then(renderAttendance); }
  if (name === 'season') { loadSeasons().then(() => { renderMonthPickers(); renderSeasons(); }); }
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  const home = document.getElementById('homeLink');
  if (home) home.addEventListener('click', () => {
    activateTab('standing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/**
 * 화면 밝기(화이트/다크) 전환.
 * 기본값은 화이트이고, 사용자가 고른 값만 브라우저에 남겨 다음 방문에도 유지한다.
 * 첫 페인트 전에 적용하는 코드는 index.html <head> 안에 따로 들어있다.
 */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('r6-theme', next); } catch { /* 사생활 보호 모드 등 */ }
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
  const memberSearch = document.getElementById('memberSearch');
  if (memberSearch) memberSearch.addEventListener('input', renderMemberList);

  const memberList = document.getElementById('memberList');
  if (memberList) memberList.addEventListener('click', e => {
    const d = e.target.dataset || {};
    if (d.member) removeMember(d.member);
    if (d.medit) showMemberEditModal(d.medit);
  });

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
  await loadSeasons();
  await loadAttendance();
  await loadTournament();
  await loadPosts();
  await loadAdmins();
  renderAll();
}

function showFatal(msg) {
  const el = document.getElementById('connBanner');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function boot() {
  initTheme();
  initTabs();
  initStandingEvents();
  initAdminEvents();
  initTournamentEvents();
  initBoardEvents();
  initAttendanceEvents();
  initScheduleEvents();
  initMonthPickers();
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
