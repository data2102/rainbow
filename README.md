# LADDER ZONE — r6rank.co.kr

레인보우 식스 클랜 래더 랭킹 사이트. 기존 HTML 한 장짜리 페이지를 **서버 + Postgres DB** 구조로 옮긴 버전입니다.
화면(디자인·탭·기능)은 원본 그대로이고, 데이터 저장 위치와 권한 처리만 바뀌었습니다.

| | 이전 | 현재 |
|---|---|---|
| 데이터 저장 | 브라우저 저장소 | Postgres DB |
| 점수 계산 | 브라우저(조작 가능) | 서버에서 계산 |
| 관리자 비밀번호 | 평문, 누구나 열람 가능 | scrypt 해시, 서버 보관 |
| 로그인 | 화면에서만 확인 | 서버 세션 토큰(12시간) |
| 접속 주소 | 파일 공유 | https://r6rank.co.kr |

---

## 폴더 구조

```
.
├── public/index.html       화면 (빌드 결과물 — 직접 고치지 말 것)
├── scripts/
│   ├── r6_ladder.html      디자인 원본 (CSS·마크업)
│   ├── app.js              프론트엔드 로직 (API 호출)
│   ├── build_index.py      원본 + app.js → public/index.html 생성
│   ├── setup.mjs           테이블 생성
│   ├── seed.mjs            시드 JSON → DB 적재
│   ├── admin.mjs           관리자 목록 조회 · 비밀번호 재설정 · ID 변경
│   └── recalc.mjs          기록된 경기로 선수 점수 재계산
├── api/
│   ├── _lib.js             DB연결·비밀번호해시·세션·점수규칙
│   ├── state.js            GET  공개 랭킹/기록 조회
│   ├── admin.js            POST 로그인·비번변경·관리자관리
│   ├── match.js            POST 경기 기록 (관리자)
│   ├── request.js          POST 가입·삭제 신청 / 승인·거절
│   ├── player.js           POST 회원 즉시 삭제 (관리자)
│   ├── tournament.js       GET/POST 대회 경기 기록
│   ├── post.js             GET/POST 기능 개선 게시판
│   └── data.js             GET/POST 내보내기·가져오기·초기화 (관리자)
├── installer/              레인보우 식스 통합 설치 파일 만들기 (installer/README.md)
│   ├── R6ClanSetup.iss     설치 파일 설계도 (Inno Setup)
│   ├── build.bat           더블클릭하면 R6ClanSetup.exe 를 만듭니다
│   └── payload/game/       완성된 게임 폴더를 넣는 자리 (저장소에 올라가지 않음)
├── db/schema.sql           테이블 정의
├── seed/ladder_seed.json   기존 데이터 (선수 29명 / 경기 41건) — 비밀번호 미포함
├── server.js               일반 서버용 진입점 (Vercel은 불필요)
├── vercel.json
└── .env.example
```

> ⚠️ **이 저장소는 공개(public)입니다.** 내보내기·백업 JSON에는 평문 비밀번호가 들어갈 수 있으므로
> 절대 커밋하지 마세요. `.gitignore`가 `ladder_backup*.json`을 막아두었습니다.
> 저장소의 `seed/ladder_seed.json`은 비밀번호를 제거한 파일입니다.

---

## 1. DB 만들기 (Neon · 무료)

1. https://neon.com 가입 → **Create project** (리전은 `AWS ap-northeast-1 (Tokyo)` 추천)
2. 대시보드의 **Connection string** 복사
   `postgresql://user:비번@ep-xxx.ap-northeast-1.aws.neon.tech/neondb?sslmode=require`

> Supabase, 카페24 PostgreSQL, 직접 세운 Postgres 모두 그대로 사용 가능합니다. 연결 문자열만 바꾸면 됩니다.

## 2. 로컬에서 테이블 생성 + 기존 데이터 적재

```bash
npm install

# 연결 문자열 지정
export DATABASE_URL="postgresql://...?sslmode=require"     # Windows: set DATABASE_URL=...

npm run db:setup     # 테이블 생성
npm run db:seed      # seed/ladder_seed.json 적재 (선수 29명 + 경기 41건)
npm start            # http://localhost:3000 에서 확인
```

`db:seed`는 구버전 1:1 기록(`winner`/`loser`)을 팀전 형식으로 자동 변환하고,
**관리자 9명의 임시 비밀번호를 그 자리에서 발급해 터미널에 한 번만 출력합니다.**
출력된 값을 각 관리자에게 개별 전달하고, 로그인 후 즉시 변경하게 하세요.

