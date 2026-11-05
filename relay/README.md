# 중계 서버 (r6relay)

Radmin 없이 게임에 들어가게 해 주는 서버입니다.

```
유저들 ──(그냥 접속)──▶ 중계 서버 ◀──(방장만 연결)── 방장 PC
          UDP 2346~2348                WireGuard 터널
```

- **유저는 아무것도 설치하지 않습니다.** 방장 IP 대신 중계 서버 주소로 들어갑니다.
- **방장 공유기·CGNAT 와 상관없습니다.** 방장 PC 가 중계 서버로 *먼저 나가서* 연결해 두기 때문입니다.
- 방장의 다른 인터넷(웹, 디스코드 등)은 터널을 타지 않습니다. 중계 서버 대역(`10.66.0.0/24`)만 보냅니다.

## 1. 서버 만들기 (AWS Lightsail, 휴대폰으로 가능)

**만들면서 설치까지 끝냅니다** — 시작 스크립트를 넣어 두면 서버가 처음 켜질 때 알아서 설치합니다.

1. AWS 콘솔 → 검색창에 **Lightsail** → **Create instance**
2. **Instance location**: **Seoul** (아니면 *Change AWS Region* 으로 바꾼다)
3. **Select a platform**: **Linux/Unix**
4. **Select a blueprint**: **Operating System (OS) only** → **Ubuntu 24.04 LTS** (없으면 22.04)
5. **+ Add launch script** 를 눌러 아래 세 줄을 그대로 붙여 넣는다

   ```
   #!/bin/bash
   curl -fsSLo /root/r6relay.sh https://raw.githubusercontent.com/data2102/rainbow/main/relay/r6relay.sh
   bash /root/r6relay.sh setup > /root/r6relay-setup.log 2>&1
   ```
6. **Choose your instance plan**: 위 탭이 **Dual-stack**(IPv4 포함)인지 보고 **가장 싼 것** ($5 또는 $7).
   *IPv6-only 는 안 된다* — 유저들이 IPv4 로 들어온다.
7. 이름 `r6-relay` → **맨 아래까지 내려서** 주황 **Create instance**
8. 목록에 `r6-relay` 가 **Running** 이 되면 성공.

> **"Request a service quota increase" 창이 뜨면** 그 계정의 서울 Lightsail 한도가 0 인 것이다.
> *Adjust quota* → **계정 수준에서 증가 요청** → 화면이 허용하는 최소값으로 요청 → 승인 메일이 오면 다시 1번부터.
> 한도는 상한일 뿐이라 올려도 요금은 안 나온다.

### 고정 IP

1. **☰ → Networking → Create static IP** → 리전 **Seoul** → *Attach to an instance* 에서 `r6-relay` → **Create**
2. 나온 숫자 주소가 **유저들이 들어올 주소**다. 서버를 껐다 켜도 안 바뀐다.

> 고정 IP 는 **서버에 붙어 있으면 무료, 떨어져 있으면 유료**다. 서버를 지우면 IP 도 같이 지운다.

### 방화벽 (클라우드 쪽)

인스턴스 `r6-relay` → 위 탭 줄을 옆으로 밀어 **Networking** → **IPv4 Firewall** → **+ Add rule** 두 번.
원래 있던 SSH(22) 는 지우지 않는다 — 지우면 접속 창이 안 열린다.

| Application | Protocol | Port | 무엇 |
|---|---|---|---|
| Custom | **UDP** | 51820 | 방장 터널 |
| Custom | **UDP** | 2346-2348 | 게임 (JOIN / ANNOUNCE / INFO) |

**TCP 가 아니라 UDP** 인지 꼭 본다. 제일 흔한 실수다.

### Lightsail 대신 EC2 로 (Lightsail 한도가 0 일 때)

Lightsail 은 계정마다 리전 한도가 따로 있고, 처음 쓰는 계정은 0 인 경우가 있다(승인까지 하루 이틀).
EC2 는 한도가 따로라 바로 만들어지는 일이 많다. 설치 스크립트는 같다.

1. **EC2** → 오른쪽 위 리전 **서울** → **인스턴스 시작**
2. 이름 `r6-relay` · AMI **Ubuntu Server 24.04 LTS** · 유형 **t3.micro**
3. 키 페어: **키 페어 없이 계속** (브라우저 접속 창으로 들어간다)
4. **네트워크 설정 → 편집**
   - SSH(22) 규칙은 소스 **위치 무관** 으로 둔다 — 그래야 *EC2 Instance Connect* 가 열린다
   - **보안 그룹 규칙 추가** → **사용자 지정 UDP** · `51820` · **위치 무관**
   - **보안 그룹 규칙 추가** → **사용자 지정 UDP** · `2346-2348` · **위치 무관**
   - SSH 의 "소스" 칸에 포트 번호를 넣지 않는다. 포트는 규칙마다 따로 있다.
