#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
;  r6rank.co.kr 런쳐 — 게임을 켜고 멀티플레이 화면까지 데려다줍니다
; ------------------------------------------------------------
;  사이트에서 넘어오는 주소에 따라 갈 곳이 달라집니다.
;    r6clan://create → MULTIPLAYER > CREATE GAME  (방장)
;    r6clan://join   → MULTIPLAYER > JOIN GAME    (참가자)
;
;  게임 메뉴에는 "바로 여기로 가라"는 실행 옵션이 없습니다. 그래서 사람이
;  누르던 자리를 대신 눌러줍니다. 컴퓨터마다 게임이 뜨는 속도가 달라서
;  아래 기다리는 시간을 한두 번 맞춰야 할 수 있습니다.
; ============================================================


; ==================== 여기만 고치면 됩니다 ====================

; 게임 위치
GamePath := "C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

; 오프닝 영상을 넘기려고 ESC 를 누르는 횟수.
; 영상이 없거나 ESC 로 안 넘어가면 0 으로 두고 WaitMenu 를 늘리세요.
IntroSkip := 4

; 기다리는 시간 (1000 = 1초)
WaitMenu := 3500        ; 메인 메뉴가 나올 때까지
WaitPage := 1800        ; 화면이 한 번 바뀔 때까지

; true 로 두면 어디를 누르는지 화면에 띄워 보여줍니다. 맞출 때만 켜세요.
Debug := false

; 640 x 480 화면에서의 버튼 위치. 창이 더 크면 알아서 늘려 씁니다.
XY_MULTIPLAYER := [200, 257]    ; 메인 메뉴의 MULTIPLAYER
XY_CREATE      := [ 90, 127]    ; CREATE GAME
XY_JOIN        := [ 90,  96]    ; JOIN GAME

; =============================================================


; ---------- 어디로 갈지 정한다 ----------
mode := "create"
if (A_Args.Length > 0 && InStr(A_Args[1], "join"))
    mode := "join"

; ---------- 게임을 켠다 (이미 켜져 있으면 그 창을 쓴다) ----------
if !ProcessExist("RainbowSix.exe") {
    if !FileExist(GamePath) {
        MsgBox "게임을 찾지 못했습니다:`n" GamePath "`n`n이 파일 위쪽의 GamePath 를 고쳐주세요.",
               "R6 런쳐", "Icon!"
        ExitApp
    }
    SplitPath GamePath, , &gameDir
    Run '"' GamePath '"', gameDir
    startedByUs := true
} else {
    startedByUs := false
}

if !WinWait("ahk_exe RainbowSix.exe", , 60) {
    MsgBox "게임 창이 60초 안에 뜨지 않았습니다.", "R6 런쳐", "Icon!"
    ExitApp
}
WinActivate "ahk_exe RainbowSix.exe"
WinWaitActive "ahk_exe RainbowSix.exe", , 10

; ---------- 오프닝을 넘기고 메뉴를 기다린다 ----------
; 이미 켜져 있던 게임이라면 오프닝은 지나갔으므로 건너뛴다
if (startedByUs) {
    Loop IntroSkip {
        Send "{Escape}"
        Sleep 700
    }
    Sleep WaitMenu
} else {
    Sleep 400
}

; ---------- 메뉴를 대신 눌러준다 ----------
ClickAt(XY_MULTIPLAYER, "MULTIPLAYER")
Sleep WaitPage

if (mode = "join")
    ClickAt(XY_JOIN, "JOIN GAME")
else
    ClickAt(XY_CREATE, "CREATE GAME")

ExitApp


/**
 * 640x480 기준 좌표를 실제 창 크기에 맞춰 누른다.
 * 창이 1024x768 이든 전체화면이든 같은 자리를 누르게 된다.
 */
ClickAt(pt, label) {
    global Debug
    if !WinExist("ahk_exe RainbowSix.exe")
        return
    WinGetClientPos , , &w, &h, "ahk_exe RainbowSix.exe"
    if (w = 0 || h = 0)
        return
    x := Round(pt[1] * w / 640)
    y := Round(pt[2] * h / 480)

    CoordMode "Mouse", "Client"
    if (Debug) {
        ToolTip label "  →  " x ", " y
        Sleep 1200
    }
    MouseMove x, y, 2
    Sleep 200
    Click
    if (Debug)
        ToolTip()
}
