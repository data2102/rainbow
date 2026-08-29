@echo off
chcp 65001 >nul
setlocal
title R6 런쳐

rem ============================================================
rem  r6rank.co.kr 런쳐 — 게임을 켜고 곧장 로비로
rem ------------------------------------------------------------
rem  사이트에서 이렇게 불러옵니다.
rem     r6clan://create                 → 방장
rem     r6clan://join/26.131.188.239    → 참가자
rem
rem  하는 일은 게임에 주소를 넘겨 켜는 것뿐입니다.
rem     방장  : RainbowSix.exe -server 2346
rem     참가자: RainbowSix.exe -client <방장IP> 2346
rem
rem  메뉴를 대신 눌러주지 않으므로 화면 크기와 상관없고,
rem  AutoHotkey 같은 것도 필요 없습니다.
rem
rem  게임이 다른 곳에 깔려 있으면 아래 GAME 경로만 고치세요.
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "PORT=2346"

rem 참가자가 방장보다 먼저 두드리지 않도록 기다리는 시간 (초)
set "JOINWAIT=6"

rem ---------- 사이트가 넘겨준 주소를 읽는다 ----------
set "URL=%~1"

rem 무엇이 넘어왔는지 한 줄 남겨둔다. 잘 안 될 때 이 파일만 보면 됩니다.
echo %DATE% %TIME% ^| %URL%>> "%~dp0r6launch.log"

set "MODE=create"
if not "%URL%"=="%URL:join=%" set "MODE=join"

set "IP="
if "%MODE%"=="join" (
    rem "r6clan://join/26.131.188.239/" 에서 앞뒤를 걷어낸다
    set "IP=%URL:*join/=%"
)
call set "IP=%%IP:/=%%"
rem 주소에 포트가 붙어 있으면(26.1.2.3:2346) 앞부분만 쓴다
for /f "tokens=1 delims=:" %%A in ("%IP%") do set "IP=%%A"

echo.
if "%MODE%"=="join" (
    echo   레인보우식스 · 방장 %IP% 님의 방으로 들어갑니다.
) else (
    echo   레인보우식스 · 방을 엽니다.
)
echo.

rem ---------- 게임이 있는지 ----------
if not exist "%GAME%" (
    echo   게임을 찾지 못했습니다:
    echo     %GAME%
    echo.
    echo   이 파일을 메모장으로 열어 GAME 경로를 고쳐주세요.
    echo.
    pause
    exit /b 1
)

rem ---------- 이미 켜져 있으면 손대지 않는다 ----------
rem 진행 중인 게임을 하나 더 띄우면 둘 다 엉킵니다.
tasklist /FI "IMAGENAME eq RainbowSix.exe" 2>nul | find /I "RainbowSix.exe" >nul
if not errorlevel 1 (
    echo   게임이 이미 켜져 있습니다. 그대로 두겠습니다.
    echo.
    exit /b 0
)

rem ---------- 참가자만 잠시 기다린다 ----------
rem 명령줄로 붙으면 게임이 켜지자마자 곧바로 두드립니다. 방장 게임도 이제 막
rem 켜지는 중이라, 너무 빨리 가면 아직 아무도 없습니다.
if "%MODE%"=="join" if not "%IP%"=="" (
    echo   방장에게 가는 길을 여는 중...
    rem Radmin VPN 의 길은 처음 말을 걸 때 만들어집니다. 게임이 그 첫 손님이
    rem 되면 게임이 그 시간을 다 기다리므로, 여기서 미리 두드려 둡니다.
    ping -n 3 -w 700 %IP% >nul 2>&1

    echo   방장이 자리를 잡을 때까지 잠시...
    ping -n %JOINWAIT% 127.0.0.1 >nul 2>&1
)

rem ---------- 켠다 ----------
for %%D in ("%GAME%") do set "GAMEDIR=%%~dpD"
rem 끝의 역슬래시를 떼어낸다. "C:\...\Rainbow Six\" 처럼 끝나면
rem 따옴표가 깨져서 start 가 경로를 못 알아봅니다.
if "%GAMEDIR:~-1%"=="\" set "GAMEDIR=%GAMEDIR:~0,-1%"

if "%MODE%"=="join" (
    if "%IP%"=="" (
        echo   방장 주소가 넘어오지 않았습니다.
        echo   사이트 런쳐에서 방장이 "내 Radmin 주소"를 적어두어야 합니다.
        echo.
        pause
        exit /b 1
    )
    start "" /d "%GAMEDIR%" "%GAME%" -client %IP% %PORT%
) else (
    start "" /d "%GAMEDIR%" "%GAME%" -server %PORT%
)

exit /b 0
