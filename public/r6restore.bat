@echo off
setlocal
title R6 - undo the launcher setup

rem ============================================================
rem  r6rank.co.kr - put this PC back the way it was
rem ------------------------------------------------------------
rem  Undoes what the three setup files did:
rem
rem    r6clan-auto.reg   the r6clan:// protocol, and the
rem                      "run as administrator" flag on the game
rem    r6launch.bat      the C:\R6Clan folder (asked about below)
rem    r6firewall.bat    the three Windows firewall rules
rem
rem  The game itself, Radmin VPN and your game settings are not
rem  touched. Nothing here uninstalls anything you installed.
rem
rem  One thing this cannot give back: r6firewall.bat cleared every
rem  firewall rule that already existed for RainbowSix.exe, so any
rem  rule you had made yourself is gone for good. After this runs,
rem  Windows is back to asking "allow this app on the network?" the
rem  next time the game opens - which is where it started.
rem
rem  ASCII only on purpose - see the note in r6launch.bat.
rem  Korean help: r6rank.co.kr - launcher tab
rem ============================================================

set "GAME=C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
set "LAYERS=HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"

net session >nul 2>&1
if errorlevel 1 goto :needadmin

echo.
echo   Undoing the r6rank launcher setup...
echo.

rem ---------- 1. the r6clan:// protocol ----------
reg query "HKCU\Software\Classes\r6clan" >nul 2>&1
if errorlevel 1 goto :noproto
reg delete "HKCU\Software\Classes\r6clan" /f >nul 2>&1
if errorlevel 1 goto :protofail
echo   [O] r6clan:// removed - site buttons no longer open the game
goto :layers

:noproto
echo   [-] r6clan:// was not registered - nothing to remove
goto :layers

:protofail
echo   [!] could not remove r6clan:// - try again as administrator
goto :layers

rem ---------- 2. the "run as administrator" flag ----------
:layers
call :findgame
call :droplayer "%GAME%"
call :droplayer "C:\Program Files (x86)\Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
if "%HITLAYER%"=="1" echo   [O] "run as administrator" flag on the game cleared
if not "%HITLAYER%"=="1" echo   [-] no compatibility flag was set - nothing to clear

rem ---------- 3. the firewall rules ----------
netsh advfirewall firewall delete rule name="Rainbow Six (r6rank)" >nul 2>&1
netsh advfirewall firewall delete rule name="Rainbow Six UDP (r6rank)" >nul 2>&1
netsh advfirewall firewall delete rule name="Rainbow Six PING (r6rank)" >nul 2>&1
echo   [O] firewall rules removed - Windows will ask again next time

rem ---------- 4. the C:\R6Clan folder ----------
if not exist "C:\R6Clan" goto :done
rem  cmd reads a batch file a piece at a time while it runs. Deleting the
rem  folder this file is sitting in would pull the rest of it out from
rem  under us, so in that case just say what to do.
if /I "%~dp0"=="C:\R6Clan\" goto :selffolder
echo.
echo   C:\R6Clan holds r6launch.bat and r6launch.log.
echo   The log is the only record of what the launcher did - keep it
echo   if anyone is still looking into a problem.
set "ANS="
set /p "ANS=  Delete C:\R6Clan too? (y = delete, anything else = keep) "
if /I not "%ANS%"=="y" goto :keptfolder
rd /s /q "C:\R6Clan" >nul 2>&1
if exist "C:\R6Clan" goto :folderfail
echo   [O] C:\R6Clan deleted
goto :done

:keptfolder
echo   [-] C:\R6Clan kept
goto :done

:folderfail
echo   [!] could not delete C:\R6Clan - close any open window there
echo       and delete the folder by hand
goto :done

:selffolder
echo.
echo   [-] C:\R6Clan kept - this file is inside it.
echo       Everything else is undone. To remove the folder as well,
echo       close this window and delete C:\R6Clan by hand.
goto :done

:done
echo.
echo   Done. This PC is back to where it was before the setup.
echo.
echo   The game, Radmin VPN and your MULTIPLAYER OPTIONS are untouched.
echo   You can still play by opening the game and using JOIN GAME
echo   with the host address by hand.
echo.
echo   To set it up again later, the three files are on the site:
echo     r6rank.co.kr - launcher tab
echo.
pause
exit /b 0

:needadmin
echo.
echo   Please right-click this file and pick "Run as administrator".
echo   The firewall rules cannot be removed without it.
echo.
pause
exit /b 1


rem ============================================================
rem  helpers
rem ============================================================

rem  Drop one compatibility-flag value if it is there.
:droplayer
if "%~1"=="" exit /b
reg query "%LAYERS%" /v "%~1" >nul 2>&1
if errorlevel 1 exit /b
reg delete "%LAYERS%" /v "%~1" /f >nul 2>&1
if not errorlevel 1 set "HITLAYER=1"
exit /b

rem  Look in the usual places. Plain if/goto lines only - the "(x86)"
rem  in these paths breaks cmd's ( ) block parsing.
:findgame
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
