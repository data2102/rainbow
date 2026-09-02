@echo off
setlocal enabledelayedexpansion
title R6ClanSetup - build
cd /d "%~dp0"

echo.
echo   ==================================================
echo    Rainbow Six clan installer  -  build
echo   ==================================================
echo.

rem ============================================================
rem  Find the Inno Setup compiler, and offer to fetch it if it
rem  is not here. Installing it by hand was the one step that
rem  had nothing to do with this project, so it is automated -
rem  but never silently: downloading and running an installer
rem  is the kind of thing you should be asked about first.
rem
rem  ASCII only on purpose - cmd.exe reads a batch file by byte
rem  offset, and non-ASCII text makes that offset drift.
rem  Korean help lives in READ-ME-FIRST.txt and README.md.
rem ============================================================
call :findiscc
if defined ISCC goto :havecompiler

echo   [!] Inno Setup is not installed.
echo.
echo       It is the free tool that turns this folder into a
echo       single setup .exe.  About 5 MB.
echo.
echo       This script can download and install it for you:
echo         from  https://jrsoftware.org/download.php/is.exe
echo         (the official site of Inno Setup)
echo.
echo       Windows will ask for permission - that is the
echo       Inno Setup installer asking, not this script.
echo.
set /p "GETIT=      Download and install it now?  (Y/N) "
if /i not "!GETIT!"=="Y" (
    echo.
    echo   Nothing was downloaded. Install it yourself from
    echo     https://jrsoftware.org/isdl.php
    echo   then run this file again.
    echo.
    pause
    exit /b 1
)

echo.
echo   Downloading...
set "ISDL=%TEMP%\innosetup-latest.exe"
if exist "%ISDL%" del /q "%ISDL%" >nul 2>&1

where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -L --fail --silent --show-error -o "%ISDL%" "https://jrsoftware.org/download.php/is.exe"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "try { [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile '%ISDL%' -UseBasicParsing } catch { exit 1 }"
)

if not exist "%ISDL%" (
    echo   [X] Download failed. Check the internet connection, or
    echo       install it by hand from https://jrsoftware.org/isdl.php
    echo.
    pause
    exit /b 1
)

echo   Installing - answer YES to the Windows prompt...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Start-Process -FilePath '%ISDL%' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -Verb RunAs -Wait } catch { exit 1 }"

del /q "%ISDL%" >nul 2>&1
call :findiscc
if not defined ISCC (
    echo.
    echo   [X] Inno Setup still not found after installing.
    echo       Install it by hand from https://jrsoftware.org/isdl.php
    echo       then run this file again.
    echo.
    pause
    exit /b 1
)
echo   [O] installed.
echo.

:havecompiler
echo   [O] compiler : %ISCC%

rem ---------- the launcher files this installer ships ----------
for %%F in (r6launch.bat r6firewall.bat r6upnp.bat r6upnp-close.bat) do (
    if not exist "..\public\%%F" (
        echo   [X] missing: ..\public\%%F
        echo       Keep this folder next to the "public" folder,
        echo       the way it came out of the zip.
        pause
        exit /b 1
    )
)
echo   [O] launcher : ..\public\

rem ============================================================
rem  What is in payload\
rem  Each folder holds a placeholder named _README.txt. A folder
rem  with nothing but that counts as empty, and its step is left
rem  out of the installer entirely.
rem ============================================================
set "DEFS="

if exist "payload\game\r6setup101a.part01.exe" (
    if not exist "payload\game\r6setup101a.part02.rar" goto :novol2
    if not exist "payload\game\r6setup101a.part03.rar" goto :novol3
    set "DEFS=!DEFS! /DHAVE_GAME"
    echo   [O] game     : payload\game\    ^(3 volumes^)
) else (
    echo   [!] game     : payload\game\ is empty - no game step
)

call :count skin
if !CNT! GTR 0 (
    set "DEFS=!DEFS! /DHAVE_SKIN"
    echo   [O] skin     : payload\skin\    ^(!CNT! items^)
) else (
    echo   [!] skin     : payload\skin\ is empty - no skin step
)

call :count extra
if !CNT! GTR 0 (
    set "DEFS=!DEFS! /DHAVE_EXTRA"
    echo   [O] extra    : payload\extra\   ^(!CNT! items^)
) else (
    echo   [-] extra    : payload\extra\ is empty - nothing extra
)

echo.
echo   Building - a large game folder can take several minutes.
echo   The window may look frozen. It is not. Wait for it.
echo.

if not exist "output" mkdir "output"
"%ISCC%" %DEFS% "R6ClanSetup.iss"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo   [X] Build failed. Read the error above.
    echo.
    pause
    exit /b %RC%
)

echo   ==================================================
echo    Done.
echo.
for %%F in ("output\R6ClanSetup.exe") do (
    set /a "MB=%%~zF / 1048576"
    echo    output\R6ClanSetup.exe    ^(!MB! MB^)
)
echo   ==================================================
echo.
echo   THIS is the file to hand out. One file, one double-click.
echo   Nobody else needs Inno Setup or this folder.
echo.
echo   Try it once on a PC that does NOT have the game yet
echo   before you hand it out.
echo.
if exist "output\R6ClanSetup.exe" (
    set /p "OPENIT=   Open the output folder now?  (Y/N) "
    if /i "!OPENIT!"=="Y" explorer "%~dp0output"
)
pause
exit /b 0

:novol2
echo   [X] game     : r6setup101a.part02.rar is missing.
echo       All 3 volumes are needed, with their original names.
pause
exit /b 1

:novol3
echo   [X] game     : r6setup101a.part03.rar is missing.
echo       All 3 volumes are needed, with their original names.
pause
exit /b 1

rem ---------- locate ISCC.exe ----------
:findiscc
set "ISCC="
for %%P in (
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles(x86)%\Inno Setup 5\ISCC.exe"
    "%ProgramFiles%\Inno Setup 5\ISCC.exe"
) do if exist %%P set "ISCC=%%~P"
exit /b 0

rem ---------- count real items in payload\<name>, ignoring the placeholder ----------
:count
set "CNT=0"
if not exist "payload\%~1" exit /b 0
for /f %%N in ('dir /b "payload\%~1" 2^>nul ^| findstr /v /i /x "_README.txt" ^| find /c /v ""') do set "CNT=%%N"
exit /b 0
