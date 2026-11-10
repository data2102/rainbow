@echo off
rem ============================================================
rem  r6setup.bat - r6rank.co.kr one-time setup
rem ------------------------------------------------------------
rem  Double-click it and answer YES once. It does what the three
rem  separate files used to do, in one go:
rem    - makes C:\R6Clan and puts the launcher there
rem      (the launcher keeps itself up to date from now on)
rem    - lets the site buttons start the game (r6clan://)
rem    - runs the game as administrator (it needs it)
rem    - opens the Windows firewall for the game (TCP+UDP 2346-2418)
rem  Running it again is harmless - it just sets everything again.
rem
rem  ASCII only on purpose (cmd reads batch files by byte offset).
rem ============================================================
setlocal
title R6 Setup

rem ---------- ask for administrator once ----------
net session >nul 2>&1
if not errorlevel 1 goto :admin
echo.
echo   Windows will ask for permission - press YES.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
if errorlevel 1 goto :norights
exit /b 0

:admin
set "D=C:\R6Clan"
set "SITE=https://www.r6rank.co.kr"
echo.
echo   ==== r6rank.co.kr - setup ====
echo.

rem ---------- 1. folder + launcher ----------
if not exist "%D%" mkdir "%D%"
curl.exe -fsSL --max-time 20 "%SITE%/r6launch.bat" -o "%D%\r6launch.bat"
if errorlevel 1 goto :nonet
curl.exe -fsSL --max-time 20 "%SITE%/r6main.bat" -o "%D%\r6main.bat"
if errorlevel 1 goto :nonet
findstr /b /c:"rem R6MAIN" "%D%\r6main.bat" >nul 2>&1
if errorlevel 1 goto :nonet
echo   [O] launcher installed in %D% (it updates itself)

rem ---------- 2. site buttons -> launcher ----------
rem  Machine-wide, so it works even if YES was given with another
rem  account's password. The current user's own key is set too - an
rem  older r6clan-auto.reg wrote there, and that one wins if present.
for %%K in (HKLM HKCU) do call :proto %%K
echo   [O] site buttons connected (r6clan://)

rem ---------- 3. find the game ----------
call :findgame
if "%GAME%"=="" goto :nogame
echo   [O] game found: %GAME%

rem  the game needs administrator rights to host
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" /v "%GAME%" /t REG_SZ /d "~ RUNASADMIN" /f >nul
reg add "HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" /v "%GAME%" /t REG_SZ /d "~ RUNASADMIN" /f >nul
echo   [O] game set to run as administrator

rem ---------- 4. firewall ----------
rem  A BLOCK rule left by a cancelled "allow this app" popup beats any
rem  allow rule, so clear every rule for the game first.
netsh advfirewall firewall delete rule name=all program="%GAME%" >nul 2>&1
netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=in  action=allow program="%GAME%" enable=yes profile=any >nul
netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=out action=allow program="%GAME%" enable=yes profile=any >nul

:ports
for %%N in ("Rainbow Six UDP (r6rank)" "Rainbow Six TCP (r6rank)" "Rainbow Six PING (r6rank)") do netsh advfirewall firewall delete rule name=%%N >nul 2>&1
for %%P in (UDP TCP) do (
  netsh advfirewall firewall add rule name="Rainbow Six %%P (r6rank)" dir=in  action=allow protocol=%%P localport=2346-2418 enable=yes profile=any >nul
  netsh advfirewall firewall add rule name="Rainbow Six %%P (r6rank)" dir=out action=allow protocol=%%P localport=2346-2418 enable=yes profile=any >nul
)
netsh advfirewall firewall add rule name="Rainbow Six PING (r6rank)" dir=in action=allow protocol=icmpv4:8,any enable=yes profile=any >nul
echo   [O] firewall opened (game, TCP/UDP 2346-2418, ping)

echo.
echo   DONE. Go back to r6rank.co.kr and use the buttons.
echo   (Radmin is not needed. Hosts get set up the first time they press Start.)
echo.
pause
exit /b 0

rem ============================================================
:proto
reg add "%1\Software\Classes\r6clan" /ve /t REG_SZ /d "URL:R6 Clan Launcher" /f >nul
reg add "%1\Software\Classes\r6clan" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "%1\Software\Classes\r6clan\shell\open\command" /ve /t REG_SZ /d "cmd.exe /c C:\R6Clan\r6launch.bat \"%%1\"" /f >nul
exit /b

:findgame
rem  Plain if/goto lines only - the "(x86)" in these paths breaks cmd's
rem  ( ) block parsing.
set "GAME="
set "SUB=Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "TRY=%ProgramFiles(x86)%\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=%ProgramFiles%\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Program Files (x86)\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Program Files\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=C:\Games\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=D:\Games\%SUB%"
if exist "%TRY%" goto :usegame
set "TRY=D:\%SUB%"
if exist "%TRY%" goto :usegame
exit /b
:usegame
set "GAME=%TRY%"
exit /b

rem ============================================================
:nogame
echo   [!] Rainbow Six was not found in the usual folders.
echo       Install the game first, then run this file again.
echo       (The launcher and buttons are set up; only the game
echo        settings and the game firewall rule were skipped.)
echo.
goto :ports

:nonet
echo   [X] Could not download from %SITE%.
echo       Check the internet connection and run this file again.
echo.
pause
exit /b 1

:norights
echo   [X] Permission was not given. Run this file again and press YES.
echo.
pause
exit /b 1
