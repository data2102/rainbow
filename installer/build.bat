@echo off
setlocal enabledelayedexpansion
title R6ClanSetup - build
cd /d "%~dp0"

echo.
echo   ============================================
echo    Rainbow Six clan installer - build
echo   ============================================
echo.

rem ---------- find the Inno Setup compiler ----------
set "ISCC="
for %%P in (
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles(x86)%\Inno Setup 5\ISCC.exe"
    "%ProgramFiles%\Inno Setup 5\ISCC.exe"
) do if exist %%P set "ISCC=%%~P"

if not defined ISCC (
    echo   [X] Inno Setup was not found.
    echo.
    echo       Install it first - it is free:
    echo         https://jrsoftware.org/isdl.php
    echo.
    echo       If you installed it somewhere else, open this file in
    echo       Notepad and add that path to the list above.
    echo.
    pause
    exit /b 1
)
echo   [O] compiler : %ISCC%

rem ---------- is there a game folder to pack ----------
if exist "payload\game\RainbowSix.exe" (
    echo   [O] game     : payload\game\
) else (
    echo   [!] game     : payload\game\RainbowSix.exe not found
    echo                  building the clan-settings-only installer.
)

rem ---------- the launcher files this installer ships ----------
for %%F in (r6launch.bat r6firewall.bat r6upnp.bat r6upnp-close.bat) do (
    if not exist "..\public\%%F" (
        echo   [X] missing: ..\public\%%F
        echo       run this from inside the repository.
        pause
        exit /b 1
    )
)
echo   [O] launcher : ..\public\

echo.
echo   Building - this can take several minutes for a large game folder.
echo.

if not exist "output" mkdir "output"
"%ISCC%" "R6ClanSetup.iss"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo   [X] Build failed. Read the error above.
    echo.
    pause
    exit /b %RC%
)

echo   ============================================
echo    Done.
echo.
for %%F in ("output\R6ClanSetup.exe") do (
    set /a "MB=%%~zF / 1048576"
    echo    output\R6ClanSetup.exe   ^(!MB! MB^)
)
echo   ============================================
echo.
echo   Test it on a PC that does not have the game yet
echo   before handing it out.
echo.
pause