```
⚠ 아래 임시 비밀번호는 지금 이 화면에만 표시됩니다.
   ADMIN_TeaRs       R6-xxxxxxxx
   ADMIN_LeNa        R6-xxxxxxxx
   ...
```

실제로 쓰지 않는 계정은 ADMIN 탭에서 삭제하세요.

## 3. Vercel 배포

```bash
npm i -g vercel
vercel login
vercel                      # 프로젝트 생성 (Framework Preset: Other)
vercel env add DATABASE_URL # Production/Preview 모두에 추가
vercel --prod
```

GitHub에 올린 뒤 Vercel 대시보드에서 Import 해도 동일합니다.
**환경변수 `DATABASE_URL` 등록을 빠뜨리면 500 오류**가 납니다.

## 4. 도메인 연결 (후이즈 → Vercel)

Vercel 프로젝트 → **Settings → Domains** 에서 `r6rank.co.kr` 과 `www.r6rank.co.kr` 을 추가하면,
화면에 등록할 DNS 값이 표시됩니다.

후이즈 로그인 → **마이후이즈 → 도메인 관리 → r6rank.co.kr → DNS 관리(네임서버 정보 변경)** 에서:

| 타입 | 호스트 | 값 |
|---|---|---|
| A | `@` | Vercel 도메인 화면에 표시된 IP (보통 `76.76.21.21`) |
| CNAME | `www` | `cname.vercel-dns.com` |

> ⚠️ IP는 반드시 **Vercel 화면에 뜬 값**을 쓰세요. 신규 프로젝트는 `216.198.79.1` 같은 다른 주소가
> 배정되기도 하는데, 값이 다르면 도메인이 계속 Invalid 상태로 남습니다. AAAA(IPv6) 레코드는 만들지 마세요.

- 후이즈 기본 네임서버(`ns.whois.co.kr` 등)를 쓰는 상태여야 위 DNS 관리 메뉴가 열립니다.
- 반영까지 보통 10분~1시간, 최대 24시간. 반영되면 Vercel이 HTTPS 인증서를 자동 발급합니다.
- 확인: `nslookup r6rank.co.kr`

## 5. 배포 직후 필수 작업

1. `https://r6rank.co.kr` 접속 → **관리자 로그인** (`npm run db:seed`가 출력한 임시 비밀번호)
2. 로그인 후 **즉시 비밀번호 변경** (8자 이상)
3. 실제로 안 쓰는 관리자 계정은 ADMIN → 어드민 관리에서 삭제
4. ADMIN → 데이터 관리 → **내보내기**로 백업 한 번 받아두기 (받은 파일은 커밋 금지)

---

## 화면 수정하는 법

`public/index.html`은 **빌드 결과물**이라 직접 고치면 다음 빌드 때 덮어써집니다.

- 디자인(CSS·마크업)을 바꾼다 → `scripts/r6_ladder.html` 수정
- 동작(API 호출·렌더링)을 바꾼다 → `scripts/app.js` 수정

둘 중 하나를 고친 뒤:

```bash
python3 scripts/build_index.py
```

---

## 대안: Vercel 대신 일반 서버(VPS·카페24)

`server.js`가 정적 파일과 API를 함께 서빙하므로 그대로 올려도 됩니다.

```bash
npm install --production
DATABASE_URL="postgresql://..." PORT=3000 node server.js
# pm2 start server.js --name r6rank  (상시 구동)
```

이 경우 후이즈 DNS의 A 레코드 `@` 를 **서버 IP**로 지정하고,
nginx 리버스 프록시 + Let's Encrypt(certbot)로 HTTPS를 붙이면 됩니다.

---

## 통합 설치 파일

런쳐 탭은 지금 `r6clan-auto.reg` · `r6launch.bat` · `r6firewall.bat` 세 개를 각자 받아
직접 실행하게 안내합니다. 순서를 틀리거나 `r6launch.bat` 을 엉뚱한 폴더에 두는 일이 잦습니다.

`installer/` 는 이것을 **실행 파일 하나**로 묶습니다.

```bash
# 1. Inno Setup 설치 (한 번만) — https://jrsoftware.org/isdl.php
# 2. 완성된 게임 폴더의 내용을 installer/payload/game/ 에 통째로 복사
# 3. installer/build.bat 더블클릭
#    → installer/output/R6ClanSetup.exe
```

만들어진 설치 파일이 하는 일:

