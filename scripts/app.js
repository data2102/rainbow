/* ================= LADDER ZONE · r6rank.co.kr =================
   데이터는 서버(Postgres)에 저장됩니다. 이 스크립트는 API만 호출합니다.
   ============================================================== */

let players = [];
let matches = [];
let requests = [];
let me = null;              // 로그인한 계정 { handle, role }
let accounts = [];          // 계정 권한 목록 (관리자 이상)
let acctLogs = [];          // 계정 로그
let tMatches = [];          // 대회 경기 기록
let posts = [];             // 게시판 글
let season = null;          // 진행 중인 시즌
let seasons = [];           // 시즌 목록(진행 중 + 마감)
let viewSeasonId = null;    // 화면에서 보고 있는 달. null 이면 진행 중인 달
const seasonCache = {};     // 지난 달 상세 (id -> {players, matches})
let playSlots = [];         // 고를 수 있는 시간대
let playSchedule = [];      // [{handle, slot}] 오늘의 접속 예상 시간
let playToday = null;       // 그 예정이 어느 날짜 것인지
let openCommentForm = null; // 댓글 입력창이 열린 글 id
let rooms = [];             // 런쳐 방 8개
let myRoom = null;          // 내가 들어가 있는 방 번호
let roomMsgs = [];          // 그 방의 대화
let savedAddress = null;    // 내가 지난번에 적어둔 Radmin 주소
let connMode = 'radmin';    // 서로를 찾는 방법: 'radmin'(기본) | 'auto'(공인 IP)
let publicIp = null;        // 사이트가 읽은 내 공인 IP
let publicIpUsable = false; // 그 주소로 밖에서 찾아올 수 있는가 (CGNAT 이면 false)
let leavingOnPurpose = false;  // 내가 눌러서 나가는 중인가 (강퇴와 구분하려고)
let vpn = { network: '', password: null };  // Radmin 네트워크 안내 (비밀번호는 로그인해야 온다)

/* 대회 참가 팀. api/tournament.js 의 TEAMS 와 id 가 일치해야 합니다. */
const TOURNAMENT_TEAMS = [
  { id: 'A', label: 'A팀', members: ['레나', '네오', '블루베리', '렌보짱'] },
  { id: 'B', label: 'B팀', members: ['현정', '구짭', '범상', '짱가'] },
  { id: 'C', label: 'C팀', members: ['멘탈', '메가', '소소', '보리'] },
  { id: 'D', label: 'D팀', members: ['진원', '람보', '플라스', '수까락'] },
  { id: 'E', label: 'E팀', members: ['벨리', '까를', '티얼', '조커'] },
];
const MERCENARIES = ['럭키', '호신', '실장'];
const ADVANCING = 4;        // 예선 통과 팀 수
const CLAN_TOP = 5;         // 클랜 순위에 보여줄 등수
const TOP_N = 5;            // 개인 순위 표에 보여줄 인원
const STANDING_HIGHLIGHT = 5; // STANDING 표에서 색을 달리 줄 상위 등수

function teamLabel(id) {
  const t = TOURNAMENT_TEAMS.find(t => t.id === id);
  return t ? t.label : id;
}

let authToken = null;

/* ---------- 로그인 표를 어디에 둘까 ----------

   회원들이 들를 때마다 아이디와 비밀번호를 다시 치는 것이 힘들다고 해서,
   로그인하면 받는 표(token)를 브라우저에 적어둔다. 다음에 들어오면 그 표로
   바로 들어가진다.

   "로그인 상태 유지"를 켜면 브라우저를 닫아도 남는 곳에, 끄면 그 탭에서만
   사는 곳에 둔다. 어느 쪽이든 새로고침으로 로그인이 풀리지는 않는다.

   비밀번호는 어디에도 적어두지 않는다. 표만 있으면 다시 칠 일이 없고,
   비밀번호를 적어두면 이 컴퓨터를 쓰는 다른 사람이 그대로 가져가 어디서든
   로그인할 수 있게 된다. 표는 이 사이트에서만 쓰이고 지우면 그만이다.
   비밀번호를 브라우저에 맡기고 싶으면 브라우저가 물어볼 때 저장하면 된다. */

const TOKEN_KEY = 'r6-token';
const ID_KEY = 'r6-id';
const KEEP_KEY = 'r6-keep';

/** 사생활 보호 모드나 저장이 막힌 브라우저에서도 조용히 넘어간다 */
function store(kind) {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; }
  catch { return null; }
}
function readKey(key) {
  try {
    return (store('local') && store('local').getItem(key))
        || (store('session') && store('session').getItem(key)) || null;
  } catch { return null; }
}
function writeKey(key, value, remember) {
  try {
    const target = remember ? store('local') : store('session');
    const other = remember ? store('session') : store('local');
    if (other) other.removeItem(key);
    if (target) target.setItem(key, value);
  } catch { /* 저장이 막혀 있어도 그냥 쓴다 */ }
}
function dropKey(key) {
  try {
    if (store('local')) store('local').removeItem(key);
    if (store('session')) store('session').removeItem(key);
  } catch { /* noop */ }
}

/** 아이디는 늘 기억한다. 다음에 로그인 창을 열면 채워져 있다. */
function savedId() { return readKey(ID_KEY) || ''; }
/** "로그인 상태 유지"를 지난번에 켰었는가. 처음 오는 사람은 켠 것으로 본다. */
function keepPref() { return readKey(KEEP_KEY) !== '0'; }

function saveLogin(token, handle, remember) {
  writeKey(TOKEN_KEY, token, remember);
  writeKey(ID_KEY, handle, true);
  writeKey(KEEP_KEY, remember ? '1' : '0', true);
}
function clearLogin() { dropKey(TOKEN_KEY); }

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
    if (r.status === 401) {
      // 표가 만료됐거나 지워졌다. 들고 있어봐야 계속 튕기므로 버린다.
      authToken = null; me = null; clearLogin(); renderAuthBar();
    }
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

/** 오늘의 접속 예정을 받아온다 */
async function loadAttendance() {
  try {
    const d = await apiGet('/api/attendance');
    if (d.slots) playSlots = d.slots;
    playSchedule = d.schedule || [];
    playToday = d.day || null;
  } catch { playSchedule = []; playToday = null; }
}

/** 런쳐 방 현황. 이 요청 자체가 "아직 있다"는 신호가 된다. */
/**
 * 사이트까지 오가는 데 걸린 시간(ms).
 *
 * 게임 안에서 서로에게 가는 핑이 아니라 각자 회선이 이 사이트까지 얼마나
 * 빨리 닿는지다. 브라우저는 다른 사람과 직접 주고받을 수 없어서 게임 핑을
 * 잴 방법이 없다. 그래도 회선이 뻗는 사람은 여기서도 느리게 나오므로,
 * 누가 힘들어하는지 눈치채는 데는 쓸 만하다.
 */
let myRtt = null;
const PING_EVERY_MS = 10000;
let pingedAt = 0;

/**
 * 아무 일도 하지 않는 자리까지의 왕복을 잰다.
 *
 * 방 목록 요청으로 재던 것을 따로 뗐다. 그 요청은 서버에서 데이터베이스를
 * 여러 번 다녀오므로 그 시간이 값의 대부분을 차지했고, 결국 사람마다 다른
 * 회선이 아니라 "지금 사이트가 얼마나 느린가"를 재고 있었다. 그래서 회선이
 * 멀쩡한 PC 들이 한꺼번에 빨간불이 됐다.
 */
async function measurePing() {
  if (Date.now() - pingedAt < PING_EVERY_MS) return;
  pingedAt = Date.now();
  try {
    const t0 = performance.now();
    await fetch('/api/ping', { cache: 'no-store' });
    myRtt = Math.round(performance.now() - t0);
  } catch { /* 못 쟀으면 지난 값을 그대로 둔다 */ }
}

/**
 * 서버가 보낸 런쳐 화면을 그대로 받아 적는다.
 *
 * 목록을 읽었을 때든 방에 막 들어갔을 때든 오는 내용이 같아서, 들어가기
 * 응답에 실려온 것도 이 길로 흘려보낸다 — 들어가고 나서 다시 물어볼 일이 없다.
 */
function applyRooms(d) {
  const before = myRoom;
  rooms = d.rooms || [];
  myRoom = d.myRoom || null;
  roomMsgs = d.messages || [];
  savedAddress = d.savedAddress || null;
  connMode = d.connMode || 'radmin';
  publicIp = d.publicIp || null;
  publicIpUsable = !!d.publicIpUsable;
  vpn = { network: d.network || '', password: d.networkPw || null };
  waiting = d.waiting || [];
  lobbyMsgs = d.lobbyMessages || [];
  capacityMin = d.capacityMin || capacityMin;
  maxTitle = d.maxTitle || maxTitle;

  // 내가 누르지 않았는데 방에서 빠졌다면 알려준다
  if (before && !myRoom && !leavingOnPurpose) {
    showToast('방에서 나가게 되었습니다 · 강퇴되었거나 연결이 오래 끊겼습니다.');
  }
}

async function loadRooms() {
  try {
    applyRooms(await apiGet('/api/room' + (myRtt == null ? '' : `?rtt=${myRtt}`)));
  } catch {
    rooms = []; myRoom = null; roomMsgs = []; waiting = []; lobbyMsgs = [];
  }
  measurePing();   // 다음 요청에 실어 보낼 값을 미리 재둔다
}

async function loadPosts() {
  try {
    const d = await apiGet('/api/post');
    posts = d.posts || [];
  } catch { posts = []; }
}

/** 계정 권한 목록과 로그. 관리자 이상만 받아온다. */
async function loadAccounts() {
  if (!isAdmin()) { accounts = []; acctLogs = []; return; }
  try {
    const d = await apiPost('/api/account', { action: 'list' });
    accounts = d.accounts || [];
  } catch { accounts = []; }
  try {
    const d = await apiPost('/api/account', { action: 'logs' });
    acctLogs = d.logs || [];
  } catch { acctLogs = []; }
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
  // 점수 순이 아니라 아이디 순(ABC)으로 늘어놓는다. 체크할 사람을 눈으로 찾기 쉽도록.
  const byId = [...players].sort((a, b) =>
    a.handle.localeCompare(b.handle, 'en', { sensitivity: 'base' }));
  winList.innerHTML = byId.map(p => rowHtml(p, 'win')).join('');
  loseList.innerHTML = byId.map(p => rowHtml(p, 'lose')).join('');

  document.querySelectorAll('#winList input, #loseList input').forEach(el => {
    el.addEventListener('change', renderChecklists);
  });

  const nWin = getChecked('winList').length;
  const nLose = getChecked('loseList').length;
  showPickCount(nWin, nLose);

  const submit = document.getElementById('submitMatch');
  if (submit) submit.disabled = !(nWin > 0 && nLose > 0);
}

/**
 * 몇 명 체크했는지 보여준다.
 *
 * 8:8 을 넣을 때 체크박스를 눈으로 세는 일이 없도록, 팀 이름 옆에 인원을 적고
 * 확정 버튼 위에 대진을 크게 띄운다. 인원이 안 맞아도 막지는 않는다 —
 * 7:8 같은 경기도 기록해야 하기 때문이다. 다르다는 사실만 알려준다.
 */
