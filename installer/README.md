# 레인보우 식스 통합 설치 파일 만들기

받는 사람이 **한 번 받아 한 번 실행하면 끝**나는 설치 파일(`R6ClanSetup.exe`)을 만듭니다.

```
지금            게임 설치 → HonestEngine 실행 → INSTALL 클릭 → 스킨 폴더 복사
                → 사이트에서 파일 3개 받기 → 각각 실행
이걸로 바꾸면   R6ClanSetup.exe 더블클릭  →  중간에 [Install] 한 번 클릭  →  끝
```

---

## 만드는 순서 (4단계)

### 1단계 · Inno Setup 을 깝니다 (한 번만)

https://jrsoftware.org/isdl.php 에서 **innosetup-6.x.x.exe** 를 받아 설치하세요. 무료입니다.
물어보는 건 전부 기본값으로 넘기면 됩니다.

> 설치 파일을 **만드는 사람**만 필요합니다. 받아 쓰는 사람은 깔 필요 없습니다.

### 2단계 · `payload\` 세 폴더를 채웁니다

각 폴더에 `_README.txt` 안내문이 들어 있습니다. **비워두면 그 단계가 통째로 빠집니다.**

| 폴더 | 넣을 것 |
|---|---|
| `payload\game\` | `r6setup101a.part01.exe` · `part02.rar` · `part03.rar` — **세 개 모두** |
| `payload\skin\` | `레나스킨_V2` **폴더 안의 내용물** (`character` `save` `sound` `texture`) |
| `payload\extra\` | (선택) 게임 폴더 맨 위에 얹을 것 — dgVoodoo2, DDrawCompat, 추가 맵 등 |

주의할 점 두 가지:

- **파일 이름을 바꾸지 마세요.** 압축 볼륨끼리 서로를 이름으로 찾습니다.
- **폴더를 한 겹 더 만들지 마세요.** `payload\skin\character\` 가 바로 보여야 맞습니다.
  `payload\skin\레나스킨_V2\character\` 는 틀립니다.

### 3단계 · `build.bat` 을 더블클릭합니다

무엇이 들어있는지 확인한 뒤 압축합니다. 몇 분 걸립니다.

```
  [O] compiler : C:\Program Files (x86)\Inno Setup 6\ISCC.exe
  [O] launcher : ..\public\
  [O] game     : payload\game\   (3 volumes)
  [O] skin     : payload\skin\    (4 items)
  [-] extra    : payload\extra\ is empty - nothing extra
```

### 4단계 · 결과물

```
installer\output\R6ClanSetup.exe      (약 75MB)
```

이 파일 하나를 나눠주면 됩니다.

---

## 설치 파일이 밟는 순서

손으로 하던 것과 **같은 순서**입니다. 순서를 바꾸면 안 됩니다.

| | 하는 일 | 왜 이 자리인가 |
|---|---|---|
| 1 | `r6setup101a.part01.exe` 압축 풀기 | 게임 본체 |
| 2 | `regsetup.exe` 실행 | 게임이 `data` 폴더를 어디서 찾을지 레지스트리에 등록. **없으면 3번이 실패합니다** |
| 3 | `HonestEngine.exe` → **Install** | 버전 1.04 → 6.13. 게임 위치를 2번이 쓴 레지스트리에서 읽습니다 |
| 4 | 레나스킨 V2 를 `data` 에 덮어쓰기 | **3번보다 뒤여야 합니다.** HonestEngine 이 `data\sound` 를 건드리므로, 먼저 덮으면 스킨 소리가 되돌려집니다 |
| 5 | 클랜 접속 설정 | `r6clan://` 등록 · `C:\R6Clan\` 런쳐 배치 파일 · 방화벽 UDP 2346~2348 |

덤으로 이런 것도 합니다:

- 게임을 **항상 관리자 권한으로** 실행하게 등록
- 런쳐 배치 파일 안의 `GAME=` 줄을 **실제 설치 위치로 고쳐 씀**
  (기본 폴더가 아닌 곳에 깔아도 동작합니다)
