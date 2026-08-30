@echo off
setlocal
title R6 Launcher

rem ============================================================
rem  r6rank.co.kr launcher
rem ------------------------------------------------------------
rem  Called by the site as:
rem     r6clan://create                 -> host
rem     r6clan://join/1.233.204.132     -> guest
rem
rem  All it does is start the game with the right switches:
rem     host  : RainbowSix.exe -server 2346
rem     guest : RainbowSix.exe -client <host ip> 2346
rem
rem  What it did is written to r6launch.log next to this file.
rem
rem  NOTE: this file is ASCII only, on purpose.
rem  cmd.exe reads a batch file by byte offset. With non-ASCII text
rem  inside, that offset drifts and a later line gets read from the
rem  middle of a character - you get "'..' is not recognized".
rem  Korean help lives on the site instead.
rem
rem  If the game is installed elsewhere, edit the GAME line below.
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "PORT=2346"

rem seconds a guest waits so the host game is up first
set "JOINWAIT=6"

set "LOG=%~dp0r6launch.log"
set "HELP=r6rank.co.kr - launcher tab"

rem ---------- read the address the site handed us ----------
set "URL=%~1"
call :log "-------- %DATE% %TIME%"
call :log "URL     = %URL%"

set "MODE=create"
if not "%URL%"=="%URL:join=%" set "MODE=join"
if "%MODE%"=="join" call :readip

call :log "MODE    = %MODE%"
call :log "IP      = %IP%"

echo.
if "%MODE%"=="join" echo   Rainbow Six - joining host %IP%
if "%MODE%"=="create" echo   Rainbow Six - hosting a game
echo.

if not exist "%GAME%" goto :nogame

rem ---------- leave a running game alone ----------
tasklist /FI "IMAGENAME eq RainbowSix.exe" 2>nul | find /I "RainbowSix.exe" >nul
if not errorlevel 1 goto :already

if "%MODE%"=="join" call :waitforhost

rem ---------- start it ----------
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

rem ---------- did it really come up ----------
:check
ping -n 5 127.0.0.1 >nul 2>&1
tasklist /FI "IMAGENAME eq RainbowSix.exe" 2>nul | find /I "RainbowSix.exe" >nul
if errorlevel 1 goto :notstarted
call :log "RESULT  = OK"
exit /b 0


rem ============================================================
rem  problems - keep the window open and say why
rem ============================================================

:nogame
call :log "RESULT  = game not found"
echo   Game not found:
echo     %GAME%
echo.
echo   Open this file in Notepad and fix the GAME path.
goto :stop

:nodir
call :log "RESULT  = cannot enter game folder"
echo   Cannot enter the game folder:
echo     %GAMEDIR%
goto :stop

:noip
call :log "RESULT  = no host address"
echo   No host address was passed.
echo   The host must pick a connection mode on the site first.
goto :stop

:already
call :log "RESULT  = already running"
echo   Rainbow Six is already running - leaving it alone.
echo   Close the game completely, then press the button again.
goto :stop

:notstarted
call :log "RESULT  = started but no window"
echo   The game did not come up.
echo.
echo    - Did you answer YES to the Windows "allow this app" prompt?
echo    - Antivirus may be blocking it.
echo.
echo   Try these two lines by hand to see the real error:
echo.
echo      cd /d "%GAMEDIR%"
if "%MODE%"=="join" echo      "%GAME%" -client %IP% %PORT%
if "%MODE%"=="create" echo      "%GAME%" -server %PORT%
goto :stop

:stop
echo.
echo   log:  %LOG%
echo   help: %HELP%
echo.
pause
exit /b 1


rem ============================================================
rem  helpers
rem ============================================================

rem "r6clan://join/1.233.204.132/" -> 1.233.204.132
:readip
set "IP=%URL:*join/=%"
set "IP=%IP:/=%"
for /f "tokens=1 delims=:" %%A in ("%IP%") do set "IP=%%A"
exit /b

rem Give the host game a moment to come up. Warm the path there while
rem waiting - the first packet otherwise pays for route setup.
:waitforhost
if "%IP%"=="" exit /b
echo   opening the path to the host...
ping -n 3 -w 700 %IP% >nul 2>&1
echo   waiting for the host to settle...
ping -n %JOINWAIT% 127.0.0.1 >nul 2>&1
exit /b

rem one line into the log; redirect first so a trailing digit is safe
:log
>>"%LOG%" echo %~1
exit /b
