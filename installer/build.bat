@echo off
setlocal enabledelayedexpansion
title R6ClanSetup - build
cd /d "%~dp0"

echo.
echo   ==================================================
echo    Rainbow Six clan installer  -  build
echo   ==================================================
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
    echo       Installed it elsewhere? Open this file in Notepad
    echo       and add that path to the list above.
    echo.
    pause
    exit /b 1
)
echo   [O] compiler : %ISCC%

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

rem ---------- what is in payload\ ----------
rem  Each folder holds a placeholder named _README.txt. A folder that has
rem  nothing but that placeholder counts as empty, and its step is left out
rem  of the installer entirely.
set "DEFS="

if exist "payload\game\r6setup101a.part01.exe" (
    if exist "payload\game\r6setup101a.part02.rar" (
        if exist "payload\game\r6setup101a.part03.rar" (
            set "DEFS=!DEFS! /DHAVE_GAME"
            echo   [O] game     : payload\game\   ^(3 volumes^)
        ) else (
            echo   [X] game     : part03.rar is missing - all 3 volumes are needed
            pause
            exit /b 1
        )
    ) else (
        echo   [X] game     : part02.rar is missing - all 3 volumes are needed
        pause
        exit /b 1
    )
) else (
    echo   [!] game     : payload\game\ is empty - skipping the game step
)

call :count skin
if !CNT! GTR 0 (
    set "DEFS=!DEFS! /DHAVE_SKIN"
    echo   [O] skin     : payload\skin\    ^(!CNT! items^)
) else (
    echo   [!] skin     : payload\skin\ is empty - skipping the skin step
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
echo   Test it on a PC that does NOT have the game yet
echo   before handing it out.
echo.
pause
exit /b 0

rem ---------- count real items in payload\<name>, ignoring the placeholder ----------
:count
set "CNT=0"
if not exist "payload\%~1" exit /b 0
for /f %%N in ('dir /b "payload\%~1" 2^>nul ^| findstr /v /i /x "_README.txt" ^| find /c /v ""') do set "CNT=%%N"
exit /b 0
