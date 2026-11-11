# CLAUDE.md — 이 저장소를 다룰 때 알아둘 것

## 인프라 구성

| | 서비스 | 플랜 | 비고 |
|---|---|---|---|
| 호스팅 | Vercel | **Hobby(무료)** | 계정 `rainbow14` · 서버리스 함수 11/12개 사용 중 |
| DB | **Neon** Postgres | Free ↔ Launch | 프로젝트 `neon-rose-curtain` · AWS Singapore |

- Neon 구독은 **Vercel을 통해 관리**된다 (`Neon subscription managed by Vercel`).
  플랜 변경 경로: **Vercel → Integrations → Neon → Settings → Change Plan**.
  Neon 콘솔에서도 우측 상단 Upgrade 를 누르면 같은 곳으로 넘어간다.
- 코드는 `DATABASE_URL` 하나만 읽으므로 공급자는 갈아끼울 수 있다.

### 요금제 수치 (2026-09 확인)

| | Free | Launch | Scale |
|---|---|---|---|
| 컴퓨트 | **100 CU-hours/프로젝트** (한도, 넘으면 정지) | **$0.106/CU-hour** | $0.222/CU-hour |
| 저장소 | 0.5 GB | $0.35/GB-월 | $0.35/GB-월 |
| 크기 | 2 CU | 16 CU | 56 CU |

- Vercel 경유 Neon은 **월 기본료가 없는 순수 종량제**다. 세금은 별도(`Plus applicable tax and fees`).
- 청구 주기는 **달력 기준(매월 1일~1일)**. 결제 주기는 UTC 이므로 한국시간 오전 9시쯤 넘어간다.
- Free ↔ Launch 는 자유롭게 오갈 수 있다. 한 달만 쓰고 내리는 것도 된다.

---

## 2026-09-28 장애 — Neon 컴퓨트 한도 초과로 사이트 전면 정지

### 증상
- 로그인 창을 비롯해 모든 화면에 빨간 글씨로
  `Your account or project has exceeded the quota. Upgrade your plan to increase limits.`
- **페이지 자체는 뜨는데 데이터만 안 나온다** — Vercel 은 멀쩡하고 DB 만 죽은 모습.
  `api/account.js` 등이 DB 오류 메시지를 그대로 `res.json({error: e.message})` 로 내보내기 때문에
  Neon 의 오류 문구가 화면에 그대로 보인다.

### 원인
**자동 갱신 폴링이 DB 를 재우지 못했다.**

- Neon 은 5분간 요청이 없으면 컴퓨트를 재운다(scale to zero). 요금은 **깨어 있던 시간**으로 매긴다.
- 그런데 순위 탭은 **30초마다**, 런쳐 탭은 **2초마다** DB 를 불렀고,
  이 부름은 **탭을 뒤에 켜둔 채 자리를 떠도 계속됐다.**
- 결과: 9월 1~28일(667시간) 중 **약 441시간(하루 16시간)** 깨어 있었다.
  110.23 CU-hrs 사용 → 한도 100 초과 → 프로젝트 정지.

### 진단하는 법 (다음에 비슷한 일이 생기면)
1. 화면의 오류 문구가 **우리 말투가 아니면** 외부 서비스가 보낸 것이다. 그대로 검색해볼 것.
2. Neon 콘솔 → **Billing / Usage** 에서 어느 항목이 찼는지 본다.
   `Limit reached` 배너에 어느 한도인지 적혀 있다.
3. 항목별 판단:
   - **Compute** → 폴링·자동 갱신이 DB 를 못 재운 것. 코드 문제.
   - **Storage** → 사진첩·자료실이 DB 에 파일을 통째로 넣는 구조 때문.
   - **Network transfer** → 사진 썸네일 전송.