function showPickCount(nWin, nLose) {
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n + '명';
    el.classList.toggle('on', n > 0);
  };
  set('winCount', nWin);
  set('loseCount', nLose);

  const sum = document.getElementById('pickSum');
  if (sum) {
    sum.innerHTML = `<span class="pw">${nWin}</span><span class="px">:</span><span class="pl">${nLose}</span>`;
    sum.classList.toggle('zero', nWin === 0 && nLose === 0);
  }

  const note = document.getElementById('pickNote');
  if (!note) return;
  let msg = '';
  if (nWin === 0 && nLose === 0) msg = '';
  else if (nWin === 0) msg = '승리 팀을 체크해주세요.';
  else if (nLose === 0) msg = '패배 팀을 체크해주세요.';
  else if (nWin !== nLose) msg = '양 팀 인원이 다릅니다 · 7:8 같은 경기도 그대로 기록할 수 있습니다.';
  note.textContent = msg;
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

    // 번호는 취소된 기록까지 세어 붙인다. 취소했다고 뒤 번호가 밀리면
    // "#12 경기"라고 주고받은 말이 어긋난다.
    const no = all.length - i;
    const voided = !!m.voidedAt;
    const canManage = isAdmin() && isLiveView() && m.id != null;

    const cancelBtn = (canManage && !voided)
      ? `<div><button class="btn-mini btn-void" data-void="${m.id}" data-do="void">기록 취소</button></div>`
      : '';

    const main = `<tr class="${voided ? 'h-void' : ''}">
      <td class="h-no-cell h-inline" data-l="기록">#${no}</td>
      <td class="h-inline" data-l="일시"><div class="h-date">${date}</div><div class="h-time">${time}</div></td>
      <td class="h-size-cell h-inline" data-l="규모">${winners.length} : ${losers.length}</td>
      <td data-l="승리 · WIN">${winChips}</td>
      <td data-l="패배 · LOSE">${loseChips}</td>
      <td class="h-by-cell" data-l="등록자">${esc(m.recordedBy || '-')}${cancelBtn}</td>
    </tr>`;

    if (!voided) return main;

    const restoreBtn = canManage
      ? `<button class="btn-mini" data-void="${m.id}" data-do="restore">되돌리기</button>`
      : '';
    return main + `<tr class="h-why">
      <td colspan="6">
        <div class="void-line">
          <span class="void-tag">취소됨</span>
          <span class="void-why">${esc(m.voidReason || '사유 없음')}</span>
          <span class="void-meta">${esc(m.voidedBy || '-')} · ${formatDateTime(m.voidedAt)}</span>
          ${restoreBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  renderVoidLog(all);
}

/** 취소된 기록만 따로 모아 보여준다. 없으면 판 자체를 감춘다. */
function renderVoidLog(all) {
  const panel = document.getElementById('voidLogPanel');
  const tbody = document.querySelector('#voidLogTable tbody');
  if (!panel || !tbody) return;

  const rows = all
    .map((m, i) => ({ m, no: all.length - i }))
    .filter(x => x.m.voidedAt)
    .sort((a, b) => b.m.voidedAt - a.m.voidedAt);

  panel.style.display = rows.length ? '' : 'none';
  if (!rows.length) { tbody.innerHTML = ''; return; }

  tbody.innerHTML = rows.map(({ m, no }) => {
    const w = (m.winners || []).map(x => x.handle).join(', ') || '-';
    const l = (m.losers || []).join(', ') || '-';
    return `<tr>
      <td class="h-inline" data-l="취소일시">${formatDateTime(m.voidedAt)}</td>
      <td class="h-no-cell h-inline" data-l="기록">#${no}</td>
      <td data-l="경기"><span class="h-chip w">${esc(w)}</span><span class="h-chip l">${esc(l)}</span></td>
      <td data-l="사유">${esc(m.voidReason || '-')}</td>
      <td class="h-by-cell" data-l="처리자">${esc(m.voidedBy || '-')}</td>
    </tr>`;
  }).join('');
}

/* ---------- 기록 취소 ---------- */

/**
 * 취소는 지우는 것이 아니라 "없던 일로 세는 것"이다.
 * 기록은 취소선을 달고 그대로 남고, 점수만 그 경기가 없었던 것처럼 다시 계산된다.
 */
function showVoidModal(id) {
  const m = viewMatches().find(x => x.id === id);
  if (!m) { showToast('기록을 찾지 못했습니다.'); return; }
  const w = (m.winners || []).map(x => x.handle).join(', ');
  const l = (m.losers || []).join(', ');

  openModal(`
    <h3>이 기록을 취소할까요?</h3>
    <div class="foot-note" style="margin-top:0;">
      ${esc(formatDateTime(m.ts))} · 등록자 ${esc(m.recordedBy || '-')}<br>
      <b>승리</b> ${esc(w || '-')}<br>
      <b>패배</b> ${esc(l || '-')}
    </div>
    <div class="foot-note">이 경기가 없었던 것으로 보고 <b>전 회원의 점수를 다시 계산</b>합니다 ·
      기록은 지우지 않고 취소선으로 남습니다.</div>
    <label>취소 사유 (필수)</label>
    <input type="text" id="vdReason" maxlength="200" placeholder="예) 같은 경기를 두 번 등록">
    <div class="modal-error" id="vdErr"></div>
    <button class="btn" id="vdSubmit">취소 처리</button>`);

  const go = () => doVoid(id);
  document.getElementById('vdSubmit').addEventListener('click', go);
  const input = document.getElementById('vdReason');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  input.focus();
}

async function doVoid(id) {
  const err = document.getElementById('vdErr');
  const btn = document.getElementById('vdSubmit');
  const reason = document.getElementById('vdReason').value;
  err.textContent = '';
  if (!reason.trim()) { err.textContent = '취소 사유를 적어주세요.'; return; }
  btn.disabled = true;
  try {
    await apiPost('/api/match', { action: 'void', id, reason });
    closeModal();
    await refreshAll();
    showToast('기록을 취소했습니다. 점수를 다시 계산했습니다.');
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function doRestore(id, btn) {
  if (!confirm('취소를 되돌릴까요? 이 경기를 다시 점수에 넣습니다.')) return;
  btn.disabled = true;
  try {
    await apiPost('/api/match', { action: 'restore', id });
    await refreshAll();
    showToast('취소를 되돌렸습니다.');
  } catch (e) {
    showToast(e.message);
    btn.disabled = false;
  }
}

/** 전체 기록 표의 취소 · 되돌리기 버튼 */
function initHistoryEvents() {
  const wrap = document.getElementById('historyTableWrap');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-void]');
    if (!btn) return;
    const id = Number(btn.dataset.void);
    if (btn.dataset.do === 'restore') doRestore(id, btn);
    else showVoidModal(id);
  });
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
    btn.addEventListener('click', () => handleRequestAction(btn));
  });
}

/**
 * 가입·삭제 요청을 승인하거나 거절한다.
 * 처리가 끝날 때까지 그 줄의 두 버튼을 함께 잠근다. 두 번 눌러도 한 번만 간다.
 */
async function handleRequestAction(btn) {
  const row = btn.closest('.req-row') || btn.parentElement;
  const buttons = row ? [...row.querySelectorAll('button')] : [btn];
  buttons.forEach(b => { b.disabled = true; });

  const { id, action } = btn.dataset;
  try {
    await apiPost('/api/request', { action, id });
    await refreshAll();
    showToast(action === 'approve' ? '요청을 승인했습니다.' : '요청을 거절했습니다.');
  } catch (e) {
    showToast(e.message);
    buttons.forEach(b => { b.disabled = false; });
  }
}

function renderAll() {
  renderStanding();
  renderTop5();
  renderClanTop();
  renderChecklists();
  renderHistory();
  renderPending();
  renderAccounts();
  renderAcctLogs();
  renderTournament();
  renderBoard();
  renderAttendance();
  renderLauncher();
  renderMonthPickers();
}

/* ---------- 접속 예상 시간 ---------- */

const SCHEDULE_RESET_HOUR = 7;   // api/attendance.js 의 RESET_HOUR 와 같아야 한다

/**
 * 지금이 속한 "하루". 한국 시각 07:00 에 넘어간다.
 * 서버와 계산이 같아야 하므로 보는 사람의 시간대와 무관하게 KST 로 센다.
 */
function playDay(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600000 - SCHEDULE_RESET_HOUR * 3600000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** handle -> Set(시간대) */
function scheduleMap() {
  const map = new Map();
  for (const r of playSchedule) {
    if (!map.has(r.handle)) map.set(r.handle, new Set());
    map.get(r.handle).add(r.slot);
  }
  return map;
}

/**
 * 시간대 대신 고르는 두 가지. api/attendance.js 의 값과 같아야 한다.
 * 시간대와 겹치지 않는 숫자를 자리로 쓴다.
 */
const SLOT_UNSURE = 0;
const SLOT_ABSENT = -1;
function isSpecialSlot(s) { return s === SLOT_UNSURE || s === SLOT_ABSENT; }
function slotLabel(s) {
  if (s === SLOT_UNSURE) return '미정';
  if (s === SLOT_ABSENT) return '불참';
  return `${s}시대`;
}
function slotChipLabel(s) {
  if (s === SLOT_UNSURE) return '미정';
  if (s === SLOT_ABSENT) return '불참';
  return String(s);
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
    // 미정·불참은 시간대 두 칸을 합친 너비로 둔다. 시간대가 아니므로
    // 같은 크기로 나란히 두면 시간처럼 읽힌다.
    const wide = isSpecialSlot(slot) ? ' wide' : '';
    const kind = slot === SLOT_ABSENT ? ' absent' : (slot === SLOT_UNSURE ? ' unsure' : '');
    return `<div class="slot-col${names.length ? ' busy' : ''}${wide}${kind}">
      <div class="slot-col-h">
        <span class="slot-col-t">${slotLabel(slot)}</span>
        <span class="slot-col-n">${names.length}명</span>
      </div>
      <div class="slot-names">${names.length
        ? names.map(h => `<span class="slot-name">${esc(h)}</span>`).join('')
        : '<span class="slot-none">아직 없음</span>'}</div>
    </div>`;
  }).join('');
}

/** 로그인한 계정의 시간대를 체크하는 줄 */
function renderSlotMine() {
  const el = document.getElementById('slotMine');
  if (!el) return;

  if (!isLoggedIn()) {
    el.innerHTML = `<span class="mine-k">내 시간대</span>
      <span class="mine-right">
        <span class="mine-none">로그인하면 참여 가능한 시간대를 체크할 수 있습니다.</span>
        <button type="button" class="auth-btn" data-slot-login>로그인</button>
      </span>`;
    return;
  }
  const on = scheduleMap().get(me.handle) || new Set();
  el.innerHTML = `<span class="mine-k">내 시간대</span>
    <span class="mine-id">${esc(me.handle)}</span>
    <span class="mine-right"><span class="slot-chips">${playSlots.map(slot =>
      `<button type="button" class="slot-chip${on.has(slot) ? ' on' : ''}${isSpecialSlot(slot) ? ' wide' : ''}"
        data-slot="${slot}" aria-pressed="${on.has(slot)}">${slotChipLabel(slot)}</button>`).join('')}</span></span>`;
}

function renderSchedule() {
  const el = document.getElementById('slotDay');
  if (el) {
    const d = playToday || playDay();
    const today = playDay();
    el.innerHTML = d === today
      ? `${esc(d)} 기준`
      : `${esc(d)} 기준 <b>· 날짜가 바뀌었습니다. 새로고침하세요.</b>`;
  }
  renderSlotSummary();
  renderSlotMine();
}

/** 칩 하나를 눌러 내 그 시간대를 켜고 끈다 (대상은 언제나 로그인한 계정) */
async function toggleSlot(slot) {
  if (!isLoggedIn()) return;
  const handle = me.handle;
  const on = new Set(scheduleMap().get(handle) || []);

  // 미정·불참은 혼자 선다. 시간대를 고르면 그 둘은 풀리고,
  // 그 둘을 고르면 시간대가 모두 풀린다 — "불참인데 8시"는 뜻이 없다.
  let next;
  if (isSpecialSlot(slot)) {
    next = on.has(slot) ? [] : [slot];
  } else {
    const hours = new Set([...on].filter(s => !isSpecialSlot(s)));
    if (hours.has(slot)) hours.delete(slot); else hours.add(slot);
    next = [...hours];
  }

  // 먼저 화면에 반영하고, 실패하면 되돌린다
  const before = playSchedule;
  playSchedule = playSchedule.filter(r => r.handle !== handle)
    .concat(next.map(s => ({ handle, slot: s })));
  renderSchedule();

  try {
    // 누구의 시간대인지는 서버가 세션을 보고 정한다
    await apiPost('/api/attendance', { action: 'schedule', slots: next });
  } catch (e) {
    playSchedule = before;
    renderSchedule();
    showToast(e.message);
  }
}

function initScheduleEvents() {
  const el = document.getElementById('slotMine');
  if (el) el.addEventListener('click', (e) => {
    if (e.target.closest('[data-slot-login]')) { showLoginModal(); return; }
    const btn = e.target.closest('[data-slot]');
    if (btn) toggleSlot(Number(btn.dataset.slot));
  });

  // 07시를 넘겨 페이지를 켜둔 채로 두면 하루가 바뀐 것을 알아채고 다시 받아온다
  const panel = document.getElementById('tab-attendance');
  if (!panel) return;
  setInterval(async () => {
    if (!panel.classList.contains('active')) return;
    if (playToday && playToday !== playDay()) {
      await loadAttendance();
      renderAttendance();
    }
  }, 60000);
}

function renderAttendance() {
  renderSchedule();
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
  renderMonthPickers();
  renderStanding();
  renderTop5();
  renderClanTop();
  renderHistory();
}

function initMonthPickers() {
  document.querySelectorAll('.month-select').forEach(sel => {
    sel.addEventListener('change', () => selectMonth(sel.value));
  });
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

  note.textContent = isAdmin()
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
        ${isAdmin() ? `<button class="btn-mini btn-reject" data-tdel="${f.match.id}">삭제</button>` : ''}
      </div>`;
    }
    return `<div class="fx">
      <span class="fx-pair">${esc(teamLabel(f.a))}<span class="fx-vs">vs</span>${esc(teamLabel(f.b))}</span>
      ${isAdmin()
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

  form.style.display = isAdmin() ? 'block' : 'none';
  hint.style.display = isAdmin() ? 'none' : 'block';
  if (!isAdmin()) return;

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
        ${isAdmin() ? `<button class="btn-mini btn-reject" data-tdel="${m.id}">삭제</button>` : ''}
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

/** 내가 쓴 글·댓글인가. 아이디는 로그인과 마찬가지로 대소문자를 가리지 않는다. */
function isMine(row) {
  return !!me && String(row.author).toLowerCase() === me.handle.toLowerCase();
}


function renderBoard() {
  const list = document.getElementById('postList');
  const count = document.getElementById('postCount');
  const bar = document.getElementById('postAdminBar');
  if (!list || !count || !bar) return;

  bar.style.display = isAdmin() && posts.length ? 'flex' : 'none';
  const meBox = document.getElementById('postMe');
  if (meBox && me) meBox.textContent = me.handle;
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
        ${isAdmin() ? `<input type="checkbox" class="post-pick" value="${p.id}">` : ''}
        <span class="post-author">${esc(p.author)}</span>
        <span class="post-date">${formatDateTime(p.createdAt)}</span>
        ${p.updatedAt ? '<span class="post-edited">수정됨</span>' : ''}
        <span class="post-actions">
          ${isMine(p) ? `<button class="btn-mini btn-edit" data-edit="${p.id}">수정</button>` : ''}
          ${isMine(p) || isAdmin() ? `<button class="btn-mini btn-reject" data-del="${p.id}">삭제</button>` : ''}
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
          ${isMine(c) || isAdmin() ? `<button class="btn-mini btn-reject" data-cdel="${c.id}">삭제</button>` : ''}
        </span>
      </div>
      <div class="cmt-body">${esc(c.body)}</div>
    </div>`).join('');

  const form = open && me ? `
    <div class="cmt-form">
      <textarea class="cmt-text" data-cbody="${post.id}" maxlength="300" rows="2" placeholder="${esc(me.handle)} 님으로 댓글을 남깁니다."></textarea>
      <button class="btn-mini btn-approve" data-csubmit="${post.id}">댓글 등록</button>
    </div>` : '';

  return `<div class="cmt-wrap">
    ${items}
    <button class="cmt-toggle" data-ctoggle="${post.id}">${open ? '✕ 댓글 쓰기 닫기' : `💬 댓글 ${list.length}${list.length ? '개' : ' 쓰기'}`}</button>
    ${form}
  </div>`;
}

