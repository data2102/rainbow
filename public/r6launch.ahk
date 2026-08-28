#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
;  r6rank.co.kr 런쳐 — 게임을 켜고 내 방까지 데려다줍니다
; ------------------------------------------------------------
;    r6clan://create                  → CREATE GAME   (방장)
;    r6clan://join/26.131.188.239     → MANUAL JOIN   (참가자)
;
;  메뉴는 키보드로 움직입니다. 해상도와 상관없습니다.
;    메인 메뉴 (커서: SINGLE PLAYER)  ↓ Enter → 서버 화면
;    서버 화면 (커서: CREATE GAME)
;      방장  : Enter
;      참가자: ↓ Enter → MANUAL JOIN 창
;
;  MANUAL JOIN 창(HOST / PORT / JOIN)만은 키보드가 먹지 않아 마우스로 누릅니다.
;  좌표는 640x480 기준으로 적어두고, 실제 화면 크기와 비율을 계산해 맞춥니다.
;  화면이 16:9 라 그림 좌우에 검은 띠가 생겨도 그만큼 빼고 계산합니다.
;
;  참가자가 목록(JOIN GAME)을 쓰지 않는 이유:
;  방이 여러 개 열리면 목록에 다 뜨는데 스크립트는 목록을 읽을 수 없어
;  엉뚱한 방에 들어갑니다. 주소로 곧장 붙으면 그럴 일이 없습니다.
; ============================================================


; ==================== 여기만 고치면 됩니다 ====================

GamePath := "C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

; 접속 포트. MULTIPLAYER OPTIONS 의 JOIN PORT 와 같아야 합니다.
JoinPort := "2346"

; 참가자가 게임을 켜는 동안 방장에게 미리 핑을 보내 Radmin 길을 터둡니다.
; (아래 "왜 이걸 하나" 설명 참고) 끄려면 false 로 바꾸세요.
PingWarmup := true

; 기다리는 시간 (1000 = 1초)
; 느린 PC 에서 키가 허공에 나가면 WaitMenu 부터 올리세요. 반대로 메뉴가 뜬 뒤에도
; 한참 서 있으면 줄이세요. 여기만 고치면 됩니다.
WaitMenu  := 6000    ; 게임 창이 뜬 뒤 메인 메뉴가 나올 때까지
JoinExtra := 6000    ; 참가자만 더 기다림 — 방장이 방을 다 만들 시간
WaitStep  := 700     ; 키 하나 누른 뒤
WaitPage  := 2000    ; 화면이 통째로 바뀔 때까지

; true 로 두면 무엇을 누르는지 화면에 띄우고, 마우스가 갈 자리에 잠깐 머뭅니다.
Debug := false

; MANUAL JOIN 창의 위치 (640x480 기준). 창이 다른 자리에 뜨면 여기를 고치세요.
XY_HOST := [297, 241]    ; HOST 입력칸
XY_PORT := [297, 269]    ; PORT 입력칸
XY_JOIN := [322, 296]    ; JOIN 버튼

; =============================================================


; ---------- 관리자 권한으로 다시 뜬다 ----------
; 게임을 관리자로 켜면, 같은 권한이 아닌 프로그램은 그 창에 키도 마우스도
; 보낼 수 없습니다(윈도우가 막습니다).
if !A_IsAdmin {
    arg := (A_Args.Length > 0) ? A_Args[1] : ""
    try Run '*RunAs "' A_AhkPath '" "' A_ScriptFullPath '" "' arg '"'
    ExitApp
}

; ---------- 어디로, 어느 주소로 ----------
raw := (A_Args.Length > 0) ? A_Args[1] : ""
mode := InStr(raw, "join") ? "join" : "create"