### 해결
- 즉시 복구: **Launch 로 전환**(종량제). 9월 남은 3일치 약 $2. 결제 후 1~2분 내 복구됨.
- **이미 쓴 사용량은 어떤 방법으로도 되돌릴 수 없다.** 초기화는 결제 주기 변경(1일)뿐.
- 새 Neon 프로젝트를 만들어 갈아타는 것은 **안 된다** — 데이터를 꺼내려면 멈춰 있는
  컴퓨트를 켜야 하는데 그게 불가능하다.

### 재발 방지 (APP_VERSION 71, `scripts/app.js`)
```js
const STANDING_POLL_MS = 120000;       // 순위 자동 갱신 30초 → 2분
const IDLE_STOP_MS = 10 * 60 * 1000;   // 10분간 조작 없으면 멈춤
function pageVisible() { return document.visibilityState !== 'hidden'; }
function idleAway()    { return Date.now() - lastTouchAt > IDLE_STOP_MS; }
```
- 화면이 가려졌거나(`!pageVisible()`) 자리를 뜨면(`idleAway()`) 자동 갱신을 건너뛴다.
- 돌아오면 `visibilitychange` 에서 `refreshVisibleTab()` 이 **곧바로 한 번** 받아온다 →
  사용자는 멈췄다는 것조차 느끼지 못한다.
- **런쳐는 예외 처리가 필요하다.** 이 폴링은 "아직 여기 있다"는 자리 신호를 겸하고,
  서버는 3분(`IDLE_MS`) 조용하면 방에서 뺀다. 그래서:
  - 게임 중(`playing()`)이면 화면이 가려져도 계속 부른다 — 전체화면에 가린 것뿐이다.
  - 방에 있고 방금까지 움직였으면 1분에 한 번만.
  - 방 밖이거나 한참 자리를 비웠으면 안 부른다.

### 점검 기준
- Free 예산: **100 CU-hrs ÷ 31일 = 하루 3.2 CU-hrs** (0.25 CU 기준 **하루 약 13시간**)
- 월초 점검: **5일까지 16 CU-hrs 이하면 안전** (100÷31×5)
- 주의: 컴퓨트가 0.25 CU 위로 오토스케일하면 같은 1시간이 더 비싸다 (Free 는 최대 2 CU).

---

## 기능별 DB 부담 (2026-09 기준, 무거운 순서)

| 기능 | 한 번 열 때 | 반복 |
|---|---|---|
| **런쳐** | 폴링 1회당 쿼리 8~10개 × **2초마다** = 분당 약 270개 | 탭을 연 내내 |
| **궁합**(선수 카드) | 3개, 그중 하나가 `matches` **전체 스캔**(JSONB `@>`, 인덱스 없음) | 누를 때마다 |
| **사진첩** | 목록 2개 + **썸네일 1장당 1개**(한 쪽 20장) | 첫 방문만 (하루 캐시) |
| **자료실** | 게시판 요청에 얹혀 옴 + 내려받기 1건당 1개 | 거의 없음 |
| **룰렛 & 리폿**(호스트뽑기) | 기록 목록 1개 · 한 판 뽑을 때 3~4개(트랜잭션) · 결과 등록 1건 | 폴링 없음 |

**단, 요금은 횟수가 아니라 깨어 있던 시간으로 매겨진다.** 메뉴를 없애는 것은 대부분 헛수고다.
런쳐도 **탭을 선택하지 않으면 한 번도 부르지 않는다**(`panel.classList.contains('active')` 검사).

### 더 줄여야 할 때 쓸 카드 (효과 큰 순서)
1. ~~안 보는 화면 폴링 차단~~ ← **완료(v71). 효과의 90%**
2. `matches` 에 GIN 인덱스 추가 → 궁합 전체 스캔 제거. 작업 10분, 위험 없음
3. 런쳐 폴링 2초 → 4초 (체감 차이 거의 없음)
4. 순위 응답을 Vercel 쪽에 짧게 캐시 → 동시 접속자가 DB 를 한 번만 부르게
5. 사진·자료 파일을 DB 밖(Vercel Blob)으로 → Storage·Transfer 를 Neon 에서 분리