| | |
|---|---|
| 게임 본체 | 패치·맵·스킨·타겟·사운드가 이미 적용된 폴더를 그대로 풀어놓습니다 |
| `r6clan://` | 사이트 버튼이 게임을 켤 수 있게 등록합니다 (관리자 권한 실행 포함) |
| 런쳐 | `C:\R6Clan\` 에 배치 파일 4종을 넣습니다 |
| 경로 보정 | 배치 파일 안의 `GAME=` 줄을 **실제 설치 위치로 고쳐 씁니다** |
| 방화벽 | UDP 2346~2348 과 게임 실행 파일을 윈도우 방화벽에서 엽니다 |

받는 사람이 직접 해야 하는 것은 게임 안의 **MULTIPLAYER OPTIONS 설정**(런쳐 탭 4번)뿐입니다.

**게임을 설치 마법사로 깔지 않는 이유:** 1998년 InstallShield 설치 프로그램은 16비트라
64비트 윈도우에서 실행되지 않는 경우가 많습니다. 완성된 폴더를 통째로 옮기면 그 문제와
함께 패치·덮어쓰기 순서를 틀릴 여지도 사라집니다.

**배포:** 결과물은 크기 때문에 이 저장소나 Vercel 에 올릴 수 없습니다
(`.gitignore` 가 `installer/payload/`, `installer/output/` 을 막아둡니다).
외부 저장소에 올리고 런쳐 탭에는 링크만 거세요.

자세한 절차와 막히는 곳: `installer/README.md`


## 게시판 (기능 개선)

⑤ BOARD 탭에서 누구나 개선 의견을 남길 수 있습니다.

- 작성 시 **ID** 와 **숫자 4자리 비밀번호**가 필요합니다.
- **수정은 글쓴이만** 할 수 있습니다. 비밀번호를 알아야 하며 관리자도 예외가 아닙니다.
- **삭제는 글쓴이(비밀번호) 또는 관리자**가 할 수 있습니다.
- 관리자는 목록에서 여러 글을 골라 **선택 삭제**하거나 **전체 삭제**할 수 있습니다.
- 글마다 **댓글**을 달 수 있습니다. 댓글도 ID 와 숫자 4자리 비밀번호가 필요하고,
  글쓴이(비밀번호) 또는 관리자가 삭제할 수 있습니다.
- **글을 삭제하면 그 글의 댓글도 함께 사라집니다** (DB 의 ON DELETE CASCADE).
- 비밀번호는 scrypt 해시로 저장되며 API 응답에 절대 포함되지 않습니다.

> 4자리 비밀번호는 조합이 1만 개뿐이라 강한 보호 수단이 아닙니다. 글 내용이
> 민감하지 않고 관리자가 언제든 정리할 수 있다는 전제로 택한 방식입니다.

---

## 점수 규칙을 바꿨을 때 — 과거 경기 재계산

`winGain` / `lossGain` 을 고치면 **그 뒤에 기록하는 경기부터** 새 규칙이 적용됩니다.
이미 쌓인 경기까지 새 기준으로 맞추려면 재계산이 필요합니다.

```bash
export DATABASE_URL="postgresql://..."     # Windows: $env:DATABASE_URL="..."

npm run recalc          # 미리보기 — DB 를 바꾸지 않습니다
npm run recalc:apply    # 실제로 반영
```

미리보기는 선수별 현재 점수 → 재계산 점수와 순위 변화를 보여줍니다. 결과를
확인한 뒤 `recalc:apply` 로 반영하세요.

- **승리 점수는 경기에 기록된 값(`gained`)을 그대로 씁니다.** 당시 연승 보너스가
  반영된 값이라, 다시 계산하면 과거 기록이 달라집니다. 패배 점수만 현재
  규칙으로 다시 매깁니다.
- **승·패·연승·최근 결과도 경기 기록에 맞춰 함께 정리합니다.** 모두 경기에서
  나오는 값이라, 어긋나 있으면 화면의 승률과 연승 표시가 실제 기록과 달라집니다.
  어긋난 선수가 있으면 미리보기에서 현재 값과 재계산 값을 나란히 보여줍니다.
- 되돌릴 수 없습니다. 실행 전에 ADMIN → 데이터 관리 → **내보내기**로 백업하세요.
  변경 전 점수는 `audit_log` 의 `recalc_points_cli` 에도 남습니다.

---

## 관리자 비밀번호를 잊었을 때

비밀번호는 scrypt 해시로만 저장되어 되돌려볼 수 없습니다. 대신 재발급합니다.

```bash
export DATABASE_URL="postgresql://..."     # Windows: $env:DATABASE_URL="..."

