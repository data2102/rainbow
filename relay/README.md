# 중계 서버 (r6relay)

Radmin 없이 게임에 들어가게 해 주는 서버입니다.

```
유저들 ──(그냥 접속)──▶ 중계 서버 ◀──(방장만 연결)── 방장 PC
          UDP 2346~2348                WireGuard 터널
```

- **유저는 아무것도 설치하지 않습니다.** 방장 IP 대신 중계 서버 주소로 들어갑니다.
- **방장 공유기·CGNAT 와 상관없습니다.** 방장 PC 가 중계 서버로 *먼저 나가서* 연결해 두기 때문입니다.
- 방장의 다른 인터넷(웹, 디스코드 등)은 터널을 타지 않습니다. 중계 서버 대역(`10.66.0.0/24`)만 보냅니다.

## 1. 서버 만들기 (한 번)

서울·춘천 리전의 **Ubuntu 22.04 / 24.04** 가장 작은 서버면 충분합니다.

| 서버 | 월 비용(대략) |
|---|---|
| Oracle Cloud 무료 등급 | 0원 (오래 놀리면 회수될 수 있음) |
| AWS Lightsail 서울 | 약 $5 |

**클라우드 방화벽에서 두 가지를 열어 주세요.** 서버 안에서 열어도 여기가 막혀 있으면 안 들어옵니다.

| 프로토콜 | 포트 | 무엇 |
|---|---|---|
| UDP | 51820 | 방장 터널 |
| UDP | 2346-2348 | 게임 (JOIN / ANNOUNCE / INFO) |

- Oracle: 네트워킹 → VCN → 보안 목록 → 수신 규칙 추가 (소스 `0.0.0.0/0`)
- Lightsail: 인스턴스 → 네트워킹 → IPv4 방화벽 → 규칙 추가

> **고정 IP 를 붙이세요.** 서버를 다시 켤 때 주소가 바뀌면 방장 터널 파일과 유저 접속 주소를 전부 다시 돌려야 합니다.
> (Oracle: 예약된 공인 IP, Lightsail: 고정 IP — 인스턴스에 붙어 있으면 무료)

## 2. 설치 (한 번)

서버에 접속해서:

```bash
curl -fsSLO https://raw.githubusercontent.com/data2102/rainbow/main/relay/r6relay.sh
sudo bash r6relay.sh setup
```

`[O] 중계 시작` 이 나오면 끝입니다. 서버를 재부팅해도 자동으로 켜집니다.

## 3. 방장 등록 (방장마다 한 번)

```bash
sudo r6relay add lena
```

화면에 나온 `[Interface]` 부터 `PersistentKeepalive = 25` 까지를 방장에게 보냅니다.
같은 내용이 서버의 `/etc/r6relay/hosts/lena.conf` 에도 남습니다.
**비밀키가 들어 있으니 그 방장에게만 주세요.** 단톡방에 올리지 않습니다.

### 방장 PC 에서 (한 번)

1. <https://www.wireguard.com/install/> 에서 Windows 용 WireGuard 를 설치합니다.
2. 받은 내용을 메모장에 붙여 `r6relay-lena.conf` 로 저장합니다.
3. WireGuard → **파일에서 터널 가져오기** → 그 파일 → **활성화**.
4. 확인: 명령 프롬프트에서 `ping 10.66.0.1` 이 답하면 연결된 것입니다.

방을 열 때만 활성화해 두면 됩니다. 게임은 평소처럼 런쳐로 **방 만들기**.

## 4. 게임 넘기기 (방장이 바뀔 때)

```bash
sudo r6relay use lena      # 이제 들어오는 게임은 lena 에게 갑니다
sudo r6relay off           # 멈추기
sudo r6relay status        # 방장 연결 · 들어온 패킷 수
sudo r6relay list          # 등록된 방장
sudo r6relay remove lena   # 방장 지우기
```

지금은 **한 번에 방 하나**입니다. 게임 포트가 2346~2348 하나뿐이라서입니다.

## 5. 유저 접속

중계 서버의 공인 IP 로 들어갑니다.

```
"C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe" -client <중계서버IP> 2346
```

사이트 런쳐에 붙이면 "참가" 버튼이 이 주소를 넘기게 됩니다 (시험이 끝난 뒤 작업).

## 시험할 것

설치 스크립트의 전달 규칙은 리눅스 네트워크를 흉내 내서 확인했습니다 —
유저 두 명이 동시에 2346·2347·2348 로 들어와 방장에게 닿고, 방장의 답이 되돌아갑니다.
**실제 게임으로는 아직 안 해 봤습니다.** 처음 한 판에서 이 순서로 봅니다.

1. `sudo r6relay status` 에서 방장의 `latest handshake` 가 보이는가 → 터널 OK
2. 유저가 접속할 때 `R6_PRE` 의 pkts 가 느는가 → 클라우드 방화벽 OK
3. 유저가 방에 들어가는가 → 게임이 중계를 받아들임
4. **유저 두 명 이상이 동시에** 들어가는가

3 또는 4에서 막히면, 게임이 주고받는 내용 안에 주소를 직접 적어 보내는 경우입니다.
그때는 유저도 터널을 쓰는 방식(모두가 WireGuard 설치)으로 바꿉니다 — 서버는 그대로 씁니다.

## 문제가 생기면

| 증상 | 볼 곳 |
|---|---|
| 방장 handshake 가 안 생김 | 클라우드 방화벽 UDP 51820, 방장 PC 시간이 맞는지 |
| handshake 는 있는데 pkts 가 0 | 클라우드 방화벽 UDP 2346-2348 |
| pkts 는 느는데 못 들어감 | 방장 PC 의 `r6firewall.bat` 실행 여부, 위 "시험할 것" 3·4 |
| 서버 재부팅 후 안 됨 | `sudo systemctl status wg-quick@wg0` |