async function createComment(postId) {
  const body = document.querySelector(`[data-cbody="${postId}"]`).value.trim();
  if (!body) return showToast('댓글 내용을 입력해주세요.');

  try {
    await apiPost('/api/post', { action: 'comment', postId: Number(postId), body });
    openCommentForm = null;
    await loadPosts();
    renderBoard();
    showToast('댓글을 등록했습니다.');
  } catch (e) { showToast(e.message); }
}

/** 댓글 삭제: 내가 쓴 댓글과 관리자만. 서버도 같이 막는다. */
async function deleteComment(id) {
  if (!confirm('이 댓글을 삭제할까요?')) return;
  try {
    await apiPost('/api/post', { action: 'removeComment', id: Number(id) });
    await loadPosts();
    renderBoard();
    showToast('댓글을 삭제했습니다.');
  } catch (e) { showToast(e.message); }
}

async function createPost() {
  const body = document.getElementById('postBody').value.trim();
  if (!body) return showToast('내용을 입력해주세요.');

  try {
    await apiPost('/api/post', { action: 'create', body });
    document.getElementById('postBody').value = '';
    await loadPosts();
    renderBoard();
    showToast('글을 등록했습니다.');
  } catch (e) { showToast(e.message); }
}

/** 수정: 글쓴이만 할 수 있다. 관리자에게도 삭제 권한만 있다. */
function showEditModal(id) {
  const post = posts.find(p => p.id === Number(id));
  if (!post) return;
  openModal(`
    <h3>글 수정</h3>
    <label>내용</label>
    <textarea id="editBody" maxlength="1000" rows="5">${esc(post.body)}</textarea>
    <div class="modal-error" id="editErr"></div>
    <button class="btn" id="editSubmit">수정하기</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>
  `);
  const err = document.getElementById('editErr');
  document.getElementById('editSubmit').addEventListener('click', async () => {
    const body = document.getElementById('editBody').value.trim();
    if (!body) { err.textContent = '내용을 입력해주세요.'; return; }
    try {
      await apiPost('/api/post', { action: 'update', id: Number(id), body });
      closeModal();
      await loadPosts();
      renderBoard();
      showToast('글을 수정했습니다.');
    } catch (e) { err.textContent = e.message; }
  });
}

/** 삭제: 내가 쓴 글과 관리자만. 서버도 같이 막는다. */
async function deletePost(id) {
  if (!confirm('이 글을 삭제할까요?\n\n달린 댓글도 함께 사라집니다.')) return;
  try {
    await apiPost('/api/post', { action: 'remove', id: Number(id) });
    await loadPosts();
    renderBoard();
    showToast('글을 삭제했습니다.');
  } catch (e) { showToast(e.message); }
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
      if (!isLoggedIn()) { showLoginModal(); return; }
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

/* ---------- 권한 ---------- */

const ROLE_LABEL = { member: '일반', admin: '관리자', master: '마스터' };
const ROLE_RANK = { member: 1, admin: 2, master: 3 };

function isLoggedIn() { return !!me; }
function isAdmin()    { return !!me && ROLE_RANK[me.role] >= ROLE_RANK.admin; }
function isMaster()   { return !!me && me.role === 'master'; }

/* ---------- 인증 UI ---------- */

function renderAuthBar() {
  const bar = document.getElementById('authBar');
  bar.innerHTML = me
    ? `<span class="auth-user">${esc(ROLE_LABEL[me.role] || '일반')} · ${esc(me.handle)}</span>
       <button class="auth-btn" id="btnChangePw">비밀번호 변경</button>
       <button class="auth-btn" id="btnLogout">로그아웃</button>`
    : `<button class="auth-btn" id="btnSignup">회원가입</button>
       <button class="auth-btn" id="btnFindPw">비밀번호 찾기</button>
       <button class="auth-btn" id="btnLogin">로그인</button>`;

  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('btnChangePw', () => showChangePasswordModal());
  on('btnLogout', doLogout);
  on('btnSignup', showSignupModal);
  on('btnFindPw', showFindPwModal);
  on('btnLogin', showLoginModal);
  renderGates();
}

/** 권한에 따라 보이고 안 보이고를 한 곳에서 정한다 */
function renderGates() {
  const set = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  };
  // ③ 리폿 — 로그인하면 승패를 기록할 수 있다
  set('reportGate', !isLoggedIn());
  set('reportBox', isLoggedIn());
  // ⑥ 게시판 — 로그인해야 글을 쓴다
  set('postGate', !isLoggedIn());
  set('postForm', isLoggedIn());
  // 관리자 화면 — 관리자 이상만
  set('adminLocked', !isAdmin());
  set('adminAuthed', isAdmin());

  const rolePanel = document.getElementById('rolePanel');
  if (rolePanel) rolePanel.style.display = isAdmin() ? 'block' : 'none';
}

/* ---------- 로그인 · 회원가입 · 비밀번호 ---------- */

function showLoginModal() {
  const id = savedId();
  const keep = keepPref();
  // 진짜 <form> 으로 두어야 브라우저가 "비밀번호를 저장할까요?" 를 띄워준다.
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>로그인</h3>
    <form id="loginForm" autocomplete="on">
      <label>ID</label>
      <input type="text" id="loginId" name="username" autocomplete="username" value="${esc(id)}">
      <label>비밀번호</label>
      <input type="password" id="loginPw" name="password" autocomplete="current-password">
      <label class="check-line">
        <input type="checkbox" id="loginKeep" ${keep ? 'checked' : ''}>
        <span>로그인 상태 유지</span>
      </label>
      <div class="modal-error" id="loginErr"></div>
      <button class="btn" type="submit" id="loginSubmit">로그인</button>
    </form>
    <div class="foot-note">아이디는 대소문자를 가리지 않습니다 · 초기 비밀번호는 1234입니다.</div>
    <div class="foot-note">체크해두면 <b>30일 동안</b> 다시 치지 않아도 됩니다 ·
      여럿이 쓰는 컴퓨터라면 체크를 풀어주세요.</div>`);

  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin();
  });
  // 아이디가 이미 채워져 있으면 비밀번호 칸부터
  const first = document.getElementById(id ? 'loginPw' : 'loginId');
  if (first) first.focus();
}

async function doLogin() {
  const id = document.getElementById('loginId').value.trim();
  const password = document.getElementById('loginPw').value;
  const keepEl = document.getElementById('loginKeep');
  const remember = !keepEl || keepEl.checked;
  const err = document.getElementById('loginErr');
  err.textContent = '';
  try {
    const d = await apiPost('/api/account', { action: 'login', id, password, remember });
    authToken = d.token;
    me = d.account;
    // 아이디는 서버가 돌려준 정확한 표기로 적어둔다 (대소문자를 가리지 않으므로)
    saveLogin(d.token, d.account.handle, remember);
    closeModal();
    renderAuthBar();
    await refreshAll();
    showToast(`${me.handle} 님, 반갑습니다.`);
    runRequiredSetup();
  } catch (e) { err.textContent = e.message; }
}

/* ---------- 로그인 직후 반드시 거치는 절차 ---------- */

/**
 * 초기 비밀번호(1234)를 그대로 쓰고 있거나 이메일이 없으면 창을 띄운다.
 * 둘 다 비밀번호를 잊었을 때 본인을 확인할 방법이 없어지는 문제라,
 * 창을 닫거나 건너뛸 수 없게 한다. 비밀번호를 먼저 받고 이메일을 받는다.
 */
function runRequiredSetup() {
  if (!me) return;
  if (me.mustChangePw) { showForcedPwModal(); return; }
  if (me.mustSetEmail) { showForcedEmailModal(); return; }
}

function showForcedPwModal() {
  openModal(`
    <h3>비밀번호를 바꿔주세요</h3>
    <div class="foot-note" style="margin-top:0;">지금은 초기 비밀번호(1234)를 그대로 쓰고 있습니다 ·
      <b>다른 사람이 그대로 로그인할 수 있으니</b> 반드시 바꿔주세요.</div>
    <label>새 비밀번호 (4자 이상)</label>
    <input type="password" id="fcPw1" autocomplete="new-password">
    <label>새 비밀번호 확인</label>
    <input type="password" id="fcPw2" autocomplete="new-password">
    <div class="modal-error" id="fcErr"></div>
    <button class="btn" id="fcSubmit">변경하기</button>`, true);
  const go = () => doForcedPwChange();
  document.getElementById('fcSubmit').addEventListener('click', go);
  document.getElementById('fcPw2').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
}

async function doForcedPwChange() {
  const p1 = document.getElementById('fcPw1').value;
  const p2 = document.getElementById('fcPw2').value;
  const err = document.getElementById('fcErr');
  err.textContent = '';
  if (p1 !== p2) { err.textContent = '새 비밀번호가 서로 일치하지 않습니다.'; return; }
  try {
    await apiPost('/api/account', { action: 'changePw', password: p1 });
    me = { ...me, mustChangePw: false };
    showToast('비밀번호가 변경되었습니다.');
    if (me.mustSetEmail) { showForcedEmailModal(); return; }
    closeModal();
  } catch (e) { err.textContent = e.message; }
}

function showForcedEmailModal() {
  openModal(`
    <h3>이메일 주소를 등록해주세요</h3>
    <div class="foot-note" style="margin-top:0;">등록된 이메일 주소가 없습니다.</div>
    <label>이메일 주소</label>
    <input type="text" id="fmEmail" maxlength="120" autocomplete="email" placeholder="예: name@example.com">
    <div class="modal-error" id="fmErr"></div>
    <button class="btn" id="fmSubmit">등록하기</button>
    <div class="foot-note"><b>이메일 주소를 올바르게 입력하지 않으면 비밀번호를 잃어버렸을 때 찾기 어렵습니다.</b>
      비밀번호 찾기는 ID · CLAN · 이메일 주소 세 가지가 모두 맞아야 진행됩니다.</div>`, true);
  const go = () => doForcedEmail();
  document.getElementById('fmSubmit').addEventListener('click', go);
  document.getElementById('fmEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
}

async function doForcedEmail() {
  const email = document.getElementById('fmEmail').value.trim();
  const err = document.getElementById('fmErr');
  err.textContent = '';
  try {
    const d = await apiPost('/api/account', { action: 'setEmail', email });
    me = { ...me, email: d.email, mustSetEmail: false };
    closeModal();
    showToast('이메일 주소를 등록했습니다.');
    await refreshAll();
  } catch (e) { err.textContent = e.message; }
}

async function doLogout() {
  try { await apiPost('/api/account', { action: 'logout' }); } catch { /* noop */ }
  // 표만 버리고 아이디는 남겨둔다. 다음에 로그인 창을 열면 채워져 있다.
  clearLogin();
  authToken = null;
  me = null;
  accounts = [];
  acctLogs = [];
  myRoom = null;
  roomMsgs = [];
  renderAuthBar();
  renderAll();
  showToast('로그아웃되었습니다.');
}

function showSignupModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>회원가입</h3>
    <label>ID *</label><input type="text" id="suId" maxlength="40" autocomplete="username" placeholder="예: SNC_NewName">
    <label>CLAN *</label><input type="text" id="suClan" maxlength="20" autocomplete="off" placeholder="예: SNC">
    <label>이메일 주소 *</label><input type="text" id="suEmail" maxlength="120" autocomplete="email" placeholder="예: name@example.com">
    <div class="modal-error" id="suErr"></div>
    <button class="btn" id="suSubmit">가입 신청</button>
    <div class="foot-note">관리자가 승인하면 계정이 만들어집니다 · 초기 비밀번호는 1234입니다 ·
      이메일은 비밀번호를 잊었을 때 본인 확인에 씁니다.</div>`);
  document.getElementById('suSubmit').addEventListener('click', doSignup);
}

async function doSignup() {
  const id = document.getElementById('suId').value.trim();
  const clan = document.getElementById('suClan').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const err = document.getElementById('suErr');
  err.textContent = '';
  if (!id || !clan || !email) { err.textContent = '세 항목을 모두 입력해주세요.'; return; }
  try {
    await apiPost('/api/account', { action: 'signup', id, clan, email });
    closeModal();
    showToast('가입 신청을 보냈습니다. 관리자 승인을 기다려주세요.');
    await refreshAll();
  } catch (e) { err.textContent = e.message; }
}

/* 비밀번호 찾기는 두 단계다. 본인 확인이 끝나야 새 비밀번호를 정하는 창이 뜬다. */

function showFindPwModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>비밀번호 찾기</h3>
    <div class="foot-note" style="margin-top:0;">ID · CLAN · 이메일 주소가 모두 맞아야
      다음 단계로 넘어갑니다.</div>
    <label>ID</label><input type="text" id="fpId" maxlength="40" autocomplete="username">
    <label>CLAN</label><input type="text" id="fpClan" maxlength="20" autocomplete="off">
    <label>이메일 주소</label><input type="text" id="fpEmail" maxlength="120" autocomplete="email">
    <div class="modal-error" id="fpErr"></div>
    <button class="btn" id="fpSubmit">다음</button>
    <div class="foot-note">비밀번호를 찾지 못할 경우 관리자에게 문의하세요.</div>`);
  document.getElementById('fpSubmit').addEventListener('click', doCheckIdentity);
  document.getElementById('fpEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') doCheckIdentity();
  });
}

async function doCheckIdentity() {
  const id = document.getElementById('fpId').value.trim();
  const clan = document.getElementById('fpClan').value.trim();
  const email = document.getElementById('fpEmail').value.trim();
  const err = document.getElementById('fpErr');
  err.textContent = '';
  if (!id || !clan || !email) { err.textContent = '세 항목을 모두 입력해주세요.'; return; }
  try {
    const d = await apiPost('/api/account', { action: 'checkId', id, clan, email });
    showNewPwModal({ id, clan, email, handle: d.handle });
  } catch (e) { err.textContent = e.message; }
}

function showNewPwModal(who) {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>새 비밀번호 설정</h3>
    <div class="foot-note" style="margin-top:0;">본인 확인이 끝났습니다 ·
      <b>${esc(who.handle)}</b> 계정의 새 비밀번호를 정해주세요.</div>
    <label>새 비밀번호 (4자 이상)</label>
    <input type="password" id="npPw1" autocomplete="new-password">
    <label>새 비밀번호 확인</label>
    <input type="password" id="npPw2" autocomplete="new-password">
    <div class="modal-error" id="npErr"></div>
    <button class="btn" id="npSubmit">비밀번호 재설정</button>`);
  document.getElementById('npSubmit').addEventListener('click', () => doResetPw(who));
  document.getElementById('npPw2').addEventListener('keydown', e => {
    if (e.key === 'Enter') doResetPw(who);
  });
}

async function doResetPw(who) {
  const p1 = document.getElementById('npPw1').value;
  const p2 = document.getElementById('npPw2').value;
  const err = document.getElementById('npErr');
  err.textContent = '';
  if (p1 !== p2) { err.textContent = '새 비밀번호가 서로 일치하지 않습니다.'; return; }
  try {
    await apiPost('/api/account', {
      action: 'resetPw', id: who.id, clan: who.clan, email: who.email, password: p1,
    });
    closeModal();
    showToast('비밀번호를 바꿨습니다. 새 비밀번호로 로그인해주세요.');
  } catch (e) { err.textContent = e.message; }
}

function showChangePasswordModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>비밀번호 변경</h3>
    <label>새 비밀번호 (4자 이상)</label><input type="password" id="cpNew1" autocomplete="new-password">
    <label>새 비밀번호 확인</label><input type="password" id="cpNew2" autocomplete="new-password">
    <div class="modal-error" id="cpErr"></div>
    <button class="btn" id="cpSubmit">변경하기</button>`);
  document.getElementById('cpSubmit').addEventListener('click', doChangePassword);
}

async function doChangePassword() {
  const n1 = document.getElementById('cpNew1').value;
  const n2 = document.getElementById('cpNew2').value;
  const err = document.getElementById('cpErr');
  if (n1 !== n2) { err.textContent = '새 비밀번호가 서로 일치하지 않습니다.'; return; }
  try {
    await apiPost('/api/account', { action: 'changePw', password: n1 });
    closeModal();
    showToast('비밀번호가 변경되었습니다.');
  } catch (e) { err.textContent = e.message; }
}

/* ---------- 계정 권한 · 로그 ---------- */

/**
 * 권한 칸.
 * 관리자는 일반과 관리자 사이만 바꿀 수 있다. 마스터가 걸린 자리는
 * 주는 것도 거두는 것도 마스터의 몫이라, 관리자에게는 이름표만 보여준다.
 */
function roleCell(a) {
  const canPick = isMaster() || (isAdmin() && a.role !== 'master');
  if (!canPick) {
    return `<span class="role-tag ${esc(a.role)}">${esc(ROLE_LABEL[a.role] || '일반')}</span>`;
  }
  const options = isMaster() ? Object.keys(ROLE_LABEL) : ['member', 'admin'];
  return `<select class="role-select" data-role="${esc(a.handle)}">${
    options.map(r => `<option value="${r}"${r === a.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')
  }</select>`;
}

/** 자기 계정은 지울 수 없고, 마스터 계정은 마스터만 지울 수 있다 (서버도 같이 막는다) */
function canDelete(a) {
  if (me && me.handle === a.handle) return false;
  if (a.role === 'master' && !isMaster()) return false;
  return true;
}

/** 회원 정보(명단)와 계정 권한을 한 표에서 다룬다 */
function renderAccounts() {
  const tbody = document.querySelector('#roleTable tbody');
  const note = document.getElementById('roleNote');
  const count = document.getElementById('memberCount');
  if (!tbody || !note) return;

  note.innerHTML = '회원 정보를 추가·수정·삭제하고 권한을 정합니다 · 한 일은 아래 계정 로그에 남습니다'
    + (isMaster()
      ? ' · <b>마스터 권한을 주고 거두는 것은 마스터만 할 수 있습니다.</b>'
      : ' · 일반·관리자 권한은 바꿀 수 있고, <b>마스터 권한은 마스터만 주고 거둘 수 있습니다.</b>');

  const search = document.getElementById('roleSearch');
  const query = search ? search.value.trim().toLowerCase() : '';
  const list = accounts.filter(a =>
    !query || a.handle.toLowerCase().includes(query) || (a.clan || '').toLowerCase().includes(query));

  tbody.innerHTML = list.map(a => {
    // 전적은 진행 중인 달의 명단(players)에서 가져온다
    const p = findPlayer(a.handle);
    return `<tr>
    <td>${esc(a.handle)}</td>
    <td class="clan-tag">${esc(a.clan || '-')}</td>
    <td class="acct-email">${esc(a.email || '-')}</td>
    <td class="acct-record">${p ? `${p.point}점 · ${p.wins}승 ${p.losses}패` : '-'}</td>
    <td>${roleCell(a)}</td>
    <td><span class="acct-actions">
      <button class="btn-mini btn-edit" data-aedit="${esc(a.handle)}">수정</button>
      ${canDelete(a) ? `<button class="btn-mini btn-reject" data-adel="${esc(a.handle)}">삭제</button>` : ''}
    </span></td>
  </tr>`;
  }).join('') || `<tr><td colspan="6" class="log-empty">${query ? '검색 결과 없음' : '등록된 회원이 없습니다.'}</td></tr>`;

  if (count) {
    count.textContent = query
      ? `${accounts.length}명 중 ${list.length}명 표시`
      : `등록된 회원 ${accounts.length}명`;
  }
}

/* 계정 정보는 선수 명단과 같은 것이므로 /api/player 를 그대로 쓴다.
   여기서 한 일도 audit_log 에 남아 아래 '계정 로그'에 그대로 나온다. */

function showAcctAddModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>계정 추가</h3>
    <label>ID *</label>
    <input type="text" id="aaId" maxlength="40" autocomplete="off" placeholder="예: SNC_NewName">
    <label>CLAN</label>
    <input type="text" id="aaClan" maxlength="20" autocomplete="off" placeholder="비워두면 ID 앞부분을 씁니다">
    <label>이메일 주소</label>
    <input type="text" id="aaEmail" maxlength="120" autocomplete="off" placeholder="예: name@example.com">
    <div class="foot-note" style="margin-top:8px;">승인 절차 없이 바로 명단에 들어갑니다 ·
      초기 비밀번호는 1234이고, 본인이 처음 로그인할 때 바꾸게 됩니다.</div>
    <div class="modal-error" id="aaErr"></div>
    <button class="btn" id="aaSubmit">추가하기</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>`);
  const err = document.getElementById('aaErr');
  document.getElementById('aaSubmit').addEventListener('click', async () => {
    const handle = document.getElementById('aaId').value.trim();
    const clan = document.getElementById('aaClan').value.trim();
    const email = document.getElementById('aaEmail').value.trim();
    err.textContent = '';
    if (!handle) { err.textContent = 'ID를 입력해주세요.'; return; }
    try {
      await apiPost('/api/player', { action: 'create', handle, clan, email });
      closeModal();
      await refreshAll();
      showToast(`${handle} 계정을 추가했습니다.`);
    } catch (e) { err.textContent = e.message; }
  });
}

function showAcctEditModal(handle) {
  const a = accounts.find(x => x.handle === handle);
  if (!a) return;
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>계정 정보 수정</h3>
    <label>ID</label>
    <input type="text" id="aeId" maxlength="40" autocomplete="off" value="${esc(a.handle)}">
    <label>CLAN</label>
    <input type="text" id="aeClan" maxlength="20" autocomplete="off" value="${esc(a.clan || '')}">
    <label>이메일 주소</label>
    <input type="text" id="aeEmail" maxlength="120" autocomplete="off" value="${esc(a.email || '')}">
    <div class="foot-note" style="margin-top:8px;">ID를 바꾸면 경기 기록·출석 기록에 남은 이름도 함께 바뀝니다 ·
      점수와 전적은 그대로입니다 · 이메일을 비우면 지워집니다.</div>
    <div class="modal-error" id="aeErr"></div>
    <button class="btn" id="aeSubmit">저장</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal()">취소</button>`);
  const err = document.getElementById('aeErr');
  document.getElementById('aeSubmit').addEventListener('click', async () => {
    const newHandle = document.getElementById('aeId').value.trim();
    const clan = document.getElementById('aeClan').value.trim();
    const email = document.getElementById('aeEmail').value.trim();
    err.textContent = '';
    if (!newHandle) { err.textContent = 'ID를 입력해주세요.'; return; }
    try {
      const d = await apiPost('/api/player', { action: 'update', handle, newHandle, clan, email });
      closeModal();
      // 내 계정을 고쳤다면 화면이 들고 있는 내 정보도 따라가야 한다
      if (me && me.handle === handle) {
        me = { ...me, handle: newHandle, clan, email: email || null, mustSetEmail: !email };
        renderAuthBar();
      }
      await refreshAll();
      showToast(d.matchesUpdated
        ? `수정했습니다. 경기 기록 ${d.matchesUpdated}건의 이름도 함께 바꿨습니다.`
        : '수정했습니다.');
    } catch (e) { err.textContent = e.message; }
  });
}

async function removeAccount(handle) {
  if (!confirm(`'${handle}' 계정을 삭제할까요?\n\n로그인할 수 없게 되고 랭킹에서도 사라집니다. 지난 경기 기록은 그대로 남습니다.`)) return;
  try {
    await apiPost('/api/player', { action: 'remove', handle });
    await refreshAll();
    showToast(`${handle} 계정을 삭제했습니다.`);
  } catch (e) { showToast(e.message); }
}

const ACCT_ACTION_LABEL = {
  approve_add: '가입 승인',
  approve_remove: '삭제 승인',
  reject_request: '요청 거절',
  create_player: '계정 추가',
  update_player: '계정 수정',
  remove_player: '계정 삭제',
  set_role: '권한 변경',
  void_match: '기록 취소',
  restore_match: '취소 되돌림',
};

function renderAcctLogs() {
  const tbody = document.querySelector('#acctLogTable tbody');
  const empty = document.getElementById('acctLogEmpty');
  if (!tbody || !empty) return;

  empty.style.display = acctLogs.length ? 'none' : 'block';
  tbody.innerHTML = acctLogs.map(l => {
    const d = l.detail || {};
    let target = d.handle || d.to || d.target || '-';
    let extra = '';
    if (l.action === 'void_match' || l.action === 'restore_match') {
      // 표에 붙는 #번호가 아니라 경기 일시로 가리킨다. 번호는 보는 달에 따라
      // 달라지지만 일시는 어디서 봐도 같은 경기를 가리킨다.
      target = d.ts ? formatDateTime(Number(d.ts)) + ' 경기' : '경기 기록';
      const w = (d.winners || []).join(', ');
      const lo = (d.losers || []).join(', ');
      extra = ` (승 ${w || '-'} / 패 ${lo || '-'})` + (d.reason ? ` · ${d.reason}` : '');
    } else if (l.action === 'set_role' && d.from) {
      extra = ` (${ROLE_LABEL[d.from] || d.from} → ${ROLE_LABEL[d.to] || d.to})`;
    } else if (l.action === 'update_player') {
      const parts = [];
      if (d.from && d.to && d.from !== d.to) parts.push(`${d.from} → ${d.to}`);
      if (d.clan) parts.push(`CLAN ${d.clan}`);
      if ('email' in d) parts.push(`이메일 ${d.email || '삭제'}`);
      if (parts.length) extra = ` (${parts.join(' · ')})`;
    } else if (l.action === 'create_player' && d.clan) {
      extra = ` (${d.clan}${d.email ? ' · ' + d.email : ''})`;
    }
    return `<tr>
      <td class="h-inline" data-l="일시">${formatDateTime(l.ts)}</td>
      <td class="h-inline" data-l="내용">${esc(ACCT_ACTION_LABEL[l.action] || l.action)}</td>
      <td class="h-inline" data-l="대상">${esc(target)}${esc(extra)}</td>
      <td class="h-by-cell" data-l="처리자">${esc(l.by || '-')}</td>
    </tr>`;
  }).join('');
}

async function setRole(handle, role) {
  try {
    await apiPost('/api/account', { action: 'setRole', handle, role });
    await loadAccounts();
    renderAccounts();
    renderAcctLogs();
    // 내 권한을 스스로 내렸다면 화면도 따라가야 한다
    if (me && me.handle === handle) { me = { ...me, role }; renderAuthBar(); }
    showToast(`${handle} → ${ROLE_LABEL[role]}`);
  } catch (e) {
    showToast(e.message);
    renderAccounts();
  }
}

