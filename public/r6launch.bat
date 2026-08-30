@echo off
chcp 65001 >nul
setlocal
title R6 런쳐

rem ============================================================
rem  r6rank.co.kr 런쳐 — 게임을 켜고 곧장 로비로
rem ------------------------------------------------------------
rem  사이트에서 이렇게 불러옵니다.
rem     r6clan://create                 → 방장
rem     r6clan://join/1.233.204.132     → 참가자
rem
rem  하는 일은 게임에 주소를 넘겨 켜는 것뿐입니다.
rem     방장  : RainbowSix.exe -server 2346
rem     참가자: RainbowSix.exe -client <방장IP> 2346
rem
rem  한 일은 r6launch.log 에 남습니다. 안 될 때 그 파일을 보면 됩니다.
rem
rem  게임이 다른 곳에 깔려 있으면 아래 GAME 경로만 고치세요.
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "PORT=2346"

rem 참가자가 방장보다 먼저 두드리지 않도록 기다리는 시간 (초)
set "JOINWAIT=6"

set "LOG=%~dp0r6launch.log"

rem ---------- 사이트가 넘겨준 주소를 읽는다 ----------
set "URL=%~1"
call :log "-------- %DATE% %TIME%"
call :log "URL     = %URL%"

set "MODE=create"
if not "%URL%"=="%URL:join=%" set "MODE=join"
if "%MODE%"=="join" call :readip

call :log "MODE    = %MODE%"
call :log "IP      = %IP%"

echo.
if "%MODE%"=="join" echo   레인보우식스 · 방장 %IP% 님의 방으로 들어갑니다.
if "%MODE%"=="create" echo   레인보우식스 · 방을 엽니다.
echo.

rem ---------- 게임이 있는지 ----------
if not exist "%GAME%" goto :nogame

rem ---------- 이미 켜져 있으면 손대지 않는다 ----------
rem 진행 중인 게임을 하나 더 띄우면 둘 다 엉킵니다.
tasklist /FI "IMAGENAME eq RainbowSix.exe" 2>nul | find /I "RainbowSix.exe" >nul
if not errorlevel 1 goto :already

rem ---------- 참가자만 잠시 기다린다 ----------
if "%MODE%"=="join" call :waitforhost

rem ---------- 켠다 ----------
rem 게임 폴더로 옮겨두고 켠다. start /d 에 경로를 주면 끝의 역슬래시 때문에
rem 따옴표가 깨지는 일이 있어, 아예 cd 로 옮기는 편이 안전하다.
for %%D in ("%GAME%") do set "GAMEDIR=%%~dpD"
cd /d "%GAMEDIR%" 2>nul
if errorlevel 1 goto :nodir

if "%MODE%"=="join" goto :runjoin

:runcreate
call :log "RUN     = -server %PORT%"
start "" "%GAME%" -server %PORT%
goto :check

:runjoin
if "%IP%"=="" goto :noip
call :log "RUN     = -client %IP% %PORT%"
start "" "%GAME%" -client %IP% %PORT%
goto :check

rem ---------- 정말 떴는지 확인한다 ----------
rem 여기까지 조용히 닫혀버리면 왜 안 됐는지 알 길이 없다.
:check
ping -n 5 127.0.0.1 >nul 2>&1
tasklist /FI "IMAGENAME eq RainbowSix.exe" 2>nul | find /I "RainbowSix.exe" >nul
if errorlevel 1 goto :notstarted
call :log "RESULT  = OK"
exit /b 0


rem ============================================================
rem  잘 안 된 경우 — 창을 닫지 않고 이유를 보여준다
rem ============================================================

:nogame
call :log "RESULT  = 게임 파일 없음"
echo   게임을 찾지 못했습니다:
echo     %GAME%
echo.
echo   이 파일을 메모장으로 열어 GAME 경로를 고쳐주세요.
goto :stop

:nodir
call :log "RESULT  = 게임 폴더로 이동 실패"
echo   게임 폴더로 들어가지 못했습니다:
echo     %GAMEDIR%
goto :stop

:noip
call :log "RESULT  = 방장 주소 없음"
echo   방장 주소가 넘어오지 않았습니다.
echo   사이트 런쳐에서 방장이 접속 방식을 정해두어야 합니다.
goto :stop

:already
call :log "RESULT  = 이미 실행 중"
echo   게임이 이미 켜져 있습니다. 그대로 두겠습니다.
echo.
echo   방금 누른 것이 반영되지 않았다면, 게임을 완전히 끄고 다시 눌러주세요.
goto :stop

:notstarted
call :log "RESULT  = 실행했지만 게임이 뜨지 않음"
echo   게임을 켰지만 창이 뜨지 않았습니다.
echo.
echo    · "이 앱이 디바이스를 변경하도록 허용하시겠어요?" 창에서
echo      [예] 를 누르셨나요? [아니오] 를 누르면 게임이 켜지지 않습니다.
echo    · 백신이나 보안 프로그램이 막고 있을 수 있습니다.
echo.
echo   아래 두 줄을 그대로 붙여넣어 보시면 무엇이 문제인지 보입니다.
echo.
echo      cd /d "%GAMEDIR%"
if "%MODE%"=="join" echo      "%GAME%" -client %IP% %PORT%
if "%MODE%"=="create" echo      "%GAME%" -server %PORT%
goto :stop

:stop
echo.
echo   (자세한 기록: %LOG%)
echo.
pause
exit /b 1


rem ============================================================
rem  거들어주는 것들
rem ============================================================

rem "r6clan://join/1.233.204.132/" 에서 주소만 걷어낸다
:readip
set "IP=%URL:*join/=%"
set "IP=%IP:/=%"
rem 뒤에 포트가 붙어 있으면(1.2.3.4:2346) 앞부분만 쓴다
for /f "tokens=1 delims=:" %%A in ("%IP%") do set "IP=%%A"
exit /b

rem 방장 게임이 자리를 잡을 시간을 준다.
rem 명령줄로 붙으면 게임이 켜지자마자 곧바로 두드리기 때문에,
rem 너무 빨리 가면 아직 아무도 없다. 기다리는 김에 길도 함께 터둔다.
:waitforhost
if "%IP%"=="" exit /b
echo   방장에게 가는 길을 여는 중...
ping -n 3 -w 700 %IP% >nul 2>&1
echo   방장이 자리를 잡을 때까지 잠시...
ping -n %JOINWAIT% 127.0.0.1 >nul 2>&1
exit /b

rem 한 줄 남긴다. 숫자로 끝나도 리디렉션으로 오해받지 않도록 앞에 쓴다.
:log
>>"%LOG%" echo %~1
exit /b
