#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
;  r6rank.co.kr 런쳐 — 게임을 켜고 멀티플레이 화면까지 데려다줍니다
; ------------------------------------------------------------
;  사이트에서 넘어오는 주소에 따라 갈 곳이 달라집니다.
;    r6clan://create → MULTIPLAYER > CREATE GAME  (방장)
;    r6clan://join   → MULTIPLAYER > JOIN GAME    (참가자)
;
;  마우스 좌표를 쓰지 않고 키보드로만 움직입니다.
;  그래서 해상도가 640x480 이든 1920x1080 이든 똑같이 동작합니다.
;
;    메인 메뉴 — 커서가 SINGLE PLAYER 에 있음
;      ↓ 한 번 → MULTIPLAYER, Enter → 서버 화면
;    서버 화면 — 커서가 CREATE GAME 에 있음
;      방장  : Enter
;      참가자: ↑ 한 번 → JOIN GAME, Enter
;
;  손볼 것은 아래 "기다리는 시간" 뿐입니다.
; ============================================================


; ==================== 여기만 고치면 됩니다 ====================

; 게임 위치
GamePath := "C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

; 게임 창이 뜬 뒤 메인 메뉴가 나올 때까지 기다리는 시간 (1000 = 1초)
; 오프닝 영상이 있으면 그만큼 넉넉히 주세요. 너무 짧으면 키가 허공에 나갑니다.
WaitMenu := 12000

; 키를 하나 누른 뒤 화면이 반응할 때까지 기다리는 시간
WaitStep := 900

; 화면이 한 번 통째로 바뀔 때까지 기다리는 시간 (메인 → 서버 화면)
WaitPage := 2500

; true 로 두면 무엇을 누르는지 화면 구석에 띄워 보여줍니다. 맞출 때만 켜세요.
Debug := false

; =============================================================


; ---------- 관리자 권한으로 다시 뜬다 ----------
; 게임을 관리자 권한으로 켜면, 같은 권한이 아닌 프로그램은 그 창에 키를 보낼 수 없습니다.
; (윈도우가 막습니다) 그래서 이 스크립트도 관리자로 올라가야 합니다.
if !A_IsAdmin {
    arg := (A_Args.Length > 0) ? A_Args[1] : ""
    try Run '*RunAs "' A_AhkPath '" "' A_ScriptFullPath '" "' arg '"'
    ExitApp
}

; ---------- 어디로 갈지 정한다 ----------
mode := "create"
if (A_Args.Length > 0 && InStr(A_Args[1], "join"))
    mode := "join"

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
; 함부로 키를 누르면 엉뚱한 곳으로 가므로 창만 앞으로 꺼내고 끝낸다.
if (alreadyRunning) {
    Note("게임이 이미 켜져 있어 화면만 앞으로 꺼냈습니다")
    ExitApp
}

; ---------- 메인 메뉴를 기다린다 ----------
Note("메인 메뉴를 기다리는 중...")
Sleep WaitMenu

; ---------- 메인 메뉴: SINGLE PLAYER → MULTIPLAYER ----------
Note("↓  MULTIPLAYER 로")
Tap("{Down}")
Sleep WaitStep

Note("Enter  서버 화면으로")
Tap("{Enter}")
Sleep WaitPage

; ---------- 서버 화면: 커서는 CREATE GAME 에 있다 ----------
if (mode = "join") {
    Note("↑  JOIN GAME 으로")
    Tap("{Up}")
    Sleep WaitStep
    Note("Enter  방장 방에 들어가기")
} else {
    Note("Enter  CREATE GAME")
}
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