function initAccountEvents() {
  const search = document.getElementById('roleSearch');
  if (search) search.addEventListener('input', renderAccounts);

  const table = document.getElementById('roleTable');
  if (table) {
    table.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-role]');
      if (sel) setRole(sel.dataset.role, sel.value);
    });
    table.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.aedit) showAcctEditModal(btn.dataset.aedit);
      if (btn.dataset.adel) removeAccount(btn.dataset.adel);
    });
  }

  const add = document.getElementById('acctAddBtn');
  if (add) add.addEventListener('click', showAcctAddModal);
}

/* ---------- 런쳐 ---------- */

/**
 * 게임 실행.
 * 웹 페이지는 남의 프로그램을 마음대로 켤 수 없다. 할 수 있는 것은 운영체제에
 * 등록된 주소로 넘겨주는 일뿐이다. r6clan:// 는 public/r6clan.reg 로 각자
 * 컴퓨터에 한 번 등록해두는 약속이고, 등록해두지 않았으면 아무 일도
 * 일어나지 않는다 — 그래서 주소 복사는 어느 쪽이든 늘 해준다.
 */
const GAME_PROTOCOL = 'r6clan://';
/** 방장이 이만큼 전에 켰으면 이미 자리를 잡았다고 본다 */
const HOST_SETTLED_MS = 15000;

/**
 * 접속 주소를 복사하고, 등록해둔 사람은 게임까지 띄운다.
 * 주소 뒤에 create/join 을 붙여 어디로 갈지 알려준다 — 자동 진입판을 깔아둔
 * 사람은 이것을 보고 CREATE GAME 이나 JOIN GAME 까지 알아서 들어간다.
 * 기본판은 이 꼬리표를 무시하고 게임만 켠다.
 */
async function launchGame(address, mode) {
  if (address) await copyText(address);

  // 참가자는 켜자마자 방장을 두드리므로, 방장 게임이 아직 뜨는 중이면
  // 헛걸음이 된다. 그래서 런쳐가 몇 초 기다렸다 켠다. 다만 방장이 켠 지
  // 한참 지난 뒤에 조인하기를 누른 사람은 기다릴 이유가 없다 —
  // 그때는 주소에 now 를 끼워 보내 그 기다림을 건너뛴다.
  const here = myRoomData();
  const settled = mode === 'join' && here && here.startedAt
    && (Date.now() - here.startedAt > HOST_SETTLED_MS);

  const url = mode === 'create'
    ? GAME_PROTOCOL + 'create'
    : GAME_PROTOCOL + 'join' + (settled ? '/now' : '') + (address ? '/' + address : '');
  // 부르기 전에 방에 먼저 남긴다. 프로토콜이 등록돼 있지 않으면 브라우저가
  // 아무 일도 하지 않고 조용히 끝나는데, 그때도 "누가 눌렀는지"는 남아야
  // 누구 컴퓨터가 문제인지 가릴 수 있다. 알림일 뿐이라 실패해도 넘어간다.
  try {
    await apiPost('/api/room', { action: 'report', event: mode, address });
  } catch { /* noop */ }

  window.location.href = url;
  startPlaying();

  showToast(mode === 'create'
    ? '게임을 켭니다 · 로비에서 사람들을 기다려주세요.'
    : (address
      ? `게임을 켭니다 · ${address} 로 붙습니다 (주소는 복사해뒀습니다)`
      : '게임을 켭니다 · 방장 주소가 없어 자동으로 붙지 못할 수 있습니다.'));

}

/** 클립보드. 막혀 있으면 옛 방식으로 한 번 더 시도한다. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 권한이 없거나 오래된 브라우저 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

const ROOM_CAPACITY = 16;
let capacityMin = 2;
let maxTitle = 24;
let waiting = [];
let lobbyMsgs = [];

/** 이 방의 정원. 방장이 따로 정하지 않았으면 기본값. */
function capOf(r) { return r && r.cap ? r.cap : ROOM_CAPACITY; }

/* ---------- 출발 카운트다운 ---------- */

/** 3초를 세고 START. 방장이 누른 시각(startedAt)을 기준으로 삼는다. */
const CD_MS = 3000;
let cdTimer = null;
let cdLast = null;
let cdPlayedAt = 0;   // 이미 보여준 startedAt — 같은 출발을 두 번 세지 않는다

/**
 * 방장이 누른 시각에 맞춰 센다.
 * 늦게 알아챈 사람은 남은 숫자부터 보게 되지만, START 는 모두에게 같은 순간에 뜬다.
 * 화면을 누르면 건너뛴다.
 */
function playCountdown(startedAt, onGo) {
  const box = document.getElementById('countdown');
  const n = document.getElementById('countdownN');
  if (!box || !n) { if (onGo) onGo(); return; }

  cdPlayedAt = startedAt;
  clearInterval(cdTimer);
  cdLast = null;
  box.classList.add('show');

  const paint = (text, go) => {
    if (cdLast === text) return;
    cdLast = text;
    n.textContent = text;
    n.classList.toggle('go', go);
    // 같은 자리에서 애니메이션을 다시 태우려면 한 번 끊어줘야 한다
    n.style.animation = 'none';
    void n.offsetWidth;
    n.style.animation = '';
  };

  const finish = () => {
    clearInterval(cdTimer);
    cdTimer = null;
    box.classList.remove('show');
    if (onGo) onGo();
  };

  const tick = () => {
    const left = Math.ceil((startedAt + CD_MS - Date.now()) / 1000);
    if (left > 0) {
      paint(String(Math.min(left, CD_MS / 1000)), false);
    } else {
      paint('START', true);
      clearInterval(cdTimer);
      cdTimer = setTimeout(finish, 900);
    }
  };

  // 초가 바뀌는 순간을 놓치지 않도록 촘촘히 본다
  tick();
  cdTimer = setInterval(tick, 150);

  box.onclick = finish;
}

/** 방장이 이름을 붙이지 않았으면 "N번방". */
function roomName(r) { return r && r.title ? r.title : `${r ? r.room : ''}번방`; }

/**
 * 회선 상태를 다섯 칸으로. 빠를수록 많이 차고 색이 밝다.
 * 값이 없으면(방금 들어왔거나 소식이 끊겼으면) 빈 칸만 보여준다.
 */
/**
 * 회선 상태를 다섯 칸으로.
 *
 * 기준은 게임 핑이 아니라 웹 왕복에 맞춘다. 게임 핑이라면 80ms 도 느린 축이지만,
 * 이 값은 브라우저가 서버에 다녀오는 시간이라 좋은 회선이라도 100~300ms 는
 * 예사다. 게임 핑 기준을 그대로 쓰는 바람에 멀쩡한 PC 들이 다 빨간불이 됐다.
 */
function pingBars(ms) {
  let on = 0, tone = 'g';
  if (ms == null)     { on = 0; tone = ''; }
  else if (ms < 250)  { on = 5; tone = 'g'; }
  else if (ms < 500)  { on = 4; tone = 'g'; }
  else if (ms < 900)  { on = 3; tone = 'o'; }
  else if (ms < 1500) { on = 2; tone = 'o'; }
  else                { on = 1; tone = 'r'; }
  const bars = [1, 2, 3, 4, 5]
    .map(i => `<i class="${i <= on ? 'on' : ''}"></i>`).join('');
  const tip = ms == null
    ? '아직 재지 못했습니다'
    : `사이트까지 왕복 ${ms}ms · 게임 안에서 서로에게 가는 핑은 아닙니다`;
  return `<span class="ping ${tone}" title="${tip}">${bars}</span>`
    + `<span class="ping-ms">${ms == null ? '—' : ms + 'ms'}</span>`;
}

function myRoomData() {
  return myRoom ? rooms.find(r => r.room === myRoom) || null : null;
}

/**
 * 방을 따로 띄운 창.
 *
 * 방 안에서 이야기를 나누는 동안에도 순위를 보고 리폿을 쓸 수 있어야 해서,
 * 방은 같은 페이지를 ?room=N 으로 다시 열어 따로 둔다. 그 창에서는 방만
 * 보이고 나머지 메뉴는 접는다.
 *
 * 두 창이 같은 방을 동시에 그리면 카운트다운이 두 번 돌고 게임도 두 번
 * 켜진다. 그래서 방 창은 살아있다는 표시를 남기고, 바닥 창은 그 표시가
 * 싱싱하면 방 화면 대신 "다른 창에 있습니다" 안내만 내놓는다.
 */
const POPUP_KEY = 'r6-room-win';
const POPUP_FRESH_MS = 8000;
const roomParam = Number(new URLSearchParams(location.search).get('room')) || 0;
const isRoomWindow = roomParam > 0;
let roomWin = null;

/** 방 창이 방에 못 들어갔을 때 그 자리에 남기는 안내. */
function showRoomFail(msg) {
  const box = document.getElementById('roomFail');
  const t = document.getElementById('roomFailText');
  if (t) t.textContent = msg;
  // 인라인 style 이 시트를 이기므로 여기서 직접 켠다
  if (box) box.style.display = 'flex';
  clearRoomWindow();   // 바닥 창이 이 창을 기다리지 않도록
}

function markRoomWindow() {
  try { localStorage.setItem(POPUP_KEY, String(Date.now())); } catch { /* noop */ }
}

function clearRoomWindow() {
  try { localStorage.removeItem(POPUP_KEY); } catch { /* noop */ }
}

/** 바닥 창에서: 방을 띄운 창이 아직 살아 있는가 */
function roomWindowAlive() {
  if (isRoomWindow) return false;
  if (roomWin && !roomWin.closed) return true;
  try {
    return Date.now() - Number(localStorage.getItem(POPUP_KEY) || 0) < POPUP_FRESH_MS;
  } catch { return false; }
}

function isHost(r) {
  return !!(r && me && r.host === me.handle);
}

/**
 * 공인 IP 방식을 화면에 내놓을지.
 *
 * 지금은 Radmin 하나로만 간다. 공유기를 열 수 있는 집이 드물어 모두에게
 * 시킬 수가 없었다. 코드는 그대로 두고 화면에서만 접어둔다 — 나중에
 * 되살릴 일이 있으면 이 한 줄만 true 로 바꾸면 된다.
 */
const SHOW_CONN_MODE = false;

/** 화면이 따라야 할 방식. 접어둔 동안에는 무조건 Radmin 이다. */
function shownMode() { return SHOW_CONN_MODE ? connMode : 'radmin'; }

/**
 * 지금 쓰는 방식에 해당하는 것만 남긴다.
 *
 * 두 방식의 안내가 한 화면에 섞여 있으면 무엇을 해야 하는지 알 수 없다.
 * data-mode 가 붙은 것은 그 방식일 때만 보여주고, 안 붙은 것은 늘 보여준다.
 */
function applyConnMode() {
  const mode = shownMode();
  document.querySelectorAll('#tab-launcher [data-mode]').forEach(el => {
    el.style.display = (el.dataset.mode === mode) ? '' : 'none';
  });

  const sub = document.getElementById('dlSub');
  if (sub) {
    sub.innerHTML = mode === 'radmin'
      ? '※ <b>①~③에 대해 최초 1회만 실행</b>하면 그 다음부터는 게임만 접속하시면 됩니다.'
      : '※ <b>①~③ 은 모두</b> 하고, <b>＋ 는 방장을 할 사람만</b> 하면 됩니다 ·'
        + ' 최초 1회만 실행하면 그 다음부터는 게임만 접속하시면 됩니다.';
  }
}

/** Radmin 네트워크 안내. 비밀번호는 로그인한 사람에게만 보인다. */
function renderVpnBar() {
  const bar = document.getElementById('vpnBar');
  // Radmin 방식을 쓰는 사람에게만 보여준다. 공인 IP 로 바로 붙는 사람에게는
  // 켤 일이 없는 프로그램 안내가 남아 있으면 헷갈린다.
  if (bar) bar.style.display = (shownMode() === 'radmin') ? 'block' : 'none';
  const name = document.getElementById('vpnName');
  const wrap = document.getElementById('vpnPwWrap');
  const pw = document.getElementById('vpnPw');
  if (name) name.textContent = vpn.network;
  if (wrap) wrap.style.display = vpn.password ? 'flex' : 'none';  // 로그인해야 온다
  if (pw) pw.textContent = vpn.password || '';
}

/**
 * 방장이 막 실행했다면 방에 있는 사람도 함께 세고, START 에 게임이 켜진다.
 * 런쳐를 보고 있을 때만 움직인다 — 다른 페이지를 읽고 있는데 게임이
 * 튀어나오면 놀랄 일이다. 그런 사람은 조인하기로 들어오면 된다.
 */
function maybePlayRoomCountdown() {
  const r = myRoomData();
  if (!r || !r.running || !r.startedAt) return;
  if (r.startedAt === cdPlayedAt) return;                 // 이미 본 출발
  if (Date.now() - r.startedAt > CD_MS + 2000) {          // 지나간 출발
    cdPlayedAt = r.startedAt;
    return;
  }
  if (roomWindowAlive()) return;                          // 방 창이 대신 센다
  const panel = document.getElementById('tab-launcher');
  if (!panel || !panel.classList.contains('active')) return;
  playCountdown(r.startedAt, () => launchGame(r.address, 'join'));
}

/** 내 Radmin 주소 — 로그인한 사람에게만 보인다 */
/** 지금 방식으로 사람들이 나에게 찾아올 주소 */
function myConnAddress() {
  return shownMode() === 'radmin' ? savedAddress : publicIp;
}