---

## 시즌 마감은 자동이다

`api/_season.js` 의 `ensureSeason()` 이 **달이 바뀐 뒤 첫 요청**에서
지난 시즌 스냅샷 저장 → 마감 → 성적 리셋 → 새 시즌 생성을 한꺼번에 처리한다.
한 달 넘게 아무도 안 들어와도 순서대로 처리되므로, **장애로 며칠 멈춰도 기록은 날아가지 않는다.**

다만 **경기 기록은 등록하는 시점의 시각으로 저장된다**(`ts = Date.now()`, 소급 입력 기능 없음).
장애가 월말에 걸치면 그 기간 경기는 다음 달 시즌으로 들어간다. 필요하면 관리자용 날짜 지정
입력 기능을 만들어야 한다.

---

## 손댈 때 지킬 것

- 개발은 `claude/html-site-server-db-8w210v`, 배포는 `main`(Vercel 이 여기서 배포).
- `scripts/r6_ladder.html`(디자인·마크업) + `scripts/app.js`(동작)을 고치고
  **반드시 `python3 scripts/build_index.py`** 로 `public/index.html` 을 다시 만든다.
- `scripts/app.js` 와 `api/room.js` 의 `APP_VERSION` 은 **항상 같은 값**이어야 하고, 배포마다 올린다.
- **Vercel Hobby 는 서버리스 함수 12개가 상한**이다. 지금 11개이므로 새 API 는
  기존 파일(예: `api/post.js`)에 합쳐야 한다.
  호스트 뽑기가 `api/match.js` 에 얹혀 있는 것도 이 때문이다 (GET 은 기록 조회,
  POST `action:'host'`/`'hostResult'`).
- **호스트 뽑기는 팀도 호스트도 서버가 정한다**(`splitTeams`, `pickOne`).
  화면에서 정해 올리게 두면 돌리는 사람이 짤 수 있어 기록을 남기는 뜻이 없어진다.
  점수 계산은 리폿과 같은 `recordCore()` 를 쓰므로 어느 쪽으로 넣든 결과가 같다.
- 되돌릴 일에 대비한 백업 브랜치가 있다: `backup/font-before-logo`, `backup/garo-menu`,
  `backup/radmin-launcher`. **지우지 말 것.**

## 중계 서버 (`relay/`)

Radmin 없이 접속하려고 만든 UDP 중계. Vercel 은 UDP 를 못 받으므로 **별도 VPS** 에서 돈다.
방장만 WireGuard 로 중계 서버에 붙고, 유저는 중계 서버 공인 IP:2346 으로 들어온다.
서버가 2346~2348 을 DNAT 로 방장 터널 주소에 넘기고 MASQUERADE 로 답을 되돌린다.

- 규칙은 `R6_*` 체인 안에만 둔다. INPUT·FORWARD **맨 앞**에 끼우는 건 Oracle 기본 이미지의
  끝 REJECT 때문이다.
- **런쳐의 접속 주소는 중계 서버로 고정이다**(`api/room.js` 의 `RELAY_ADDRESS`, v125).
  방장이 주소를 적던 Radmin 방식은 화면에서 걷어냈다. 그래서 **중계 서버에 등록되고
  `r6relay use` 로 지정된 방장만** 방을 열 수 있다 — 다른 사람이 열면 유저들이 지정된 방장 PC 로 간다.
- **게임은 JOIN 을 TCP 2346 으로 한다**(2026-11-05 실측). 그래서 중계도 방화벽(`r6firewall.bat`)도
  TCP·UDP 둘 다 연다. UDP 만 넘기던 동안 참가자는 Connecting 에서 멈췄다.
- 원인을 찾을 때는 **`r6relay log`** 부터 본다. 게임 포트 통신과 `use` 변경이 24시간 기록된다.
  "방장에게 넘김 0 / 방장 답 없음 / 방장 RST" 로 어느 구간에서 끊겼는지 갈린다.