address := ""
if (mode = "join") {
    m := ""
    if RegExMatch(raw, "(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", &m)
        address := m[1]
    if (address = "") {
        MsgBox "방장 주소가 넘어오지 않았습니다.`n`n사이트에서 방장이 '내 Radmin 주소'를"
             . " 적어두어야 자동으로 들어갈 수 있습니다.",
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

; 이미 켜져 있던 게임은 어느 화면인지 알 수 없다. 함부로 누르면 진행 중인
; 게임을 망치므로 창만 앞으로 꺼내고 끝낸다.
if (alreadyRunning) {
    Note("게임이 이미 켜져 있어 화면만 앞으로 꺼냈습니다")
    ExitApp
}

; 게임이 뜨는 동안 방장에게 가는 길을 미리 터둔다. 어차피 기다리는
; 시간이라 공짜다 — 핑에 쓴 만큼 빼고 나머지만 잔다.
Note("메인 메뉴를 기다리는 중...")
t0 := A_TickCount
if (mode = "join" && PingWarmup)
    Warmup(address)
rest := WaitMenu - (A_TickCount - t0)
if (rest > 0)
    Sleep rest

if (mode = "join") {
    Note("방장이 방을 만들 때까지 잠시 더...")
    Sleep JoinExtra
}

; ---------- 메인 메뉴 → 서버 화면 ----------
Note("↓  MULTIPLAYER 로")
Tap("{Down}")
Sleep WaitStep

Note("Enter  서버 화면으로")
Tap("{Enter}")
Sleep WaitPage

; ---------- 방장이면 여기서 끝 ----------
if (mode = "create") {
    Note("Enter  CREATE GAME — 방 만들기")
    Tap("{Enter}")
    ExitApp
}

; ---------- 참가자: MANUAL JOIN 창 ----------
Note("↓  MANUAL JOIN 으로")
Tap("{Down}")
Sleep WaitStep

Note("Enter  주소 입력창 열기")
Tap("{Enter}")
Sleep WaitPage

; 이 창은 키보드로 칸을 옮길 수 없어 마우스로 누른다
Note("HOST 칸 누르기")
ClickAt(XY_HOST)
Sleep 250
Send "^a"                  ; 지난번 주소가 남아 있으면 지운다
Sleep 120
TypeSlow(address)
Sleep WaitStep

Note("PORT 칸 누르기")
ClickAt(XY_PORT)
Sleep 250
Send "^a"
Sleep 120
TypeSlow(JoinPort)
Sleep WaitStep

Note("JOIN 누르기")
ClickAt(XY_JOIN)

ExitApp


/**
 * 방장에게 미리 핑을 보내 Radmin 터널을 깨워둔다.
 *
 * 왜 이걸 하나:
 * Radmin VPN 의 길은 처음 말을 걸 때 만들어집니다. 게임이 그 첫 손님이 되면,
 * 게임은 길이 뚫릴 때까지를 "상대가 응답 없음"으로 세다가 시간초과를 내고
 * 다시 겁니다. JOIN 을 누르고 몇 초씩 멎는 대부분이 이것입니다.
 * 게임이 켜지는 동안 우리가 먼저 두드려 두면, 게임의 첫 패킷은 이미
 * 뚫린 길로 곧장 나갑니다.
 *
 * 다 실패해도 막지는 않습니다. 상대 방화벽이 핑만 막아둔 경우에도
 * 게임은 붙기 때문입니다. 알려만 주고 지나갑니다.
 */
Warmup(ip) {
    tmp := A_Temp "\r6ping.txt"
    try FileDelete tmp
    try RunWait A_ComSpec ' /c ping -n 4 -w 1000 ' ip ' > "' tmp '"', , "Hide"

    out := ""
    try out := FileRead(tmp)
    try FileDelete tmp

    if (out != "" && InStr(out, "100%")) {
        ToolTip "방장(" ip ")에게서 응답이 없습니다.`n"
              . "Radmin VPN 에 둘 다 들어와 있는지 확인해주세요.`n"
              . "그래도 게임 접속은 시도합니다."
        SetTimer () => ToolTip(), -4000
    }
}

/** 게임 창에만 키를 보낸다 */
Tap(key) {
    if !WinExist("ahk_exe RainbowSix.exe")
        ExitApp
    WinActivate "ahk_exe RainbowSix.exe"
    Sleep 120
    Send key
}

/** 옛 게임은 빠른 입력을 흘리는 일이 있어 한 글자씩 천천히 적는다 */
TypeSlow(text) {
    if !WinExist("ahk_exe RainbowSix.exe")
        ExitApp
    WinActivate "ahk_exe RainbowSix.exe"
    Sleep 120
    Loop Parse text
    {
        SendText(A_LoopField)
        Sleep 60
    }
}

/**
 * 640x480 기준 좌표를 실제 화면에 맞춰 누른다.
 *
 * 게임 그림은 4:3 이라, 16:9 모니터에서는 좌우에 검은 띠가 생긴다.
 * 그 띠를 빼고 그림이 실제로 그려진 영역만 놓고 계산해야 자리가 맞는다.
 */
ClickAt(pt) {
    global Debug
    if !WinExist("ahk_exe RainbowSix.exe")
        ExitApp
    WinActivate "ahk_exe RainbowSix.exe"
    WinGetClientPos , , &w, &h, "ahk_exe RainbowSix.exe"
    if (w = 0 || h = 0)
        return

    ratio := 640 / 480
    if (w / h > ratio) {          ; 화면이 더 넓다 → 좌우에 띠
        drawH := h
        drawW := Round(h * ratio)
    } else {                      ; 화면이 더 높다 → 위아래에 띠
        drawW := w
        drawH := Round(w / ratio)
    }
    x := ((w - drawW) // 2) + Round(pt[1] * drawW / 640)
    y := ((h - drawH) // 2) + Round(pt[2] * drawH / 480)

    CoordMode "Mouse", "Client"
    MouseMove x, y, 2
    if (Debug) {
        ToolTip "여기를 누릅니다 → " x ", " y
        Sleep 1200
        ToolTip()
    }
    Sleep 150
    Click
}
