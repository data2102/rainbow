#!/usr/bin/env bash
# ============================================================
#  r6relay - Rainbow Six (1998) relay server for r6rank.co.kr
# ------------------------------------------------------------
#  Guests join the RELAY's public address. The relay hands
#  UDP 2346-2348 over to the host's PC through a WireGuard
#  tunnel that the HOST opened from the inside. So:
#    - guests install nothing (no Radmin)
#    - the host's router / CGNAT does not matter, because the
#      host only makes an outgoing connection
#
#     guests --UDP 2346-2348--> relay --wg0--> host PC
#
#  Usage (Ubuntu 22.04/24.04, as root):
#    sudo bash r6relay.sh setup        install + start
#    sudo r6relay add  <name>          make a host's tunnel file
#    sudo r6relay use  <name>          send games to this host
#    sudo r6relay off                  stop sending games
#    sudo r6relay status               who is connected, traffic
#    sudo r6relay list | remove <name>
#    sudo r6relay log [minutes]        what happened (default 30 min)
#    sudo r6relay update               fetch the latest script
#    sudo r6relay agent-setup          let the site drive this (prints the secret)
#    r6relay register <name> <pubkey>  (used by the agent) host made its own key
# ============================================================
set -euo pipefail

DIR=${R6_DIR:-/etc/r6relay}
WG=wg0
NET=10.66.0                # tunnel network, relay is .1
WG_PORT=51820
GAME_PORTS=2346:2348       # JOIN / ANNOUNCE / INFO
SELF=/usr/local/sbin/r6relay
LOGDIR=${R6_LOGDIR:-/var/log/r6relay}
LOG_SVC=r6relay-log
AGENT_SVC=r6relay-agent
AGENT_PORT=8723
AGENT_PY=/usr/local/lib/r6relay/agent.py