function renderMyIp() {
  const bar = document.getElementById('myIpBar');
  const val = document.getElementById('myIpValue');
  const btn = document.getElementById('myIpEdit');
  const kind = document.getElementById('myIpKind');
  const note = document.getElementById('myIpNote');
  if (!bar || !val || !btn) return;

  const mode = shownMode();
  const on = isLoggedIn();
  bar.style.display = on ? 'flex' : 'none';
  if (note) note.style.display = on ? 'block' : 'none';
  const addr = myConnAddress();
  val.textContent = addr || '아직 없음';
  // 방식을 고를 게 없으면 버튼은 주소를 적는 일만 한다
  btn.textContent = SHOW_CONN_MODE ? '방식 바꾸기' : (addr ? '주소 수정' : '주소 적기');
  if (kind) kind.textContent = mode === 'radmin' ? 'Radmin' : '공인 IP · 자동';

  if (!note) return;
  note.classList.toggle('warn', mode === 'auto' && !publicIpUsable);
  note.classList.toggle('must', mode === 'radmin' && !!addr);
  if (mode === 'radmin') {
    note.textContent = addr
      ? '※ Radmin VPN이 실행되어 있어야 게임 접속이 가능합니다.'
      : 'Radmin 창의 내 주소(26.…)를 적어주세요.';
  } else if (!publicIpUsable) {
    note.textContent = '이 회선은 밖에서 찾아올 수 없는 주소입니다 · 방장을 하려면 Radmin 방식으로 바꿔주세요.';
  } else {
    note.textContent = '적을 것이 없습니다 · 방장을 하려면 공유기에 UDP 2346 을 열어두세요.';
  }
}

/**
 * 서로를 어떻게 찾을지 고르는 창.
 *
 * 공인 IP 는 사이트가 알아서 읽으므로 적을 것이 없고 설치할 것도 없다.
 * 다만 방장을 하려면 공유기에 문이 열려 있어야 하고, 통신사가 공인 IP 를
 * 주지 않는 회선은 방장을 할 수 없다. 그때 Radmin 을 쓴다.
 */
function showIpModal() {
  // 방식을 접어둔 동안에는 주소만 받는다. 고를 것이 하나뿐인데 고르라고
  // 두 칸을 늘어놓으면 무엇을 하는 창인지 알기 어렵다.
  if (!SHOW_CONN_MODE) { showRadminModal(); return; }

  const auto = connMode === 'auto';
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>접속 방식</h3>
    <div class="foot-note" style="margin-top:0;">방장이 되었을 때 사람들이
      나를 어떻게 찾아올지 고릅니다. 참가만 할 때는 상관없습니다.</div>

    <label class="pick-row${auto ? '' : ' on'}" id="pickRadmin">
      <input type="radio" name="connMode" value="radmin" ${auto ? '' : 'checked'}>
      <span class="pick-body">
        <b>Radmin VPN <span class="pick-tag">기본</span></b>
        <em>Radmin 을 켜고 그 안의 주소로 붙습니다 · 공유기를 손대지 않아도 됩니다</em>
      </span>
    </label>

    <label class="pick-row${auto ? ' on' : ''}" id="pickAuto">
      <input type="radio" name="connMode" value="auto" ${auto ? 'checked' : ''}>
      <span class="pick-body">
        <b>공인 IP · 자동</b>
        <em>Radmin 없이 곧장 붙습니다 · 사이트가 읽은 주소
          ${publicIp ? `<code>${esc(publicIp)}</code>` : '(아직 못 읽음)'}
          ${publicIp && !publicIpUsable
            ? '<br><b class="warn">이 회선은 밖에서 찾아올 수 없어 방장을 할 수 없습니다.</b>'
            : '<br><b>공유기에 UDP 2346 을 열어둔 사람만</b> 고르세요 (r6upnp.bat).'}</em>
      </span>
    </label>

    <div id="radminBox" style="display:${auto ? 'none' : 'block'};">
      <label>Radmin 창에 보이는 내 주소</label>
      <input type="text" id="ipValue" maxlength="21" autocomplete="off"
             placeholder="예: 26.131.188.239" value="${esc(savedAddress || '')}">
    </div>

    <div class="modal-error" id="ipErr"></div>
    <button class="btn" id="ipSubmit">저장</button>`);

  const box = document.getElementById('radminBox');
  document.querySelectorAll('input[name="connMode"]').forEach(el => {
    el.addEventListener('change', () => {
      const radmin = el.value === 'radmin' && el.checked;
      box.style.display = radmin ? 'block' : 'none';
      document.getElementById('pickAuto').classList.toggle('on', !radmin);
      document.getElementById('pickRadmin').classList.toggle('on', radmin);
      if (radmin) document.getElementById('ipValue').focus();
    });
  });

  const go = () => saveMyIp();
  document.getElementById('ipSubmit').addEventListener('click', go);
  document.getElementById('ipValue').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
}

/** Radmin 주소만 받는 창 */
function showRadminModal() {
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>내 Radmin 주소</h3>
    <div class="foot-note" style="margin-top:0;">Radmin VPN 창에서 내 이름 옆에 있는
      <b>26. 으로 시작하는 주소</b>를 적어주세요. 한 번만 적어두면 됩니다.</div>
    <label>내 주소</label>
    <input type="text" id="ipValue" maxlength="21" autocomplete="off"
           placeholder="예: 26.131.188.239" value="${esc(savedAddress || '')}">
    <div class="modal-error" id="ipErr"></div>
    <button class="btn" id="ipSubmit">저장</button>
    <div class="foot-note">방장이 되면 사람들이 이 주소로 찾아 들어옵니다 ·
      컴퓨터를 바꾸거나 Radmin 을 다시 깔면 주소가 달라질 수 있습니다.</div>`);
  const go = () => saveMyIp();
  document.getElementById('ipSubmit').addEventListener('click', go);
  const input = document.getElementById('ipValue');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  input.focus();
}

