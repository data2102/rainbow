@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  r6rank.co.kr — 레인보우식스 방화벽 열기
rem ------------------------------------------------------------
rem  JOIN 이 오래 걸리는 가장 흔한 이유는 윈도우 방화벽입니다.
rem  게임은 접속할 때 상대의 포트 세 개를 두드려 보는데, 막혀 있으면
rem  "응답 없음"으로 판정될 때까지 기다렸다가 다음을 시도합니다.
rem  그 기다림이 쌓여 접속이 느려집니다.
rem
rem  이 파일은 그 문을 열어줍니다. 방장·참가자 모두 한 번씩 실행하세요.
rem
rem  하는 일
rem   · RainbowSix.exe 를 방화벽에서 허용 (들어오는 것/나가는 것)
rem   · UDP 2346(JOIN) 2347(ANNOUNCE) 2348(INFO) 열기
rem
rem  되돌리려면 이 파일 맨 아래 설명을 보세요.
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   관리자 권한이 필요합니다.
    echo   이 파일을 오른쪽 클릭 - "관리자 권한으로 실행" 해주세요.
    echo.
    pause
    exit /b 1
)

echo.
echo   레인보우식스 방화벽을 엽니다...
echo.

rem 예전에 만든 규칙이 있으면 지우고 새로 만든다 (여러 번 실행해도 쌓이지 않게)
netsh advfirewall firewall delete rule name="Rainbow Six (r6rank)" >nul 2>&1
netsh advfirewall firewall delete rule name="Rainbow Six UDP (r6rank)" >nul 2>&1

if exist "%GAME%" (
    netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=in  action=allow program="%GAME%" enable=yes profile=any >nul
    netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=out action=allow program="%GAME%" enable=yes profile=any >nul
    echo   [O] 게임 프로그램 허용
) else (
    echo   [!] 게임을 찾지 못했습니다:
    echo       %GAME%
    echo       이 파일을 메모장으로 열어 GAME 경로를 고쳐주세요.
    echo       포트만 열고 계속합니다.
)

netsh advfirewall firewall add rule name="Rainbow Six UDP (r6rank)" dir=in  action=allow protocol=UDP localport=2346-2348 enable=yes profile=any >nul
netsh advfirewall firewall add rule name="Rainbow Six UDP (r6rank)" dir=out action=allow protocol=UDP localport=2346-2348 enable=yes profile=any >nul
echo   [O] UDP 2346 - 2348 열기

echo.
echo   끝났습니다. 게임을 다시 켜서 접속해보세요.
echo.
echo   되돌리려면 이 창에 아래 두 줄을 붙여넣으면 됩니다.
echo     netsh advfirewall firewall delete rule name="Rainbow Six (r6rank)"
echo     netsh advfirewall firewall delete rule name="Rainbow Six UDP (r6rank)"
echo.
pause