die()  { echo "  [X] $*" >&2; exit 1; }
# 누가 언제 방장이 됐는지. 접속 기록과 맞춰 봐야 "그때 누구에게 넘겼나"를 안다
event() { mkdir -p "$LOGDIR"; echo "$(TZ=Asia/Seoul date '+%F %T') $*" >> "$LOGDIR/events.log"; }
ok()   { echo "  [O] $*"; }
need_root() { [ "$(id -u)" -eq 0 ] || die "sudo 로 실행해 주세요."; }
wan_if() { ip -4 route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'; }
valid_name() { [[ "$1" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die "이름은 영문·숫자·_- 로 32자 이내여야 합니다: '$1'"; }

# 서버 설정 파일을 기본 칸 + 등록된 방장들로 다시 쓴다
write_conf() {
  {
    echo "[Interface]"
    echo "Address = $NET.1/24"
    echo "ListenPort = $WG_PORT"
    echo "PrivateKey = $(cat "$DIR/server.key")"
    echo "PostUp = $SELF apply"
    echo "PostDown = $SELF clear"
    for f in "$DIR"/hosts/*.peer; do [ -e "$f" ] && { echo; cat "$f"; }; done
  } > "/etc/wireguard/$WG.conf"
  chmod 600 "/etc/wireguard/$WG.conf"
}

# 실행 중이면 끊지 않고 방장 목록만 다시 읽힌다
reload() {
  write_conf
  if ip link show "$WG" >/dev/null 2>&1; then
    wg syncconf "$WG" <(wg-quick strip "$WG")
  fi
}

cmd_setup() {
  need_root
  echo "== 중계 서버 설치 =="
  # 서버를 처음 켤 때(시작 스크립트) 돌면 자동 업데이트가 apt 를 잡고 있다 - 풀릴 때까지 기다린다
  apt-get -o DPkg::Lock::Timeout=600 update -y >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y wireguard iptables curl >/dev/null
  ok "WireGuard 설치"

  install -d -m 700 "$DIR" "$DIR/hosts"
  [ -f "$DIR/server.key" ] || (umask 077; wg genkey > "$DIR/server.key")
  wg pubkey < "$DIR/server.key" > "$DIR/server.pub"
  if [ ! -s "$DIR/endpoint" ]; then
    curl -4 -fsS https://api.ipify.org > "$DIR/endpoint" || die "이 서버의 공인 IP 를 읽지 못했습니다. echo <IP> > $DIR/endpoint 로 적어 주세요."
  fi
  ok "서버 키 · 공인 IP $(cat "$DIR/endpoint")"

  # 받은 스크립트를 명령으로 설치해 두면 PostUp 과 사람이 같은 것을 부른다
  [ "$(readlink -f "$0")" = "$SELF" ] || install -m 755 "$0" "$SELF"

  # Vultr 등 일부 이미지는 ufw 가 켜져 있다. 우리 규칙이 앞에 서지만, ufw 를 다시 읽을 때도
  # 막히지 않도록 ufw 에도 같은 구멍을 적어 둔다
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "$WG_PORT/udp" >/dev/null
    ufw allow 2346:2348/udp >/dev/null
    ufw allow 2346:2348/tcp >/dev/null
    ok "ufw 에 UDP $WG_PORT · 2346-2348(UDP·TCP) 허용"
  fi

  echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-r6relay.conf
  sysctl -q -p /etc/sysctl.d/99-r6relay.conf
  ok "패킷 전달 켜기"

  ensure_log
  write_conf
  systemctl enable "wg-quick@$WG" >/dev/null 2>&1
  systemctl restart "wg-quick@$WG"
  ok "중계 시작 (부팅할 때도 자동으로 켜집니다)"
  echo
  echo "  다음 할 일:"
  echo "   1) 클라우드 방화벽에서 UDP $WG_PORT, UDP 2346-2348 을 열어 주세요."
  echo "   2) sudo r6relay add <방장이름>   으로 방장 터널 파일을 만드세요."
}

# 게임 포트로 오가는 것을 24시간 적어 둔다. 시험할 때 시간을 맞춰 tcpdump 를 돌리지
# 않아도, 나중에 'r6relay log' 로 그때 무슨 일이 있었는지 볼 수 있다.
# 터널(wg0) 쪽도 같이 적어서 "방장에게 넘어갔나 / 방장이 답했나"까지 보인다.
ensure_log() {
  [ -f "/etc/systemd/system/$LOG_SVC.service" ] && return 0
  command -v tcpdump >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y tcpdump >/dev/null
  mkdir -p "$LOGDIR"
  cat > "/etc/systemd/system/$LOG_SVC.service" <<UNIT
[Unit]
Description=r6relay game traffic log
After=network-online.target

[Service]
Environment=TZ=Asia/Seoul
ExecStart=/bin/sh -c 'exec $(command -v tcpdump) -ni any -l -tttt "portrange 2346-2348" >> $LOGDIR/traffic.log 2>/dev/null'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  cat > /etc/logrotate.d/r6relay <<ROT
$LOGDIR/*.log {
  daily
  rotate 7
  compress
  missingok
  notifempty
  copytruncate
}
ROT
  systemctl daemon-reload
  # 부팅 중 wg-quick 의 PostUp 에서 불릴 수 있다 — 기다리면 서로 막히므로 --no-block
  systemctl enable --now --no-block "$LOG_SVC" >/dev/null 2>&1 || true
  ok "접속 기록 시작 ($LOGDIR)"
}

# 게임 포트를 지금 방장에게 넘기는 규칙. 우리 체인만 만지므로 다른 규칙은 건드리지 않는다
cmd_apply() {
  ensure_log
  local wan host; wan=$(wan_if); [ -n "$wan" ] || die "인터넷 쪽 네트워크 장치를 찾지 못했습니다."
  host=$(cat "$DIR/current.ip" 2>/dev/null || true)

  for c in R6_IN R6_FWD; do iptables -N $c 2>/dev/null || true; iptables -F $c; done
  for c in R6_PRE R6_POST; do iptables -t nat -N $c 2>/dev/null || true; iptables -t nat -F $c; done
  # 맨 앞에 끼운다 - Oracle 기본 이미지는 끝에 REJECT 가 있어 뒤에 붙이면 막힌다
  iptables -C INPUT -j R6_IN 2>/dev/null       || iptables -I INPUT 1 -j R6_IN
  iptables -C FORWARD -j R6_FWD 2>/dev/null    || iptables -I FORWARD 1 -j R6_FWD
  iptables -t nat -C PREROUTING -j R6_PRE 2>/dev/null  || iptables -t nat -I PREROUTING 1 -j R6_PRE
  iptables -t nat -C POSTROUTING -j R6_POST 2>/dev/null || iptables -t nat -I POSTROUTING 1 -j R6_POST

  iptables -A R6_IN -p udp --dport "$WG_PORT" -j ACCEPT
  [ -s "$DIR/agent.secret" ] && iptables -A R6_IN -p tcp --dport "$AGENT_PORT" -j ACCEPT
  iptables -A R6_FWD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  if [ -n "$host" ]; then
    # 게임이 어느 쪽으로 붙는지 확인하지 못했다 — UDP 만 넘겼더니 접속이 한 개도 안 왔다.
    # TCP 와 UDP 를 둘 다 넘긴다.
    local proto
    for proto in udp tcp; do
      iptables -A R6_FWD -i "$wan" -o "$WG" -p "$proto" -d "$host" --dport $GAME_PORTS -j ACCEPT
      iptables -t nat -A R6_PRE -i "$wan" -p "$proto" --dport $GAME_PORTS -j DNAT --to-destination "$host"
      # 방장 PC 가 답을 다시 터널로 보내게 한다. 방장 쪽 라우팅을 건드리지 않아도 된다
      iptables -t nat -A R6_POST -o "$WG" -p "$proto" -d "$host" --dport $GAME_PORTS -j MASQUERADE
    done
  fi
}

cmd_clear() {
  iptables -D INPUT -j R6_IN 2>/dev/null || true
  iptables -D FORWARD -j R6_FWD 2>/dev/null || true
  iptables -t nat -D PREROUTING -j R6_PRE 2>/dev/null || true
  iptables -t nat -D POSTROUTING -j R6_POST 2>/dev/null || true
  for c in R6_IN R6_FWD; do iptables -F $c 2>/dev/null || true; iptables -X $c 2>/dev/null || true; done
  for c in R6_PRE R6_POST; do iptables -t nat -F $c 2>/dev/null || true; iptables -t nat -X $c 2>/dev/null || true; done
}

next_ip() {
  local used n
  used=$(cat "$DIR"/hosts/*.ip 2>/dev/null || true)
  for n in $(seq 2 254); do
    grep -qx "$NET.$n" <<<"$used" || { echo "$NET.$n"; return; }
  done
  die "자리가 다 찼습니다 (253명)."
}

cmd_add() {
  need_root; local name=${1:-}; [ -n "$name" ] || die "사용법: r6relay add <방장이름>"; valid_name "$name"
  [ -e "$DIR/hosts/$name.ip" ] && die "이미 있는 이름입니다: $name  (파일: $DIR/hosts/$name.conf)"
  # 고정 IP 는 설치 뒤에 붙이는 일이 많다. 방장 파일을 만들 때마다 지금 주소를 다시 읽는다
  local now; now=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  if [[ "$now" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ "$now" != "$(cat "$DIR/endpoint")" ]; then
    echo "$now" > "$DIR/endpoint"; ok "서버 주소가 바뀌어 $now 로 맞췄습니다."
  fi
  local key pub ip
  key=$(wg genkey); pub=$(wg pubkey <<<"$key"); ip=$(next_ip)
  echo "$ip" > "$DIR/hosts/$name.ip"
  printf '[Peer]\n# %s\nPublicKey = %s\nAllowedIPs = %s/32\n' "$name" "$pub" "$ip" > "$DIR/hosts/$name.peer"
  # 방장 PC 용 터널 파일. 터널로는 중계 서버 대역만 보낸다 - 방장의 다른 인터넷은 그대로다
  (umask 077; cat > "$DIR/hosts/$name.conf" <<CONF
[Interface]
PrivateKey = $key
Address = $ip/32

[Peer]
PublicKey = $(cat "$DIR/server.pub")
Endpoint = $(cat "$DIR/endpoint"):$WG_PORT
AllowedIPs = $NET.0/24
PersistentKeepalive = 25
CONF
)
  reload
  ok "$name 등록 ($ip)"
  event "add $name $ip"
  # 비밀키는 화면에 찍지 않는다 — 화면을 그대로 복사해 단톡방·채팅에 붙이는 일이 잦았다.
  echo
  echo "  방장 PC 용 설정(비밀키 포함)은 화면에 띄우지 않습니다. 맥에서 이렇게 복사하세요:"
  echo "    ssh r6 cat $DIR/hosts/$name.conf | pbcopy"
  echo "  그 방장에게만 1:1 로 보내세요."
}

# 방장 PC 가 스스로 만든 열쇠의 공개 반쪽만 받아 등록한다. 비밀키는 서버에 오지 않는다.
# 이미 있는 이름이면 주소는 그대로 두고 열쇠만 갈아 끼운다(다시 등록 = 열쇠 교체).
# 결과는 한 줄 JSON — 사이트 창구(agent)가 그대로 돌려준다.
cmd_register() {
  need_root
  local name=${1:-} pub=${2:-}
  valid_name "$name"
  [[ "$pub" =~ ^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$ ]] || die "공개키 형식이 아닙니다."
  local ip
  if [ -e "$DIR/hosts/$name.ip" ]; then
    ip=$(cat "$DIR/hosts/$name.ip")
  else
    ip=$(next_ip); echo "$ip" > "$DIR/hosts/$name.ip"
  fi
  printf '[Peer]\n# %s\nPublicKey = %s\nAllowedIPs = %s/32\n' "$name" "$pub" "$ip" > "$DIR/hosts/$name.peer"
  rm -f "$DIR/hosts/$name.conf"   # 예전 방식으로 서버가 만든 비밀키가 있었다면 지운다
  reload >/dev/null
  event "register $name $ip"
  printf '{"name":"%s","ip":"%s","serverKey":"%s","endpoint":"%s:%s"}\n' \
    "$name" "$ip" "$(cat "$DIR/server.pub")" "$(cat "$DIR/endpoint")" "$WG_PORT"
}

cmd_use() {
  need_root; local name=${1:-}; [ -n "$name" ] || die "사용법: r6relay use <방장이름>"; valid_name "$name"
  [ -e "$DIR/hosts/$name.ip" ] || die "등록되지 않은 방장입니다: $name"
  cp "$DIR/hosts/$name.ip" "$DIR/current.ip"; echo "$name" > "$DIR/current.name"
  event "use $name $(cat "$DIR/current.ip")"
  cmd_apply
  ok "이제 게임은 $name ($(cat "$DIR/current.ip")) 에게 갑니다."
  echo "  유저 접속 주소: $(cat "$DIR/endpoint")"
}

cmd_off() {
  need_root; rm -f "$DIR/current.ip" "$DIR/current.name"; cmd_apply; event "off"; ok "게임 넘기기를 멈췄습니다."
}

cmd_remove() {
  need_root; local name=${1:-}; valid_name "$name"
  [ -e "$DIR/hosts/$name.ip" ] || die "등록되지 않은 방장입니다: $name"
  [ "$(cat "$DIR/current.name" 2>/dev/null)" = "$name" ] && cmd_off
  rm -f "$DIR/hosts/$name".{ip,peer,conf}
  event "remove $name"
  reload; ok "$name 삭제"
}

cmd_list() {
  local f n
  for f in "$DIR"/hosts/*.ip; do
    [ -e "$f" ] || { echo "  등록된 방장이 없습니다."; return; }
    n=$(basename "$f" .ip); echo "  $n  $(cat "$f")"
  done
}

cmd_status() {
  need_root
  echo "  접속 주소   : $(cat "$DIR/endpoint" 2>/dev/null || echo '-')"
  echo "  지금 방장   : $(cat "$DIR/current.name" 2>/dev/null || echo '없음') $(cat "$DIR/current.ip" 2>/dev/null || true)"
  echo
  echo "  [방장 연결] latest handshake 가 2분 이내면 연결된 것입니다"
  wg show "$WG" 2>/dev/null | sed 's/^/    /' || echo "    중계가 꺼져 있습니다 (systemctl status wg-quick@$WG)"
  echo
  echo "  [게임 패킷] pkts 가 늘면 유저가 들어오고 있는 것입니다"
  iptables -t nat -L R6_PRE -v -n 2>/dev/null | sed 's/^/    /'
}

# 사이트(Vercel)만 부를 수 있는 작은 창구. 서명(HMAC)이 맞는 요청만 받는다.
# 하는 일은 셋뿐: 방장 등록(register), 방장 지정(use), 지금 방장 묻기(status).
cmd_agent_setup() {
  need_root
  [ -s "$DIR/agent.secret" ] || (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DIR/agent.secret")
  mkdir -p "$(dirname "$AGENT_PY")"
  cat > "$AGENT_PY" <<'PYAGENT'
import hashlib, hmac, json, os, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = open('/etc/r6relay/agent.secret', 'rb').read().strip()
CLI = '/usr/local/sbin/r6relay'
CUR = '/etc/r6relay/current.name'

def handshake_age(name):
    """Seconds since that host PC last talked to us, or None if it never did."""
    try:
        pub = ''
        for line in open(f'/etc/r6relay/hosts/{name}.peer'):
            if line.startswith('PublicKey'):
                pub = line.split('=', 1)[1].strip()
        out = subprocess.run(['wg', 'show', 'wg0', 'latest-handshakes'], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            k, _, t = line.partition('\t')
            if k.strip() == pub and t.strip().isdigit() and int(t) > 0:
                return int(time.time()) - int(t)
    except Exception:
        pass
    return None

def run(*args):
    p = subprocess.run([CLI, *args], capture_output=True, text=True, timeout=20)
    return p.returncode, (p.stdout or '').strip(), (p.stderr or '').strip()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 4096: return self.reply(400, {'error': 'bad size'})
        raw = self.rfile.read(n)
        sig = self.headers.get('X-R6-Sig', '')
        want = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, want): return self.reply(403, {'error': 'bad signature'})
        try: d = json.loads(raw)
        except Exception: return self.reply(400, {'error': 'bad json'})
        if abs(time.time() - float(d.get('ts', 0))) > 120: return self.reply(403, {'error': 'stale'})
        act = d.get('action'); name = str(d.get('name', ''))
        if act == 'status':
            cur = open(CUR).read().strip() if os.path.exists(CUR) else ''
            return self.reply(200, {'current': cur})
        if act == 'use':
            if not os.path.exists(f'/etc/r6relay/hosts/{name}.ip') or '/' in name:
                return self.reply(404, {'error': 'not registered'})
            # Registered but its PC is not on the tunnel (another PC, or never set up
            # by the new script): switching to it would send players nowhere.
            # The tunnel keeps alive every 25 s, so 3 minutes of silence means it is not there.
            age = handshake_age(name)
            if age is None or age > 180:
                return self.reply(409, {'error': 'not connected', 'age': age})
            rc, out, err = run('use', name)
            return self.reply(200 if rc == 0 else 500, {'ok': rc == 0} if rc == 0 else {'error': err or out})
        if act == 'register':
            rc, out, err = run('register', name, str(d.get('pubkey', '')))
            if rc != 0: return self.reply(400, {'error': err or out})
            return self.reply(200, json.loads(out.splitlines()[-1]))
        return self.reply(400, {'error': 'unknown action'})

ThreadingHTTPServer(('0.0.0.0', 8723), H).serve_forever()
PYAGENT
  cat > "/etc/systemd/system/$AGENT_SVC.service" <<UNIT
[Unit]
Description=r6relay site agent
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 $AGENT_PY
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable "$AGENT_SVC" >/dev/null 2>&1
  systemctl restart "$AGENT_SVC"
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "$AGENT_PORT/tcp" >/dev/null
  fi
  iptables -C R6_IN -p tcp --dport "$AGENT_PORT" -j ACCEPT 2>/dev/null || iptables -A R6_IN -p tcp --dport "$AGENT_PORT" -j ACCEPT 2>/dev/null || true
  event "agent-setup"
  ok "사이트 창구 시작 (TCP $AGENT_PORT)"
  echo
  echo "  Vercel 환경변수에 아래 두 값을 넣고 다시 배포하세요:"
  echo "    RELAY_URL    = http://$(cat "$DIR/endpoint"):$AGENT_PORT"
  echo "    RELAY_SECRET = $(cat "$DIR/agent.secret")"
}

# 최근 N 분 동안 무슨 일이 있었는지 사람 말로 풀어 보인다.
cmd_log() {
  need_root
  local mins=${1:-30}
  [[ "$mins" =~ ^[0-9]+$ ]] || { [ "$mins" = raw ] && { tail -n 80 "$LOGDIR/traffic.log" 2>/dev/null; return; }; die "사용법: r6relay log [분|raw]"; }
  [ -f "$LOGDIR/traffic.log" ] || die "아직 기록이 없습니다. 'r6relay apply' 를 한 번 실행했는지 확인하세요."
  local since; since=$(TZ=Asia/Seoul date -d "-$mins min" '+%F %T')
  python3 - "$since" "$LOGDIR/events.log" "$LOGDIR/traffic.log" "$(cat "$DIR/current.name" 2>/dev/null)" <<'PY'
import re, sys
from collections import defaultdict, OrderedDict
since, evf, trf, cur = sys.argv[1:5]
print(f"== {since[5:16]} 이후 ==   지금 방장: {cur or '없음'}")
print()
print("[방장 변경]")
n = 0
try:
    for line in open(evf, encoding="utf-8"):
        if line[:19] >= since:
            print("  " + line.rstrip()[5:]); n += 1
except FileNotFoundError:
    pass
if not n: print("  (없음)")
print()

pat = re.compile(r'^(\S+ \S+) (\S+)\s+(In|Out)\s+IP (\d+\.\d+\.\d+\.\d+)\.(\d+) > (\d+\.\d+\.\d+\.\d+)\.(\d+): (.*)$')
def kind(rest):
    m = re.search(r'Flags \[([^\]]+)\]', rest)
    if m:
        f = m.group(1)
        if f == 'S': return 'SYN'
        if f == 'S.': return 'SYN-ACK'
        if 'R' in f: return 'RST'
        return 'TCP'
    return 'UDP' if 'UDP' in rest else 'ETC'
def wg(ip): return ip.startswith('10.66.0.')

flows = OrderedDict()            # (guest ip, guest port) -> counters
by_port = {}                     # guest port -> key (MASQUERADE 가 보통 포트를 그대로 둔다)
host_first = []                  # 방장이 먼저 밖으로 보낸 것
for line in open(trf, encoding="utf-8", errors="replace"):
    m = pat.match(line)
    if not m or m.group(1)[:19] < since: continue
    ts, ifc, d, sip, sp, dip, dp, rest = m.groups()
    t = ts[11:19]; k = kind(rest)
    if ifc != 'wg0' and d == 'In' and not wg(sip):
        key = (sip, sp)
        f = flows.setdefault(key, {'first': t, 'last': t, 'port': dp, 'proto': 'TCP' if k != 'UDP' else 'UDP',
                                   'came': 0, 'fwd': 0, 'host': defaultdict(int), 'back': 0})
        f['came'] += 1; f['last'] = t; by_port[sp] = key
    elif ifc == 'wg0' and d == 'Out' and sip == '10.66.0.1':
        key = by_port.get(sp)
        if key: flows[key]['fwd'] += 1
    elif ifc == 'wg0' and d == 'In' and wg(sip):
        key = by_port.get(dp) if dip == '10.66.0.1' else None
        if key: flows[key]['host'][k] += 1
        else: host_first.append(f"  {t}  {sip}:{sp} -> {dip}:{dp}  {k}")
    elif ifc != 'wg0' and d == 'Out' and not wg(dip):
        key = (dip, dp)
        if key in flows: flows[key]['back'] += 1

print("[참가자 접속]")
if not flows:
    print("  (없음) - 이 시간 동안 중계 서버 2346~2348 로 온 접속이 하나도 없습니다.")
per_ip = OrderedDict()
for (ip, port), f in flows.items():
    per_ip.setdefault(ip, []).append(f)
for ip, fs in per_ip.items():
    came = sum(f['came'] for f in fs); fwd = sum(f['fwd'] for f in fs); back = sum(f['back'] for f in fs)
    host = defaultdict(int)
    for f in fs:
        for k2, v in f['host'].items(): host[k2] += v
    ports = sorted({f"{f['proto']} {f['port']}" for f in fs})
    print(f"  {ip}   {fs[0]['first']} ~ {fs[-1]['last']}   {', '.join(ports)}")
    hs = ', '.join(f"{k2} {v}" for k2, v in host.items()) or '없음'
    print(f"    도착 {came}  ->  방장에게 넘김 {fwd}  ->  방장 답 [{hs}]  ->  참가자에게 돌려줌 {back}")
    if fwd == 0:
        why = "방장이 지정돼 있지 않거나 넘기는 규칙이 없음 (r6relay use / apply 확인)"
    elif not host:
        why = "방장 PC 가 아무 답도 안 함 -> 방장 PC 방화벽·백신이 막거나 WireGuard 가 꺼짐"
    elif host.get('RST') and not host.get('SYN-ACK'):
        why = "방장 PC 가 '받을 게임이 없다'고 거절 -> 방장 게임이 대기 화면까지 안 떠 있음"
    elif back == 0:
        why = "방장은 답했는데 참가자에게 못 돌려줌 -> 중계 서버 규칙 문제 (알려 주세요)"
    else:
        why = "길은 끝까지 이어짐 -> 이래도 안 들어가지면 게임 쪽 문제"
    print(f"    => {why}")
print()
print("[방장이 먼저 밖으로 보낸 것]")
for l in host_first[-15:]: print(l)
if not host_first: print("  (없음)")
PY
}

case "${1:-}" in
  setup)  cmd_setup ;;
  add)    cmd_add "${2:-}" ;;
  use)    cmd_use "${2:-}" ;;
  off)    cmd_off ;;
  remove) cmd_remove "${2:-}" ;;
  list)   cmd_list ;;
  status) cmd_status ;;
  log)    cmd_log "${2:-}" ;;
  register) cmd_register "${2:-}" "${3:-}" ;;
  agent-setup) cmd_agent_setup ;;
  apply)  cmd_apply ;;
  update)
    need_root
    curl -fsSL https://raw.githubusercontent.com/data2102/rainbow/main/relay/r6relay.sh -o "$SELF.new" \
      && install -m 755 "$SELF.new" "$SELF" && rm -f "$SELF.new" || die "새 버전을 받지 못했습니다."
    if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
      ufw allow 2346:2348/tcp >/dev/null
    fi
    event "update"
    "$SELF" apply && ok "최신 규칙으로 다시 걸었습니다."
    # 창구를 이미 쓰고 있으면 새 코드로 다시 띄운다 (비밀값은 그대로)
    if [ -s "$DIR/agent.secret" ]; then "$SELF" agent-setup >/dev/null && ok "사이트 창구도 새로 띄웠습니다."; fi ;;
  clear)  cmd_clear ;;
  *) sed -n '2,25p' "$0" ;;
esac