async function saveMyIp() {
  const picked = document.querySelector('input[name="connMode"]:checked');
  // 방식을 접어둔 동안 저장하는 것은 언제나 Radmin 이다
  const mode = SHOW_CONN_MODE ? (picked ? picked.value : 'auto') : 'radmin';
  const input = document.getElementById('ipValue');
  const err = document.getElementById('ipErr');
  if (err) err.textContent = '';
  try {
    const d = await apiPost('/api/room', {
      action: 'setIp', mode, address: input ? input.value.trim() : '',
    });
    savedAddress = d.address || null;
    connMode = mode;
    closeModal();
    renderLauncher();
    showToast(mode === 'radmin'
      ? `Radmin 주소 ${savedAddress} 로 접속합니다.`
      : '공인 IP 로 접속합니다. 적을 것이 없습니다.');
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

function renderLauncher() {
  applyConnMode();
  renderVpnBar();
  renderMyIp();
  const gate = document.getElementById('lcGate');
  const grid = document.getElementById('lcRooms');
  const view = document.getElementById('lcRoom');
  if (!gate || !grid || !view) return;

  const here = myRoomData();
  // 방이 다른 창에 떠 있으면 여기서는 그리지 않는다. 같은 방을 두 번 그리면
  // 카운트다운도 두 번 돌아 게임이 두 번 켜진다.
  const elsewhere = !!here && roomWindowAlive();
  gate.style.display = isLoggedIn() ? 'none' : 'block';
  grid.style.display = isLoggedIn() && !here ? 'block' : 'none';
  view.style.display = here && !elsewhere ? 'block' : 'none';
  renderAwayBar(elsewhere ? here : null);

  if (isLoggedIn() && !here) { renderRoomGrid(); renderWaiting(); renderLobbyChat(); }
  if (here && !elsewhere) renderRoomView(here);
}

/** 방 목록 옆에 지금 런쳐를 보고 있는 사람들. 방에 들어간 사람은 빠진다. */
function renderWaiting() {
  const box = document.getElementById('waitList');
  const n = document.getElementById('waitCount');
  if (!box) return;
  if (n) n.textContent = String(waiting.length);
  box.innerHTML = waiting.length
    ? waiting.map(w => {
        const h = typeof w === 'string' ? w : w.handle;
        const rtt = typeof w === 'string' ? null : w.rtt;
        return `<div class="wait-row${me && h === me.handle ? ' me' : ''}">
          <span class="seat-id">${esc(h)}</span>${pingBars(rtt)}
        </div>`;
      }).join('')
    : '<div class="wait-empty">아직 아무도 없습니다.</div>';
}

/** 방이 다른 창에 있을 때, 바닥 창에 남겨두는 한 줄. */
function renderAwayBar(r) {
  const bar = document.getElementById('lcAway');
  if (!bar) return;
  bar.style.display = r ? 'flex' : 'none';
  if (!r) return;
  const t = document.getElementById('lcAwayText');
  if (t) t.textContent = `${roomName(r)}에 다른 창으로 들어가 있습니다 · ${r.members.length}명`;
}

function renderRoomGrid() {
  const box = document.getElementById('roomGrid');
  if (!box) return;
  box.innerHTML = rooms.map(r => {
    const cap = capOf(r);
    const full = r.members.length >= cap;
    // 방장을 뺀 나머지를 몇 명만 보여준다. 다 적으면 카드가 넘친다.
    const rest = r.members.slice(1);
    const shown = rest.slice(0, 3).join(', ') + (rest.length > 3 ? ` 외 ${rest.length - 3}명` : '');
    // 인원수에 마우스를 얹거나 누르면 누가 있는지 펼쳐 보여준다
    const who = r.members.length
      ? r.members.map((h, i) => `<span class="who-i">${i === 0 ? '방장' : i + 1}</span>${esc(h)}`)
          .map(x => `<div class="who-row">${x}</div>`).join('')
      : '<div class="who-empty">아직 아무도 없습니다.</div>';
    return `<div class="room-card${r.running ? ' live' : ''}${full ? ' full' : ''}">
      <div class="room-card-h">
        <span class="room-no">${esc(roomName(r))}</span>
        ${r.running ? '<span class="room-live">실행 중</span>' : ''}
        <button type="button" class="room-n" data-who="${r.room}"
                aria-expanded="false">${r.members.length} / ${cap}</button>
        <div class="who-pop" data-whopop="${r.room}" hidden>
          <div class="who-h">${esc(roomName(r))} · ${r.members.length} / ${cap}</div>
          ${who}
        </div>
      </div>
      <div class="room-card-mid">
        <button type="button" class="room-enter" data-enter="${r.room}" ${full ? 'disabled' : ''}>
          ${full ? '정원 마감' : 'JOIN'}
        </button>
      </div>
      <div class="room-card-f">
        <span class="room-host">${r.host
          ? `방장 <b>${esc(r.host)}</b>`
          : '비어 있음 · 먼저 들어가면 방장'}</span>
        <span class="room-seatline">${rest.length ? esc(shown) : ''}</span>
      </div>
    </div>`;
  }).join('');
}

function renderRoomView(r) {
  const host = isHost(r);
  const title = document.getElementById('roomTitle');
  const role = document.getElementById('roomRole');
  const count = document.getElementById('roomCount');
  const run = document.getElementById('roomRun');
  if (title) title.textContent = roomName(r);
  const rename = document.getElementById('roomRename');
  if (rename) rename.style.display = host ? 'inline-flex' : 'none';
  if (role) role.textContent = host ? '방장' : '참가자';
  if (count) count.textContent = `${r.members.length} / ${capOf(r)}`;
  renderCap(r, host);
  if (run) run.textContent = r.running ? '실행 중' : '';

  // 들어온 순서 그대로. 맨 앞이 방장이라 따로 세우고 나머지를 아래에 둔다.
  const detail = r.seats && r.seats.length
    ? r.seats
    : r.members.map(h => ({ handle: h, rtt: null }));
  // HOST 줄에는 번호도 방장 배지도 달지 않는다 — 머리글이 이미 말하고 있고,
  // 좁은 칸에서 그것들이 이름을 밀어내 "L..." 처럼 잘린다.
  const seat = (s, i) => {
    const mine = me && s.handle === me.handle;
    const clickable = host && !mine;
    return `<div class="seat${mine ? ' me' : ''}${clickable ? ' pick' : ''}"
                 data-h="${esc(s.handle)}"${clickable ? ' title="오른쪽 클릭 — 방장 넘기기 · 강퇴"' : ''}>
      ${i === 0 ? '' : `<span class="seat-n">${i + 1}</span>`}
      <span class="seat-id">${esc(s.handle)}</span>
      ${pingBars(s.rtt)}
    </div>`;
  };
  const hostBox = document.getElementById('roomHostSeat');
  if (hostBox) hostBox.innerHTML = detail.length ? seat(detail[0], 0) : '';
  const seats = document.getElementById('roomSeats');
  if (seats) {
    seats.innerHTML = detail.length > 1
      ? detail.slice(1).map((s, i) => seat(s, i + 1)).join('')
      : '<div class="wait-empty">아직 아무도 없습니다.</div>';
  }

  // 명단은 2초마다 다시 그려진다. 열려 있는 메뉴까지 매번 닫아버리면 누를 새가
  // 없다. 그 사람이 방에서 빠졌거나 내가 방장이 아니게 됐을 때만 닫는다.
  const menu = document.getElementById('seatMenu');
  if (menu && !menu.hidden && (!host || !r.members.includes(menu.dataset.handle))) {
    closeSeatMenu();
  }

  const hint = document.getElementById('seatHint');
  if (hint) hint.style.display = (host && r.members.length > 1) ? '' : 'none';

  renderChatLog();

  // 방장이 올린 접속 주소
  const addr = document.getElementById('roomAddr');
  if (addr) {
    addr.style.display = r.address ? 'flex' : 'none';
    const v = document.getElementById('addrValue');
    if (v) v.textContent = r.address || '';
  }

  // 게임이 켜진 뒤. 설치를 마쳤으면 메뉴를 거치지 않고 곧장 로비로 들어간다.
  const steps = document.getElementById('roomSteps');
  if (steps) {
    steps.style.display = r.running ? 'block' : 'none';
    steps.innerHTML = host
      ? `<div class="room-steps-h">게임이 켜지면 — 로비에서 기다리세요</div>
         <ol>
           <li>사람들이 다 들어오면 맵과 인원을 정하고 <kbd>START MISSION</kbd></li>
         </ol>
         <div class="steps-alt">설치를 마쳤으면 <b>메인 메뉴를 거치지 않고 바로 로비</b>로
           들어갑니다. 메인 메뉴에 그냥 서 있다면 위 설치 안내를 다시 확인해주세요.
           <br><b>MULTIPLAYER OPTIONS 의 ANNOUNCE SERVER 는 꺼두세요</b> —
           켜두면 이 방이 모두의 목록에 떠서 런쳐를 거치지 않고도 들어옵니다.</div>`
      : `<div class="room-steps-h">게임이 켜지면 — ${esc(r.host || '방장')} 님 방으로</div>
         <ol>
           <li>자동으로 붙습니다. 로비에 들어가면 방장이 시작할 때까지 기다리세요.</li>
         </ol>
         <div class="steps-alt">${r.address
           ? `혹시 못 붙으면 <kbd>MULTIPLAYER</kbd> › <kbd>MANUAL JOIN</kbd> 에
              <b>${esc(r.address)}</b> · 포트 <b>2346</b> 을 직접 넣으세요
              (조인하기를 누르면 주소가 복사됩니다).`
           : '방장이 아직 Radmin 주소를 적지 않아 자동으로 붙지 못할 수 있습니다.'}</div>`;
  }

  const actions = document.getElementById('roomActions');
  if (actions) {
    actions.innerHTML = host
      ? `<button class="btn" id="roomStart">${r.running ? '주소 바꾸고 다시 실행' : '실행하기'}</button>
         <button class="btn-ghost" id="roomLeave">나가기</button>`
      : `<button class="btn" id="roomJoin" ${r.running ? '' : 'disabled'}>조인하기</button>
         <button class="btn-ghost" id="roomLeave">나가기</button>`;
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('roomStart', startFlow);
    on('roomJoin', () => launchGame(r.address, 'join'));
    on('roomLeave', leaveRoom);
  }

  const note = document.getElementById('roomNote');
  if (note) {
    note.innerHTML = host
      ? 'Radmin VPN 에 들어와 있어야 하고, 실행하기에 내 Radmin 주소(26.…)가 필요합니다.'
        + ' 방에 있는 모두가 함께 카운트다운을 보고 게임이 켜집니다.'
      : (r.running
        ? '게임이 안 켜졌다면 조인하기를 눌러주세요.'
        : '방장이 실행하기를 누르면 다 같이 카운트다운이 돌고 게임이 켜집니다.');
  }
}

/**
 * 실행하기.
 * 내 주소를 이미 적어두었으면 묻지 않고 바로 간다.
 * 아직 없으면 그때 한 번 받는다 — 사람들이 찾아올 주소이므로 꼭 있어야 한다.
 */
function startFlow() {
  // 공인 IP 방식은 서버가 알아서 읽으므로 물어볼 것이 없다.
  if (connMode !== 'radmin') { startRoom(''); return; }
  if (savedAddress) { startRoom(savedAddress); return; }
  showStartModal();
}

/** 방장이 자기 Radmin 주소를 적는 창 */
function showStartModal() {
  const here = myRoomData();
  openModal(`
    <button class="modal-x" onclick="closeModal()">✕</button>
    <h3>게임 실행</h3>
    <div class="foot-note" style="margin-top:0;">Radmin VPN 창에 보이는
      <b>내 주소</b>를 적어주세요. 방이 여러 개 열려 있으면 목록만 보고는
      어느 방인지 가릴 수 없어, 사람들이 이 주소로 곧장 찾아 들어갑니다.</div>
    <label>내 Radmin 주소</label>
    <input type="text" id="startAddr" maxlength="21" autocomplete="off"
           placeholder="예: 26.131.188.239" value="${esc((here && here.address) || savedAddress || '')}">
    <div class="modal-error" id="startErr"></div>
    <button class="btn" id="startSubmit">실행하기</button>
    <div class="foot-note">한 번 적어두면 다음부터 자동으로 채워집니다.</div>`);
  const go = () => startRoom();
  document.getElementById('startSubmit').addEventListener('click', go);
  document.getElementById('startAddr').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
}

/** 대화창. 새 말이 없으면 다시 그리지 않는다 (스크롤이 튀지 않도록) */
function renderChatLog() { paintChat('chatLog', roomMsgs, '아직 대화가 없습니다.'); }

/** 대기실 대화. 방에 들어가기 전 화면에만 있다. */
function renderLobbyChat() {
  paintChat('lobbyLog', lobbyMsgs, '먼저 인사를 건네보세요.');
}

/**
 * 대화 목록을 그린다.
 *
 * 2초마다 다시 그리는 자리라, 달라진 게 없으면 손대지 않는다. 매번 새로
 * 그리면 읽던 자리가 맨 아래로 튀고 글자를 끌어 옮기던 것도 풀린다.
 */
function paintChat(id, msgs, empty) {
  const box = document.getElementById(id);
  if (!box) return;
  const last = msgs.length ? msgs[msgs.length - 1].id : 0;
  if (box.dataset.last === String(last) && box.childElementCount) return;
  box.dataset.last = String(last);

  box.innerHTML = msgs.map(m => {
    if (!m.handle) return `<div class="chat-line chat-sys">· ${esc(m.body)}</div>`;
    const mine = me && m.handle === me.handle;
    return `<div class="chat-line">
      <span class="chat-who${mine ? ' me' : ''}">${esc(m.handle)}</span>${esc(m.body)}
      <span class="chat-t">${hhmm(m.ts)}</span>
    </div>`;
  }).join('') || `<div class="chat-line chat-sys">· ${empty}</div>`;
  box.scrollTop = box.scrollHeight;
}

function hhmm(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 방 정원 고르기.
 *
 * 이미 들어와 있는 사람보다 적은 숫자는 아예 목록에서 뺀다 — 고를 수 있게
 * 두고 나서 거절하면, 왜 안 되는지 눌러본 뒤에야 알게 된다.
 */
function renderCap(r, host) {
  const box = document.getElementById('roomCap');
  const sel = document.getElementById('capSelect');
  const note = document.getElementById('capNote');
  if (!box || !sel) return;

  box.style.display = 'flex';
  sel.disabled = !host;
  const cur = capOf(r);
  const floor = Math.max(capacityMin, r.members.length);
  const want = [];
  for (let n = capacityMin; n <= ROOM_CAPACITY; n++) if (n >= floor || n === cur) want.push(n);
  const sig = want.join(',') + '|' + cur;
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = want.map(n =>
      `<option value="${n}"${n === cur ? ' selected' : ''}>${n}명</option>`).join('');
  }
  sel.value = String(cur);
  if (note) {
    note.textContent = host
      ? `${capacityMin}명부터 ${ROOM_CAPACITY}명까지 · 이미 들어온 ${r.members.length}명보다 적게는 줄일 수 없습니다.`
      : '방장이 정한 정원입니다.';
  }
}

async function saveCap(cap) {
  try {
    await apiPost('/api/room', { action: 'setCap', cap });
  } catch (e) { showToast(e.message); }
  await loadRooms();
  renderLauncher();
}

function initCapEvents() {
  const sel = document.getElementById('capSelect');
  if (sel) sel.addEventListener('change', () => saveCap(Number(sel.value)));

  const rename = document.getElementById('roomRename');
  if (rename) rename.addEventListener('click', showTitleModal);
}

/** 방 이름 짓기. 비우고 저장하면 "N번방" 으로 되돌아간다. */
function showTitleModal() {
  const r = myRoomData();
  if (!r) return;
  openModal(`
    <h3>방 이름</h3>
    <label>이름</label>
    <input type="text" id="titleInput" maxlength="${maxTitle}" autocomplete="off"
           placeholder="${r.room}번방" value="${esc(r.title || '')}">
    <div class="modal-error" id="titleErr"></div>
    <button class="btn" id="titleSave">저장</button>
    <div class="foot-note">비워두고 저장하면 <b>${r.room}번방</b> 으로 되돌아갑니다 ·
      ${maxTitle}자까지 지을 수 있습니다.</div>`);
  const input = document.getElementById('titleInput');
  const save = document.getElementById('titleSave');
  const err = document.getElementById('titleErr');
  const go = async () => {
    try {
      await apiPost('/api/room', { action: 'setTitle', title: input ? input.value : '' });
      closeModal();
      await loadRooms();
      renderLauncher();
    } catch (e) { if (err) err.textContent = e.message; else showToast(e.message); }
  };
  if (save) save.addEventListener('click', go);
  if (input) {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    input.focus();
    input.select();
  }
}

/**
 * 방 카드의 인원수 — 얹으면 펴지고 치우면 접힌다.
 * 손가락으로 보는 사람도 있으니 눌러도 열리게 두고, 밖을 누르면 닫는다.
 */
function initWhoEvents() {
  const grid = document.getElementById('roomGrid');
  if (!grid) return;

  const popFor = (btn) => btn.parentElement.querySelector(`[data-whopop="${btn.dataset.who}"]`);
  const closeAll = () => grid.querySelectorAll('[data-whopop]').forEach(p => {
    p.hidden = true;
    const b = p.parentElement.querySelector('[data-who]');
    if (b) b.setAttribute('aria-expanded', 'false');
  });

  grid.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('[data-who]');
    if (!btn) return;
    closeAll();
    const pop = popFor(btn);
    if (pop) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  });
  grid.addEventListener('pointerout', (e) => {
    const head = e.target.closest('.room-card-h');
    if (!head) return;
    // 목록 위로 옮겨간 것뿐이면 닫지 않는다
    if (e.relatedTarget && head.contains(e.relatedTarget)) return;
    closeAll();
  });
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-who]');
    if (!btn) return;
    const pop = popFor(btn);
    if (!pop) return;
    const open = !pop.hidden;
    closeAll();
    if (!open) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.room-card-h')) closeAll();
  });
}

async function enterRoom(room) {
  if (!isLoggedIn()) { showLoginModal(); return; }
  if (openRoomWindow(room)) return;   // 새 창이 열렸으면 들어가는 일도 그 창이 한다
  try {
    applyRooms(await apiPost('/api/room', { action: 'enter', room }));
    renderLauncher();
  } catch (e) { showToast(e.message); }
}

/**
 * 방을 새 창으로 띄운다.
 *
 * 팝업이 막혀 있으면 열리지 않는다. 그때는 예전처럼 이 자리에서 방을 열어야
 * 하므로 false 를 돌려준다 — 막혔다고 방에 못 들어가면 안 된다.
 */
function openRoomWindow(room) {
  let w = null;
  try {
    w = window.open(`/?room=${room}`, `r6room${room}`,
      'popup=yes,width=1040,height=820,menubar=no,toolbar=no,location=no');
  } catch { /* 브라우저가 막았다 */ }
  if (!w) {
    showToast('팝업이 막혀 있어 이 화면에서 방을 엽니다 · 주소창의 팝업 허용을 켜주세요.');
    return false;
  }
  roomWin = w;
  try { w.focus(); } catch { /* noop */ }
  return true;
}

async function leaveRoom() {
  leavingOnPurpose = true;
  try {
    await apiPost('/api/room', { action: 'leave' });
    await loadRooms();
    renderLauncher();
  } catch (e) { showToast(e.message); }
  finally { leavingOnPurpose = false; }
}

/* ---------- 방장이 명단에서 하는 일 ---------- */

/**
 * 명단의 이름을 오른쪽 클릭하면 뜨는 작은 메뉴.
 * 방장에게만, 자기 자신이 아닌 사람에게만 열린다.
 * 오른쪽 버튼이 없는 휴대폰을 위해 그냥 눌러도 열리게 해두었다.
 */
let seatMenuOpenedAt = 0;

function openSeatMenu(handle, x, y) {
  const box = document.getElementById('seatMenu');
  if (!box) return;
  const who = document.getElementById('seatMenuWho');
  if (who) who.textContent = handle;
  box.dataset.handle = handle;
  box.hidden = false;
  seatMenuOpenedAt = Date.now();

  // 화면 밖으로 나가지 않게 안쪽으로 당긴다
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  box.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
}

function closeSeatMenu() {
  const box = document.getElementById('seatMenu');
  if (box) box.hidden = true;
}

async function giveHostTo(handle) {
  closeSeatMenu();
  if (!confirm(`${handle} 님에게 방장을 넘길까요?\n\n실행하기 버튼도 그 사람에게 넘어갑니다.`)) return;
  try {
    await apiPost('/api/room', { action: 'giveHost', handle });
    await loadRooms();
    renderLauncher();
    showToast(`${handle} 님이 방장이 되었습니다.`);
  } catch (e) { showToast(e.message); }
}

async function kickMember(handle) {
  closeSeatMenu();
  if (!confirm(`${handle} 님을 방에서 내보낼까요?\n\n다시 들어오는 것을 막지는 않습니다.`)) return;
  try {
    await apiPost('/api/room', { action: 'kick', handle });
    await loadRooms();
    renderLauncher();
    showToast(`${handle} 님을 내보냈습니다.`);
  } catch (e) { showToast(e.message); }
}