npm run admin                                  # 관리자 목록과 각자의 상태 보기
npm run admin:reset ADMIN_TeaRs                # 해당 계정만 임시 비밀번호로 되돌리기
npm run admin:reset-all                        # 전원 임시 비밀번호로 되돌리기
npm run admin:rename ADMIN_Old ADMIN_New       # ID 변경 (비밀번호 유지)
```

임시 비밀번호는 `1234` 입니다 (`api/_lib.js` 의 `TEMP_PASSWORD`).
모바일에서 입력하기 쉽도록 짧게 두었고, 이 값으로 로그인하면 **비밀번호 변경 창이
강제로 뜨며 8자 이상으로 바꿔야** 이용할 수 있습니다.

> ⚠️ 임시 비밀번호가 알려진 값이므로, 아직 변경하지 않은 계정은 누구나 로그인할 수
> 있습니다. 계정을 만들거나 되돌린 뒤에는 본인이 바로 변경하게 하세요.

- **선수 명단과 경기 기록은 전혀 건드리지 않습니다.** 해당 계정의 비밀번호만 바뀝니다.
- 그 계정으로 열려 있던 **기존 로그인 세션은 모두 종료**됩니다.
- 재발급된 계정은 첫 로그인 시 **비밀번호 변경 창이 강제로** 뜹니다.
- 실행 기록은 `audit_log` 테이블에 `reset_password_cli` 로 남습니다.

**관리자 ID 는 대소문자를 가리지 않습니다.** `admin_tears` 로 입력해도 `ADMIN_TeaRs`
로 로그인됩니다. 대신 대소문자만 다른 ID 는 새로 만들 수 없습니다.

## 회원 수정 · 삭제

ADMIN 탭의 **회원 관리**에서 회원의 ID와 클랜을 고치거나 명단에서 바로 삭제할 수 있습니다.

**ID를 바꾸면 지난 경기 기록에 남은 이름도 함께 바뀝니다.** 명단에서만 고치면
HISTORY 에 STANDING 에는 없는 이름이 남아 탈퇴한 사람처럼 보이기 때문입니다.
점수와 전적은 그대로 유지됩니다.

삭제는 '회원 삭제 요청 → 승인' 절차를 거치지 않는 즉시 삭제입니다.

지난 경기 기록(`matches`)은 지우지 않습니다. 기록까지 사라지면 다른 선수들의
전적과 어긋나기 때문에, HISTORY 탭에는 그대로 남습니다.

> `npm run db:seed` 를 다시 돌리는 것으로도 비밀번호가 재발급되지만,
> **경기 기록이 시드 시점으로 되돌아가므로 운영 중에는 절대 쓰지 마세요.**
> 운영 중에는 위 `admin:reset` 을 쓰면 됩니다.

---

## 운영 메모

- **점수 규칙** (`api/_lib.js`의 `winGain` / `lossGain`): 승 +3 / 패 +1 / 3연승 +1 / 5연승 +2.
  규칙을 바꾸려면 이 두 함수만 수정하면 됩니다.
- **경기 기록은 트랜잭션 + 행 잠금**으로 처리돼, 두 관리자가 동시에 기록해도 점수가 꼬이지 않습니다.
- **감사 로그**: 로그인·기록·승인·삭제가 `audit_log` 테이블에 남습니다.
  `SELECT * FROM audit_log ORDER BY ts DESC LIMIT 50;`
- **내보내기 파일에는 비밀번호가 포함되지 않습니다.** DB 자체 백업은 Neon의 백업 기능이나 `pg_dump`를 쓰세요.
- STANDING 탭은 30초마다 자동 갱신됩니다.
- 관리자 로그인 상태는 새로고침하면 풀립니다(토큰을 브라우저에 저장하지 않음). 공용 PC 대비 설정입니다.

## 검증된 동작 (로컬 Postgres 16 테스트 완료)

- 시드 적재: 선수 29명 / 경기 41건(구버전 23건 자동 변환) / 관리자 9명 / 대기요청 1건
- 관리자 로그인·로그아웃, 세션 만료 후 401, 잘못된 비밀번호 거부
- 비로그인 상태의 경기 기록·승인 요청 차단
- 같은 선수 양팀 중복, 명단에 없는 선수 차단
- 연승 보너스 및 승/패 포인트 반영
- 가입/삭제 신청 → 승인 → 명단 반영
- 내보내기 → 초기화 → 가져오기 왕복 복구 (총점 일치)
- 브라우저에서 4개 탭 렌더링 및 관리자 로그인 플로우 (콘솔 에러 없음)
- 비밀번호 재발급 후 옛 비밀번호 거부 · 새 비밀번호 로그인 · 기존 세션 무효화 ·
  선수/경기 데이터 및 다른 관리자 계정 무변화
