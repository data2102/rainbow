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

rem Seconds a guest waits before starting, so the host game is up first.
rem Lower it if joining feels slow; raise it if the guest arrives before
rem the host is ready and the join fails.
rem The site sends "/now" in the url when the host has already been up a
rem while (someone pressing Join late) - then there is nothing to wait for.
set "JOINWAIT=1"

set "LOG=%~dp0r6launch.log"
set "HELP=r6rank.co.kr - launcher tab"

rem ---------- read the address the site handed us ----------
set "URL=%~1"
call :log "-------- %DATE% %TIME%"
call :log "URL     = %URL%"

set "MODE=create"
if not "%URL%"=="%URL:join=%" set "MODE=join"
if not "%URL%"=="%URL:/now/=%" set "JOINWAIT=0"
if "%MODE%"=="join" call :readip

call :log "MODE    = %MODE%"
call :log "IP      = %IP%"
call :log "WAIT    = %JOINWAIT%"

echo.
if "%MODE%"=="join" echo   Rainbow Six - joining host %IP%
if "%MODE%"=="create" echo   Rainbow Six - hosting a game
echo.

call :findgame
call :log "GAME    = %GAME%"
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
rem  A join url with no address behind it leaves a stray "/" or a word
rem  here, and the game would open and sit on a screen it can never
rem  leave. Four dot-separated pieces is what an address looks like.
set "IPOK="
for /f "tokens=1-4 delims=." %%A in ("%IP%") do if not "%%D"=="" set "IPOK=1"
if not "%IPOK%"=="1" goto :badip
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

:findgame
rem  Look in the usual places. 32-bit Windows has no "Program Files (x86)"
rem  at all, so a machine that runs the game fine can still fail here.
rem  Each line is a plain if/goto - no ( ) blocks, because the "(x86)" in
rem  these paths breaks cmd's block parsing.
if exist "%GAME%" goto :eof
set "SUB=Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "TRY=%ProgramFiles%\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=%ProgramFiles(x86)%\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Program Files\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Program Files (x86)\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Games\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=D:\Games\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=D:\%SUB%"
if exist "%TRY%" goto :usegame
goto :eof

:usegame
set "GAME=%TRY%"
goto :eof

:nogame
call :log "RESULT  = game not found"
echo   Game not found. Looked in:
echo     %ProgramFiles%\Red Storm Entertainment\...
echo     C:\Program Files\Red Storm Entertainment\...
echo     C:\Program Files (x86)\Red Storm Entertainment\...
echo     C:\Games\  and  D:\Games\
echo.
echo   If the game is somewhere else, open this file in Notepad
echo   and put its full path on the GAME line near the top.
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

:badip
rem  A join url with no address behind it lands here. Starting the game
rem  with a stray "/" as the host looks like it worked - the game opens
rem  and then sits on a screen it can never leave. Say so instead.
call :log "RESULT  = bad host address (%IP%)"
echo   The address handed over is not an IP address:
echo     %IP%
echo.
echo   This happens when Join is pressed before the host has started,
echo   or before the host has entered a Radmin address.
echo.
echo   Ask the host to press Start on the site, then press Join again.
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

rem The address is the last piece of the url, whatever comes before it:
rem   r6clan://join/1.233.204.132       -> 1.233.204.132
rem   r6clan://join/now/1.233.204.132/  -> 1.233.204.132
:readip
set "T=%URL:/= %"
for %%A in (%T%) do set "IP=%%A"
for /f "tokens=1 delims=:" %%A in ("%IP%") do set "IP=%%A"
exit /b

rem Give the host game a moment to come up. Warm the path there while
rem waiting - the first packet otherwise pays for route setup.
:waitforhost
if "%IP%"=="" exit /b
echo   opening the path to the host...
ping -n 2 -w 500 %IP% >nul 2>&1
if "%JOINWAIT%"=="0" exit /b
echo   waiting %JOINWAIT%s for the host to settle...
rem ping -n N waits N-1 seconds between pings, so ask for one more.
rem That way JOINWAIT is the real number of seconds, not one less.
set /a "TICKS=%JOINWAIT% + 1"
ping -n %TICKS% 127.0.0.1 >nul 2>&1
exit /b

rem one line into the log; redirect first so a trailing digit is safe
:log
>>"%LOG%" echo %~1
exit /b
