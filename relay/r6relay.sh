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
# ============================================================
set -euo pipefail

DIR=${R6_DIR:-/etc/r6relay}
WG=wg0
NET=10.66.0                # tunnel network, relay is .1
WG_PORT=51820
GAME_PORTS=2346:2348       # JOIN / ANNOUNCE / INFO
SELF=/usr/local/sbin/r6relay

die()  { echo "  [X] $*" >&2; exit 1; }
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

  echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-r6relay.conf
  sysctl -q -p /etc/sysctl.d/99-r6relay.conf
  ok "패킷 전달 켜기"

  write_conf
  systemctl enable "wg-quick@$WG" >/dev/null 2>&1
  systemctl restart "wg-quick@$WG"
  ok "중계 시작 (부팅할 때도 자동으로 켜집니다)"
  echo
  echo "  다음 할 일:"
  echo "   1) 클라우드 방화벽에서 UDP $WG_PORT, UDP 2346-2348 을 열어 주세요."
  echo "   2) sudo r6relay add <방장이름>   으로 방장 터널 파일을 만드세요."
}

# 게임 포트를 지금 방장에게 넘기는 규칙. 우리 체인만 만지므로 다른 규칙은 건드리지 않는다
cmd_apply() {
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
  iptables -A R6_FWD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  if [ -n "$host" ]; then
    iptables -A R6_FWD -i "$wan" -o "$WG" -p udp -d "$host" --dport $GAME_PORTS -j ACCEPT
    iptables -t nat -A R6_PRE -i "$wan" -p udp --dport $GAME_PORTS -j DNAT --to-destination "$host"
    # 방장 PC 가 답을 다시 터널로 보내게 한다. 방장 쪽 라우팅을 건드리지 않아도 된다
    iptables -t nat -A R6_POST -o "$WG" -p udp -d "$host" --dport $GAME_PORTS -j MASQUERADE
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
  echo
  echo "  아래 내용을 방장 PC 에 r6relay-$name.conf 로 저장해 WireGuard 에서 가져오세요."
  echo "  (비밀키가 들어 있습니다. 그 방장에게만 주세요.)"
  echo "  ----------------------------------------------------------"
  cat "$DIR/hosts/$name.conf"
  echo "  ----------------------------------------------------------"
}

cmd_use() {
  need_root; local name=${1:-}; [ -n "$name" ] || die "사용법: r6relay use <방장이름>"; valid_name "$name"
  [ -e "$DIR/hosts/$name.ip" ] || die "등록되지 않은 방장입니다: $name"
  cp "$DIR/hosts/$name.ip" "$DIR/current.ip"; echo "$name" > "$DIR/current.name"
  cmd_apply
  ok "이제 게임은 $name ($(cat "$DIR/current.ip")) 에게 갑니다."
  echo "  유저 접속 주소: $(cat "$DIR/endpoint")"
}

cmd_off() {
  need_root; rm -f "$DIR/current.ip" "$DIR/current.name"; cmd_apply; ok "게임 넘기기를 멈췄습니다."
}

cmd_remove() {
  need_root; local name=${1:-}; valid_name "$name"
  [ -e "$DIR/hosts/$name.ip" ] || die "등록되지 않은 방장입니다: $name"
  [ "$(cat "$DIR/current.name" 2>/dev/null)" = "$name" ] && cmd_off
  rm -f "$DIR/hosts/$name".{ip,peer,conf}
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

case "${1:-}" in
  setup)  cmd_setup ;;
  add)    cmd_add "${2:-}" ;;
  use)    cmd_use "${2:-}" ;;
  off)    cmd_off ;;
  remove) cmd_remove "${2:-}" ;;
  list)   cmd_list ;;
  status) cmd_status ;;
  apply)  cmd_apply ;;
  clear)  cmd_clear ;;
  *) sed -n '2,25p' "$0" ;;
esac
