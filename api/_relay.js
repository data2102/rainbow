import crypto from 'node:crypto';

/**
 * 중계 서버(relay/r6relay.sh 의 agent)를 부른다.
 *
 * 방장 지정(use)과 방장 등록(register)을 사이트가 대신 한다 — 예전에는 웹마스터가
 * 매번 ssh 로 `r6relay use` 를 쳤고, 방장이 바뀔 때마다 그게 어긋나 접속이 꼬였다.
 *
 * Vercel 환경변수 RELAY_SECRET 이 없으면 아무것도 하지 않는다(enabled() false).
 * 그 사이에는 예전처럼 웹마스터가 손으로 지정하면 된다.
 */
const URL_ = process.env.RELAY_URL || 'http://158.247.243.55:8723';
const SECRET = process.env.RELAY_SECRET || '';

export function relayEnabled() { return !!SECRET; }

/**
 * 사이트 아이디 → 중계 서버 이름. 서버 이름은 영문·숫자·_- 만 받는다.
 * 그대로 쓸 수 있으면 그대로(손으로 등록한 LOTUS_TeaRs 같은 이름과 이어진다),
 * 아니면 아이디에서 나온 고정된 이름을 쓴다.
 */
export function relayName(handle) {
  const h = String(handle || '');
  if (/^[A-Za-z0-9_-]{1,32}$/.test(h)) return h;
  return 'h_' + crypto.createHash('sha256').update(h).digest('hex').slice(0, 16);
}

export async function relayCall(action, payload = {}) {
  if (!SECRET) throw new Error('중계 서버 연결이 아직 설정되지 않았습니다. 웹마스터에게 알려주세요.');
  const raw = JSON.stringify({ ...payload, action, ts: Date.now() / 1000 });
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  let r;
  try {
    r = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-R6-Sig': sig },
      body: raw,
      signal: ctl.signal,
    });
  } catch {
    throw new Error('중계 서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error || `중계 서버 오류 (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return d;
}

/**
 * 방장 PC 등록용 일회 표. 로그인한 사람이 런쳐에서 받아 r6clan://register/<표> 로 넘긴다.
 * 방장 PC 의 설치 스크립트는 로그인 세션이 없으니 이 표로 누구인지 증명한다.
 * DB 를 쓰지 않으려고 서명으로 만든다. 15분 동안만 쓸 수 있다.
 */
const TOKEN_MS = 15 * 60 * 1000;
const b64u = s => Buffer.from(s).toString('base64url');

export function makeRegisterToken(handle) {
  const body = b64u(JSON.stringify({ h: String(handle), e: Date.now() + TOKEN_MS }));
  const sig = crypto.createHmac('sha256', 'reg:' + SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readRegisterToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !SECRET) return null;
  const want = crypto.createHmac('sha256', 'reg:' + SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!d.h || !(d.e > Date.now())) return null;
    return String(d.h);
  } catch { return null; }
}