- **방장 게임은 집 공유기 주소(192.168.x.x)에서만 TCP 2346 을 연다**(netstat 실측, 0.0.0.0 아님).
  그래서 터널 주소로 온 접속은 RST 로 거절된다. 방장 PC 에 `netsh interface portproxy` 로
  터널 주소:2346 → 집 주소:2346 을 걸어서 처음 접속에 성공했다(2026-11-05). 집 주소가 바뀌면 다시 걸어야 한다 —
  런쳐가 자동으로 하게 만드는 게 다음 일이다.
- `r6relay add` 는 비밀키를 화면에 찍지 않는다(채팅에 붙여 넣는 일이 잦았다).
- **자동 운영(v129):** 사이트 ↔ 중계 서버는 `relay` agent(TCP 8723, HMAC 서명, `api/_relay.js`)로 이야기한다.
  실행하기 → `use`, [방장 등록하기] → 15분 일회 표 → `r6clan://register/<표>` → `r6launch.bat` →
  `public/r6host.ps1`(관리자) 가 WireGuard·열쇠·방화벽·감시 작업을 깐다. 비밀키는 방장 PC 밖으로 안 나간다.
  Vercel 환경변수 `RELAY_SECRET` 이 없으면 relay 호출을 건너뛴다(예전처럼 손으로 use).
- **방장 준비는 실행하기에 붙어 있다(v137).** 실행하기 → agent `use` 가 404(등록 없음) 또는 409(등록은 됐는데
  그 PC 가 3분 넘게 터널에 없음 — 다른 PC·꺼진 터널)면 사이트가 `needSetup` + 일회 표를 돌려주고, 화면이
  준비 창을 연 뒤 5초마다 실행을 다시 시도해 붙으면 저절로 실행한다(`hostSetupFlow`). [방장 PC 다시 준비하기]
  버튼은 문제 있을 때만. 예전 `r6launch.bat` 은 register 를 몰라 준비 대신 게임을 띄운다 — 방장은 최신 bat 필요.
- 사이트 아이디가 영문·숫자·_- 가 아니면 중계 서버 이름은 `h_` + 해시 16자리(`relayName`).
- **설치는 `public/r6setup.bat` 하나(v139).** 관리자 확인 한 번으로 `C:\R6Clan` + 런쳐, r6clan:// 등록(HKLM·HKCU 둘 다),
  게임 RUNASADMIN, 방화벽(게임 + TCP/UDP 2346-2418)을 한다. 예전 ①②③(reg·bat·firewall)은 '예전 방식'으로 접어 뒀다.
- **`r6launch.bat` 은 이제 바뀌지 않는 시작 파일**이다. 누를 때마다 사이트의 `public/r6main.bat`(실제 런쳐, 첫 줄 뒤
  `rem R6MAIN` 표시)을 받아 `call` 한다. 받기 실패·이상한 파일이면 지난번 것을 쓴다. **런쳐 동작을 고칠 때는
  `r6main.bat` 을 고친다** — 회원은 다시 받을 필요가 없다. 예전 통짜 `r6launch.bat` 을 가진 회원은 r6setup 한 번이 필요.
- `r6host.ps1` 과 `r6launch.bat` 는 ASCII 만 쓴다. Windows PowerShell 5 는 BOM 없는 파일을 ANSI 로 읽는다.
- **여러 방 동시 운영(v138, A 방식):** 방 N 의 바깥 포트는 `2346+10*(N-1)` ~ +2 (1번방 2346, 2번방 2356 … 8번방 2416).
  중계 서버가 방마다 그 방 방장 터널 주소의 2346~2348 로 한 칸씩 짝지어 DNAT 한다(`rooms/N.ip|name`).
  실행하기 → `use <이름> <방>`. 1번방 주소는 포트를 안 붙여 예전 런쳐도 된다. 2번방부터는 `IP:포트` 로 넘기고
  `r6launch.bat` 의 `:readip` 이 포트를 읽는다 — **참가자도 최신 bat 필요**. 방장 PC 는 늘 자기 2346.
  시뮬레이션으로 두 방이 각자 방장에게 가는 것은 확인했다. **게임이 2346 아닌 포트로 JOIN 하는 건 실게임 미확인** —
  안 되면 B 방식(방마다 공인 IP)으로.