5. **고급 세부 정보** 펼치기 → 맨 아래 **사용자 데이터** 에 위 1번의 세 줄을 붙여 넣는다
6. **인스턴스 시작**. 버튼이 오래 돌면 **다시 누르기 전에** 인스턴스 목록부터 본다 —
   이미 만들어졌는데 또 누르면 두 대가 된다.
7. 고정 IP: **탄력적 IP → 할당 → 작업 → 연결** (인스턴스 `r6-relay`)
8. 접속 창: 인스턴스 선택 → **연결 → EC2 Instance Connect → 연결**

### Vultr 로 (AWS 계정이 막혔을 때 · 바로 됨)

1. <https://www.vultr.com> 가입 → 결제 수단 등록
2. **Deploy +** → **Deploy New Server**
3. 종류 **Shared CPU**(Cloud Compute) · 위치 **Seoul**
4. 이미지 **Ubuntu 24.04 LTS x64**
5. 요금제: **IPv4 가 들어 있는 가장 싼 것**($5~6). *IPv6 only* 는 고르지 않는다
6. **Automatic Backups 끄기** (켜 두면 요금이 20% 더 붙는다. 이 서버엔 지킬 데이터가 없다)
7. **Additional Features → Cloud-Init User-Data** 를 켜고 위 1번의 세 줄을 붙여 넣는다
   (항목이 안 보이면 건너뛰고 아래 *설치 확인* 에서 직접 설치한다)
8. 호스트 이름 `r6-relay` → **Deploy Now**
9. 서버 목록에서 **Running** 이 되면 그 화면의 **IP Address** 가 유저들이 들어올 주소다.
   Vultr 는 서버를 지우지 않는 한 이 주소가 바뀌지 않아 고정 IP 를 따로 만들 필요가 없다.

- 방화벽: Vultr 는 따로 만들지 않으면 클라우드 방화벽이 없다. 서버 안의 ufw 는 설치 스크립트가 연다.
- 접속 창: Windows PC 의 명령 프롬프트에서 `ssh root@<서버IP>` → 서버 화면의 **Password** 를 붙여 넣는다
  (붙여 넣어도 글자가 안 보이는 게 정상이다).

## 2. 설치 확인

인스턴스 화면의 **Connect using SSH** 로 검은 창을 열고:

```bash
sudo cat /root/r6relay-setup.log
```

`[O] 중계 시작` 이 보이면 끝. 시작 스크립트를 안 넣었다면 여기서 직접 설치한다:

```bash
curl -fsSLO https://raw.githubusercontent.com/data2102/rainbow/main/relay/r6relay.sh
```
```bash
sudo bash r6relay.sh setup
```

## 3. 방장 등록 (방장마다 한 번)

```bash
sudo r6relay add lena
```

화면에 나온 `[Interface]` 부터 `PersistentKeepalive = 25` 까지를 방장에게 보냅니다.
같은 내용이 서버의 `/etc/r6relay/hosts/lena.conf` 에도 남습니다.
**비밀키가 들어 있으니 그 방장에게만 주세요.** 단톡방에 올리지 않습니다.

### 방장 PC 에서 (한 번)

**이 단계는 방장의 게임 PC 에서 한다.** 서버 접속 창도 그 PC 브라우저로 열면 복사·붙여넣기가 한 번에 끝난다.

1. <https://www.wireguard.com/install/> 에서 Windows 용 WireGuard 를 설치합니다.
2. WireGuard → 왼쪽 아래 **터널 추가 ▾ → 빈 터널 추가**.
3. 칸에 미리 적혀 있는 내용을 **전부 지우고**, 서버에서 받은 내용을 붙여 넣습니다.
4. 이름 `r6relay` → **저장** → **활성화**.
5. 확인: 명령 프롬프트에서 `ping 10.66.0.1` 이 답하면 연결된 것입니다.
6. 사이트 자료실의 `r6firewall.bat` 을 아직 안 돌렸다면 돌립니다 (게임 포트 허용).

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

**사이트 런쳐로 (고칠 것 없음)** — 방장이 런쳐에서 자기 **접속 주소(Radmin 주소 칸)** 에
`26.x.x.x` 대신 **중계 서버 고정 IP** 를 적고 게임을 실행합니다. 사이트는 IPv4 면 무엇이든 받으므로
유저들은 평소처럼 **참가** 만 누르면 중계 서버로 갑니다. 유저는 Radmin 을 켤 필요가 없습니다.
시험이 끝나면 방장은 그 칸을 원래 Radmin 주소로 되돌립니다.

**직접 실행으로** — 중계 서버의 공인 IP 로 들어갑니다.

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