- 덮어쓴 원본을 **`게임폴더\R6Clan_Backup\날짜시각\`** 에 챙겨둠

즉 사이트 런쳐 탭의 **필수사항 1·2·3 이 사라집니다.**
받는 사람에게 남는 수동 작업은 **게임 안의 MULTIPLAYER OPTIONS 설정(4번)** 하나뿐입니다.

---

## 손이 한 번 가는 곳 — HonestEngine

**설치 도중 HonestEngine 창이 뜨고, 받는 사람이 `[Install]` 을 눌러야 합니다.**

`HonestEngine.exe` 는 명령줄로 시킬 방법이 없는 창짜리 프로그램이라, 설치 파일이 대신
눌러줄 수 없습니다. 그래서 창을 띄우기 전에 무엇을 눌러야 하는지 안내문을 먼저 보여주고,
창이 닫히면 나머지를 이어서 합니다.

<details>
<summary>이 한 번의 클릭마저 없애는 방법 (선택)</summary>

`HonestEngine` 의 Install 이 실제로 하는 일은 두 가지뿐입니다.

1. `RainbowSix.exe` 를 고쳐 씀 (크기는 그대로, 내용만 바뀜)
2. 레지스트리 `SOFTWARE\MS` 에 버전 기록

`data` 폴더 쪽은 **이미 적용된 상태로** 설치 파일 안에 들어 있어서 건드릴 게 없습니다.
(확인함: 압축 안의 `data\kit\*` 가 `he\he\data\kit\*` 와 같습니다)

그래서 **이미 6.13 이 적용된 PC 의 `RainbowSix.exe` 한 개(4.7MB)** 를
`payload\extra\` 에 넣고, `SOFTWARE\MS` 레지스트리 값만 알려주면
HonestEngine 단계를 아예 빼고 완전 자동으로 만들 수 있습니다.
</details>

---

## 자주 막히는 곳

**`[X] Inno Setup was not found.`**
1단계를 안 하셨거나 기본 위치가 아닌 곳에 까셨습니다.
`build.bat` 을 메모장으로 열어 위쪽 경로 목록에 실제 경로를 추가하세요.

**`[X] game : part02.rar is missing`**
세 볼륨이 다 있어야 합니다. 이름도 그대로여야 합니다.

**`[!] skin : payload\skin\ is empty`**
폴더가 한 겹 더 들어갔을 가능성이 큽니다.
`payload\skin\` 을 열었을 때 `character` 폴더가 바로 보여야 합니다.

**만든 파일이 너무 커서 못 올립니다**
저장소나 Vercel 에는 올릴 수 없습니다. 구글 드라이브 같은 곳에 올리고
사이트 런쳐 탭에는 링크만 거세요.

**백신이 잡습니다**
방화벽 규칙을 추가하고, 압축을 풀고, 게임을 등록하는 동작 때문입니다.
HonestEngine 은 핵 방지 프로그램이라 더 잘 걸립니다.

---

## 꼭 확인하세요

**게임이 깔려 있지 않은 PC 에서 한 번 시험해보고 나눠주세요.**
이미 게임이 있는 PC 에서는 문제가 안 드러납니다. 특히 2단계(`regsetup.exe`)가
제대로 도는지는 깨끗한 PC 에서만 확인됩니다.

지금 게임이 잘 도는 PC 의 게임 폴더에 **dgVoodoo2**(`D3D8.dll`, `dgVoodoo.conf`,
`3Dfx\`, `MS\`, `Doc\`)나 **DDrawCompat**(`ddraw.dll`) 같은 파일이 있다면,
그건 압축 파일 안에 들어있지 않습니다. `payload\extra\` 에 따로 넣어주세요.
안 넣으면 받는 사람 화면이 다르게 나올 수 있습니다.

---

## 파일 설명

| 파일 | 무엇 |
|---|---|
| `R6ClanSetup.iss` | 설치 파일 설계도. 동작을 바꾸려면 이걸 고칩니다 |
| `build.bat` | 더블클릭하면 설계도대로 설치 파일을 만듭니다 |
| `info-before.txt` | 설치 첫 화면에 뜨는 안내문 |
| `payload/game/` | 게임 설치 파일 3개를 넣는 자리 |
| `payload/skin/` | 레나스킨 V2 내용을 넣는 자리 |
| `payload/extra/` | 게임 폴더에 얹을 것을 넣는 자리 (선택) |
| `output/` | 만들어진 설치 파일이 나오는 자리 |

`payload/` 와 `output/` 의 내용은 저장소에 올라가지 않습니다 (`.gitignore`).