## 남은 일

### 중계 서버 — 다음 순서 (2026-11-06 합의)

**먼저 확인할 것 (이게 끝나야 다음으로 간다)**
1. **실행하기 → 방장 자동 지정**: `ssh r6 r6relay use TEST` 로 돌려 놓고 TeaRs 가 실행하기 →
   `r6relay status` 가 `LOTUS_TeaRs` 로 바뀌는지.
2. **[방장 등록하기]**: Windows 에서 아직 한 번도 안 돌렸다. TeaRs PC 에서 최신 `r6launch.bat` →
   버튼 → 창에 `DONE`. 실패하면 창 화면과 `C:\R6Clan\r6host.log` 를 받아 `public/r6host.ps1` 를 고친다.
3. **렉 실제 테스트**: 회원들과 여러 판, Radmin 때와 체감 비교. 사용자는 **렉이 없는 게 확인된 뒤에**
   다방(多房)으로 가자고 했다.

**여러 방 동시 운영 — A 방식으로 v138 에 만들었다(사용자가 테스트 전에 두 방을 열 수 있게 해 달라고 했다). 아래는 설계 메모**
- 1번방 `158.247.243.55:2346`, 2번방 `:2356`, 3번방 `:2366` … (10 단위, 방마다 2346~2348 세 칸).
  중계 서버가 각 문을 그 방 방장 터널 주소의 2346~2348 로 DNAT(포트 바꿔 넘김).
- B 방식(방마다 공인 IP 추가, 월 IP당 약 $3)은 게임이 2346 아닌 포트를 못 받을 때만 쓴다.
- **구현 전 5분 시험:** 중계 서버에 2356→방장:2346 규칙을 손으로 하나 걸고, 참가자가 게임
  MULTIPLAYER → MANUAL JOIN 에 `158.247.243.55` / `2356` 으로 들어가지는지. 되면 A 확정.
- 바꿀 곳
  - `relay/r6relay.sh`: 방 번호별 현재 방장(`current.N`), `use <name> <room>`, R6_PRE 를 방마다.
    `r6relay log` 도 포트로 방을 가른다. agent 의 `use` 에 room 추가.
  - `api/room.js` `start()`: `relayCall('use', { name, room })`, 응답·`room_state.address` 에 포트 포함.
  - `scripts/app.js` `launchGame`: join url 에 포트(`r6clan://join/IP:PORT`).
  - `public/r6launch.bat`: `:readip` 이 지금 `:` 뒤를 버린다 — 포트를 읽어 `-client IP PORT` 로.
    **참가자도 최신 `r6launch.bat` 이 필요해진다**(공지 필요). 예전 bat 은 포트를 버리고 2346=1번방으로 간다.
- 방장 PC 쪽(`r6host.ps1`, portproxy)은 그대로 — 방장은 늘 자기 PC 의 2346 으로 연다.
- 비용 추가 없음(서버 한 대, $6). 트래픽은 `r6relay log`·Vultr 그래프로 본다.

**보안 메모**
- `RELAY_SECRET` 과 LOTUS_TeaRs·LOTUS_NaiLaRt·TEST 의 WireGuard 비밀키가 작업 채팅에 노출된 적이 있다.
  사용자는 당장은 그대로 쓰기로 했다. 바꿀 때: `ssh r6 "rm /etc/r6relay/agent.secret && r6relay agent-setup"` →
  Vercel `RELAY_SECRET` 교체 → Redeploy. 방장 열쇠는 [방장 등록하기]를 다시 누르면 새로 바뀐다.

- **Neon DB 비밀번호 교체** — 연결 문자열이 노출된 적이 있다. 아직 안 했다.
