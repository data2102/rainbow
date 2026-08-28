#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
;  r6rank.co.kr 런쳐 — 게임을 켜고 내 방까지 데려다줍니다
; ------------------------------------------------------------
;  사이트에서 넘어오는 주소에 따라 갈 곳이 달라집니다.
;    r6clan://create                  → CREATE GAME   (방장)
;    r6clan://join/26.131.188.239     → MANUAL JOIN   (참가자)
;
;  참가자는 목록(JOIN GAME)이 아니라 MANUAL JOIN 으로 들어갑니다.
;  1번방·2번방이 동시에 열려 있으면 목록에 방이 여러 개 뜨는데, 스크립트는
;  목록을 읽을 수 없어 엉뚱한 방에 들어가게 됩니다. 주소로 직접 붙으면
;  그럴 일이 없습니다.
;
;  마우스 좌표는 쓰지 않습니다. 해상도가 640x480 이든 1920x1080 이든 같습니다.
;
;    메인 메뉴 — 커서가 SINGLE PLAYER 에 있음
;      ↓ 한 번 → MULTIPLAYER, Enter → 서버 화면
;    서버 화면 — 커서가 CREATE GAME 에 있음
;      방장  : Enter
;      참가자: ↓ 한 번 → MANUAL JOIN, Enter → 주소 입력 → Enter
; ============================================================


; ==================== 여기만 고치면 됩니다 ====================

; 게임 위치
GamePath := "C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

; 게임 창이 뜬 뒤 메인 메뉴가 나올 때까지 기다리는 시간 (1000 = 1초)
; 오프닝 영상이 있으면 그만큼 넉넉히 주세요. 너무 짧으면 키가 허공에 나갑니다.
WaitMenu := 12000

; 참가자만 더 기다리는 시간.
; 방장이 방을 다 만들기 전에 붙으러 가면 헛걸음이 되므로 조금 늦게 갑니다.
JoinExtra := 8000

; 키를 하나 누른 뒤 화면이 반응할 때까지
WaitStep := 900

; 화면이 통째로 바뀔 때까지 (메인 → 서버 화면, 주소 입력창 열기)
WaitPage := 2500

; true 로 두면 무엇을 누르는지 화면 구석에 띄워 보여줍니다. 맞출 때만 켜세요.
Debug := false

; =============================================================


; ---------- 관리자 권한으로 다시 뜬다 ----------
; 게임을 관리자 권한으로 켜면, 같은 권한이 아닌 프로그램은 그 창에 키를 보낼 수
; 없습니다(윈도우가 막습니다). 그래서 이 스크립트도 관리자로 올라가야 합니다.
if !A_IsAdmin {
    arg := (A_Args.Length > 0) ? A_Args[1] : ""
    try Run '*RunAs "' A_AhkPath '" "' A_ScriptFullPath '" "' arg '"'
    ExitApp
}

; ---------- 어디로 갈지, 어느 주소로 갈지 ----------
raw := (A_Args.Length > 0) ? A_Args[1] : ""
mode := InStr(raw, "join") ? "join" : "create"

; 주소는 사이트가 IPv4 형식만 통과시켜 보냅니다. 여기서 한 번 더 걸러냅니다.
address := ""
if (mode = "join") {
    m := ""
    if RegExMatch(raw, "(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", &m)
        address := m[1]
    if (address = "") {
        MsgBox "방장 주소가 넘어오지 않았습니다.`n`n사이트에서 방장이 실행할 때"
             . " Radmin 주소를 적어야 자동으로 들어갈 수 있습니다.`n"
             . "직접 들어가려면 MULTIPLAYER > JOIN GAME 에서 방장의 서버를 고르세요.",
               "R6 런쳐", "Icon!"
        ExitApp
    }
}

Note(text) {
    global Debug
    if (Debug) {
        ToolTip text
        Sleep 900
        ToolTip()
    }
}

; ---------- 게임을 켠다 ----------
alreadyRunning := ProcessExist("RainbowSix.exe") ? true : false

if (!alreadyRunning) {
    if !FileExist(GamePath) {
        MsgBox "게임을 찾지 못했습니다.`n`n" GamePath "`n`n이 파일 위쪽의 GamePath 를 고쳐주세요.",
               "R6 런쳐", "Icon!"
        ExitApp
    }
    SplitPath GamePath, , &gameDir
    Run '"' GamePath '"', gameDir
}

if !WinWait("ahk_exe RainbowSix.exe", , 60) {
    MsgBox "게임 창이 60초 안에 뜨지 않았습니다.", "R6 런쳐", "Icon!"
    ExitApp
}
WinActivate "ahk_exe RainbowSix.exe"
WinWaitActive "ahk_exe RainbowSix.exe", , 15

; 이미 켜져 있던 게임이라면 어느 화면에 있는지 알 수 없다.
; 함부로 키를 누르면 진행 중인 게임을 망치므로 창만 앞으로 꺼내고 끝낸다.
if (alreadyRunning) {
    Note("게임이 이미 켜져 있어 화면만 앞으로 꺼냈습니다")
    ExitApp
}

; ---------- 메인 메뉴를 기다린다 ----------
Note("메인 메뉴를 기다리는 중...")
Sleep WaitMenu
if (mode = "join") {
    Note("방장이 방을 만들 때까지 잠시 더...")
    Sleep JoinExtra
}

; ---------- 메인 메뉴: SINGLE PLAYER → MULTIPLAYER ----------
Note("↓  MULTIPLAYER 로")
Tap("{Down}")
Sleep WaitStep

Note("Enter  서버 화면으로")
Tap("{Enter}")
Sleep WaitPage

; ---------- 서버 화면: 커서는 CREATE GAME 에 있다 ----------
if (mode = "create") {
    Note("Enter  CREATE GAME — 방 만들기")
    Tap("{Enter}")
    ExitApp
}

Note("↓  MANUAL JOIN 으로")
Tap("{Down}")
Sleep WaitStep

Note("Enter  주소 입력창 열기")
Tap("{Enter}")
Sleep WaitPage

; 이미 적혀 있는 주소가 있을 수 있으므로 지우고 새로 적는다
Note("주소 입력: " address)
Tap("^a")
Sleep 150
TapText(address)
Sleep WaitStep

Note("Enter  접속")
Tap("{Enter}")

ExitApp


/** 게임 창에만 키를 보낸다. 도중에 다른 창을 눌러도 엉뚱한 곳으로 가지 않는다. */
Tap(key) {
    if !WinExist("ahk_exe RainbowSix.exe")
        ExitApp
    WinActivate "ahk_exe RainbowSix.exe"
    Sleep 120
    Send key
}

/** 주소를 한 글자씩 천천히 적는다. 옛 게임은 빠른 입력을 흘리는 일이 있다. */
TapText(text) {
    if !WinExist("ahk_exe RainbowSix.exe")
        ExitApp
    WinActivate "ahk_exe RainbowSix.exe"
    Sleep 120
    Loop Parse text
        SendText(A_LoopField), Sleep 60
}