function initSeatMenu() {
  const box = document.getElementById('seatMenu');
  const seats = document.getElementById('roomSeats');
  if (!box || !seats) return;

  const open = (e) => {
    const seat = e.target.closest('.seat');
    if (!seat || !seat.dataset.h) return;
    const r = myRoomData();
    if (!isHost(r)) return;                       // 방장만
    if (me && seat.dataset.h === me.handle) return;  // 자기 자신은 빼고
    e.preventDefault();
    openSeatMenu(seat.dataset.h, e.clientX, e.clientY);
  };
  seats.addEventListener('contextmenu', open);
  seats.addEventListener('click', open);

  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-do]');
    if (!btn) return;
    const handle = box.dataset.handle;
    if (btn.dataset.do === 'host') giveHostTo(handle);
    else kickMember(handle);
  });

  document.addEventListener('click', (e) => {
    if (!box.hidden && !box.contains(e.target) && !e.target.closest('.seat')) closeSeatMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSeatMenu(); });
  window.addEventListener('resize', closeSeatMenu);
  // 화면이 움직이면 닫는다. 다만 열자마자 오는 스크롤은 무시한다 —
  // 이름이 화면 밖에 있었으면 브라우저가 먼저 끌어올리는데, 그 스크롤이
  // 방금 연 메뉴를 도로 닫아버린다.
  window.addEventListener('scroll', () => {
    if (Date.now() - seatMenuOpenedAt > 300) closeSeatMenu();
  }, true);
}

async function startRoom(known) {
  const input = document.getElementById('startAddr');
  const err = document.getElementById('startErr');
  const address = known !== undefined ? known : (input ? input.value.trim() : '');
  if (err) err.textContent = '';
  if (connMode === 'radmin' && !address) {
    const msg = 'Radmin 주소를 적지 않으면 사람들이 찾아올 수 없습니다.';
    if (err) err.textContent = msg; else showToast(msg);
    return;
  }
  try {
    const d = await apiPost('/api/room', { action: 'start', address });
    closeModal();
    if (connMode === 'radmin') savedAddress = address || savedAddress;
    await loadRooms();
    renderLauncher();
    // 3·2·1 을 세고 게임을 띄운다. 방에 있는 사람들도 같은 시각에 맞춰 함께 센다.
    // 서버가 정한 주소를 그대로 쓴다 (공인 IP 방식이면 서버만 알고 있다).
    playCountdown(d.startedAt || Date.now(), () => launchGame(d.address, 'create'));
  } catch (e) {
    if (err) err.textContent = e.message;
    else showToast(e.message);
  }
}

async function sendChat() { await postChat('chatInput', 'say'); }

/** 대기실에 한마디. 방 밖에 있는 사람들이 함께 본다. */
async function sendLobbyChat() { await postChat('lobbyInput', 'sayLobby'); }

/**
 * 적은 말을 보낸다.
 *
 * 누르자마자 내 화면에 먼저 띄운다. 서버를 다녀올 때까지 아무 일도 일어나지
 * 않으면 안 눌린 줄 알고 또 누르게 된다. 서버가 담은 결과를 그대로 돌려주므로
 * 다시 물어볼 필요도 없다 — 왕복 한 번으로 끝난다.
 *
 * 못 보냈으면 띄웠던 줄을 걷어내고 지웠던 글을 입력칸에 되돌린다.
 */
async function postChat(inputId, action) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const lobby = action === 'sayLobby';
  const list = lobby ? lobbyMsgs : roomMsgs;
  const pending = { id: `p${Date.now()}`, handle: me ? me.handle : '', body: text, ts: Date.now() };
  list.push(pending);
  if (lobby) renderLobbyChat(); else renderChatLog();

  try {
    const d = await apiPost('/api/room', { action, body: text });
    if (d && d.messages) {
      if (lobby) lobbyMsgs = d.messages; else roomMsgs = d.messages;
    }
  } catch (e) {
    const i = list.indexOf(pending);
    if (i >= 0) list.splice(i, 1);
    input.value = text;
    showToast(e.message);
  }
  if (lobby) renderLobbyChat(); else renderChatLog();
}

function initLauncherEvents() {
  const grid = document.getElementById('roomGrid');
  if (grid) grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-enter]');
    if (btn) enterRoom(Number(btn.dataset.enter));
  });

  const login = document.getElementById('lcLoginBtn');
  if (login) login.addEventListener('click', showLoginModal);

  const ipEdit = document.getElementById('myIpEdit');
  if (ipEdit) ipEdit.addEventListener('click', showIpModal);

  const failClose = document.getElementById('roomFailClose');
  if (failClose) failClose.addEventListener('click', () => window.close());

  const reopen = document.getElementById('lcAwayOpen');
  if (reopen) reopen.addEventListener('click', () => {
    const r = myRoomData();
    if (r) openRoomWindow(r.room);
  });
  const awayLeave = document.getElementById('lcAwayLeave');
  if (awayLeave) awayLeave.addEventListener('click', () => {
    // 창은 스스로 닫지 못하니(열어준 창만 닫을 수 있다) 표시를 지워 둘을 떼어놓는다
    try { if (roomWin && !roomWin.closed) roomWin.close(); } catch { /* noop */ }
    roomWin = null;
    clearRoomWindow();
    leaveRoom();
  });

  const copy = document.getElementById('addrCopy');
  if (copy) copy.addEventListener('click', async () => {
    const v = document.getElementById('addrValue');
    const text = v ? v.textContent : '';
    if (!text) return;
    showToast(await copyText(text) ? `${text} 복사했습니다.` : '복사하지 못했습니다. 주소를 직접 적어주세요.');
  });

  const send = document.getElementById('chatSend');
  if (send) send.addEventListener('click', sendChat);
  const input = document.getElementById('chatInput');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  const lsend = document.getElementById('lobbySend');
  if (lsend) lsend.addEventListener('click', sendLobbyChat);
  const linput = document.getElementById('lobbyInput');
  if (linput) linput.addEventListener('keydown', e => { if (e.key === 'Enter') sendLobbyChat(); });

  // 런쳐를 보고 있는 동안만 계속 받아온다. 이 요청이 자리를 지키는 신호도 된다.
  const panel = document.getElementById('tab-launcher');
  if (!panel) return;
  let last = 0;
  setInterval(async () => {
    if (!panel.classList.contains('active') || !isLoggedIn()) return;
    const gap = playing() ? PLAYING_POLL_MS : 2000;
    if (Date.now() - last < gap) return;
    last = Date.now();
    if (isRoomWindow) markRoomWindow();
    await loadRooms();
    renderLauncher();
    maybePlayRoomCountdown();
  }, 500);
}

/**
 * 게임이 켜져 있는 동안에는 천천히 받아온다.
 *
 * 레인보우식스는 전체화면을 독차지하는 옛 게임이라, 켜고 나면 Alt+Tab 으로
 * 빠져나와 이 화면을 닫을 수가 없다. 그래서 스스로 물러난다 — 2초마다 묻던
 * 것을 1분에 한 번으로 줄인다. 자리를 지키는 신호이기도 하므로 아주 끊지는
 * 않는다(3분 잠잠하면 방에서 빠진다). 화면으로 돌아오면 곧바로 원래대로.
 */
const PLAYING_POLL_MS = 60000;
const PLAYING_MAX_MS = 6 * 60 * 60 * 1000;   // 켜둔 채 잊어버려도 언젠가는 풀린다
let playingAt = 0;

function playing() {
  if (!playingAt) return false;
  if (Date.now() - playingAt > PLAYING_MAX_MS) { playingAt = 0; return false; }
  return true;
}

function startPlaying() { playingAt = Date.now(); }
function stopPlaying() { playingAt = 0; }

function initPlayingWatch() {
  // 게임을 끄고 브라우저로 돌아온 순간이 곧 "다시 보고 있다"는 신호다
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stopPlaying(); });
  window.addEventListener('focus', stopPlaying);
  window.addEventListener('pointerdown', stopPlaying);
  window.addEventListener('keydown', stopPlaying);
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

/** 탭만 켠다 — 받아오는 일 없이 화면만 바꾼다. */
function showTabOnly(name) {
  const panel = document.getElementById('tab-' + name);
  if (!panel) return false;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');
  return true;
}

function activateTab(name) {
  const panel = document.getElementById('tab-' + name);
  if (!panel) return;
  // 탭 줄 밖에 있는 버튼(우측 상단 관리자)도 같이 표시를 맞춘다
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');

  if (name === 'standing') {
    // 브라우저가 검색창을 자동으로 채워두면 목록이 비어 보인다.
    // STANDING 으로 올 때는 항상 전체 목록부터 보여준다.
    const search = document.getElementById('searchInput');
    if (search && search.value) { search.value = ''; }
    renderStanding();
  }
  // 그 탭이 쓰는 것만 받아온다. 리폿 하나 보자고 출석·대회·게시판까지
  // 새로 받으면 왕복이 일곱 번 이어져 탭이 늦게 열린다.
  if (name === 'history') loadState().then(() => { renderHistory(); renderStanding(); renderTop5(); });
  if (name === 'attendance') { loadAttendance().then(renderAttendance); }
  if (name === 'launcher') { loadRooms().then(renderLauncher); }
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
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
  const lockedBtn = document.getElementById('adminLockedLoginBtn');
  if (lockedBtn) lockedBtn.addEventListener('click', showLoginModal);
  const reportBtn = document.getElementById('reportLoginBtn');
  if (reportBtn) reportBtn.addEventListener('click', showLoginModal);
  const postBtn = document.getElementById('postLoginBtn');
  if (postBtn) postBtn.addEventListener('click', showLoginModal);
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

/**
 * 화면에 필요한 것을 모두 받아온다.
 *
 * 하나씩 기다리면 일곱 번의 왕복이 줄줄이 이어져, 왕복 한 번이 200ms 인
 * 회선에서는 그것만으로 1초가 넘는다. 서로 기댈 것이 없는 요청들이므로
 * 한꺼번에 보낸다. 하나가 실패해도 나머지는 그려야 하니 결과는 따지지 않는다.
 */
async function refreshAll() {
  await Promise.allSettled([
    loadState(), loadSeasons(), loadAttendance(),
    loadTournament(), loadPosts(), loadRooms(), loadAccounts(),
  ]);
  renderAll();
}

/**
 * 지난번에 적어둔 표로 조용히 다시 들어간다.
 * 표가 만료됐거나 서버에서 지워졌으면 버리고 로그아웃 상태로 시작한다.
 */
async function restoreLogin() {
  const token = readKey(TOKEN_KEY);
  if (!token) return;
  authToken = token;
  try {
    const d = await apiPost('/api/account', { action: 'me' });
    if (d && d.account) { me = d.account; return; }
  } catch { /* 만료됐거나 못 쓰는 표 */ }
  authToken = null;
  me = null;
  clearLogin();
}

function showFatal(msg) {
  const el = document.getElementById('connBanner');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

/**
 * 방만 띄운 창의 채비.
 *
 * 화면은 방 하나로 좁히고, 순위·출석 같은 나머지는 받아오지도 않는다.
 * 창을 닫으면 방에서도 나간다 — 목록에 유령이 남지 않도록.
 */
async function bootRoomWindow() {
  document.documentElement.classList.add('room-only');
  document.title = `${roomParam}번방 · RAINBOWSIX RANK`;
  markRoomWindow();
  // 탭만 켠다. activateTab 은 켜면서 목록을 또 받아오는데, 바로 아래에서
  // 들어가기 응답으로 같은 것을 받으므로 왕복이 한 번 헛돈다.
  showTabOnly('launcher');
  if (!isLoggedIn()) { showRoomFail('로그인이 풀렸습니다 · 창을 닫고 다시 들어와주세요.'); return; }
  try {
    // 창을 열면서 이미 보내둔 것이 있으면 그것을 쓴다
    applyRooms(await (entering || apiPost('/api/room', { action: 'enter', room: roomParam })));
  } catch (e) {
    // 이 창에는 방 목록이 없다. 못 들어간 이유를 여기서 말해주지 않으면
    // 빈 화면만 남아 무슨 일이 났는지 알 수가 없다.
    showRoomFail(e.message);
    return;
  }
  renderLauncher();
  const here = myRoomData();
  if (here) document.title = `${roomName(here)} · RAINBOWSIX RANK`;
}

/**
 * 방 창이 뜨자마자 보내두는 들어가기 요청.
 *
 * 표는 브라우저에 이미 적혀 있으므로 내가 누구인지 확인되기를 기다릴 필요가
 * 없다. 확인과 들어가기를 함께 보내 왕복 한 번을 아낀다.
 */
let entering = null;

async function boot() {
  initTheme();
  initTabs();
  initStandingEvents();
  initAdminEvents();
  initHistoryEvents();
  initAccountEvents();
  initTournamentEvents();
  initBoardEvents();
  initScheduleEvents();
  initLauncherEvents();
  initCapEvents();
  initWhoEvents();
  initPlayingWatch();
  initSeatMenu();
  initMonthPickers();
  renderAuthBar();
  try {
    // 방 창은 들어가기를 먼저 띄워두고 확인과 나란히 기다린다
    if (isRoomWindow && readKey(TOKEN_KEY)) {
      authToken = readKey(TOKEN_KEY);
      entering = apiPost('/api/room', { action: 'enter', room: roomParam });
      // 아래에서 await 하기 전에 실패하면 "처리되지 않은 거부"로 잡히므로
      // 미리 한 번 받아둔다. 실제 처리는 bootRoomWindow 가 한다.
      entering.catch(() => {});
    }
    // 표를 먼저 확인해야 첫 화면부터 로그인한 사람으로 그려진다
    await restoreLogin();
    renderAuthBar();
    if (isRoomWindow) {
      await bootRoomWindow();
      window.addEventListener('pagehide', () => {
        clearRoomWindow();
        // 창을 닫는 중이라 응답을 기다릴 수 없다. keepalive 로 보내두고 끝낸다.
        // 이 요청이 못 가더라도 3분 뒤 서버가 알아서 자리를 비운다.
        try {
          fetch('/api/room', {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
            body: JSON.stringify({ action: 'leave' }),
          });
        } catch { /* noop */ }
      });
      return;
    }
    await refreshAll();
    // 초기 비밀번호를 그대로 쓰거나 이메일이 없으면 여기서도 창이 떠야 한다
    if (me) runRequiredSetup();
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
