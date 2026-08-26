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
│   └── seed.mjs            시드 JSON → DB 적재
├── api/
│   ├── _lib.js             DB연결·비밀번호해시·세션·점수규칙
│   ├── state.js            GET  공개 랭킹/기록 조회
│   ├── admin.js            POST 로그인·비번변경·관리자관리
│   ├── match.js            POST 경기 기록 (관리자)
│   ├── request.js          POST 가입·삭제 신청 / 승인·거절
│   └── data.js             GET/POST 내보내기·가져오기·초기화 (관리자)
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

## 운영 메모

- **점수 규칙** (`api/_lib.js`의 `winGain`): 승 +3 / 패 −1 / 3연승 +1 / 5연승 +2. 규칙을 바꾸려면 이 함수만 수정.
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
