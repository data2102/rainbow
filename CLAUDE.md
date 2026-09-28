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
- 되돌릴 일에 대비한 백업 브랜치가 있다: `backup/font-before-logo`, `backup/garo-menu`,
  `backup/radmin-launcher`. **지우지 말 것.**

## 남은 일

- **Neon DB 비밀번호 교체** — 연결 문자열이 노출된 적이 있다. 아직 안 했다.
