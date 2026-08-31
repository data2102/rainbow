@echo off
setlocal
title R6 - Windows firewall

rem ============================================================
rem  r6rank.co.kr - open the Windows firewall for Rainbow Six
rem ------------------------------------------------------------
rem  This is THIS PC's door. r6upnp.bat opens the ROUTER's door.
rem  Everyone runs this one; only the host needs r6upnp.bat.
rem
rem  The game knocks on three ports when connecting. If one is
rem  blocked it waits for a timeout before trying the next, and
rem  that waiting is what makes joining slow.
rem
rem  Opens:
rem   - RainbowSix.exe (in and out)
rem   - UDP 2346 (JOIN) 2347 (ANNOUNCE) 2348 (INFO)
rem   - ping replies, used by the launcher to warm the path
rem
rem  ASCII only on purpose - see the note in r6launch.bat.
rem  Korean help: r6rank.co.kr - launcher tab
rem  To undo: see the bottom of this window after it runs.
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Please right-click this file and pick "Run as administrator".
    echo.
    pause
    exit /b 1
)

call :findgame

echo.
echo   Opening the Windows firewall...
echo.

rem drop old rules first so repeated runs do not pile up
netsh advfirewall firewall delete rule name="Rainbow Six (r6rank)" >nul 2>&1
netsh advfirewall firewall delete rule name="Rainbow Six UDP (r6rank)" >nul 2>&1
netsh advfirewall firewall delete rule name="Rainbow Six PING (r6rank)" >nul 2>&1

if exist "%GAME%" (
    netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=in  action=allow program="%GAME%" enable=yes profile=any >nul
    netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=out action=allow program="%GAME%" enable=yes profile=any >nul
    echo   [O] game allowed through
) else (
    echo   [!] game not found:
    echo       %GAME%
    echo       open this file in Notepad and fix the GAME path.
    echo       opening the ports anyway.
)

netsh advfirewall firewall add rule name="Rainbow Six UDP (r6rank)" dir=in  action=allow protocol=UDP localport=2346-2348 enable=yes profile=any >nul
netsh advfirewall firewall add rule name="Rainbow Six UDP (r6rank)" dir=out action=allow protocol=UDP localport=2346-2348 enable=yes profile=any >nul
echo   [O] UDP 2346 - 2348 opened

netsh advfirewall firewall add rule name="Rainbow Six PING (r6rank)" dir=in action=allow protocol=icmpv4:8,any enable=yes profile=any >nul
echo   [O] ping replies allowed

echo.
echo   Done. Open the game and try connecting again.
echo.
echo   To undo, paste these three lines into this window:
echo     netsh advfirewall firewall delete rule name="Rainbow Six (r6rank)"
echo     netsh advfirewall firewall delete rule name="Rainbow Six UDP (r6rank)"
echo     netsh advfirewall firewall delete rule name="Rainbow Six PING (r6rank)"
echo.
pause
exit /b 0

:findgame
rem  Look in the usual places. 32-bit Windows has no "Program Files (x86)"
rem  folder at all, so a machine that runs the game fine still misses here.
rem  Plain if/goto lines only - the "(x86)" in these paths breaks cmd's
rem  ( ) block parsing.
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
