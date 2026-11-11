@echo off
rem ============================================================
rem  r6launch.bat - r6rank.co.kr launcher (starter)
rem ------------------------------------------------------------
rem  The site buttons (r6clan://...) open this file. It never
rem  changes: it fetches the current launcher (r6main.bat) from
rem  the site and runs it, so members do not have to download
rem  anything again when the launcher is improved.
rem  If the site cannot be reached it uses the copy from last time.
rem
rem  Installed by r6setup.bat into C:\R6Clan. ASCII only.
rem ============================================================
setlocal
set "D=%~dp0"
curl.exe -fsSL --max-time 6 "https://www.r6rank.co.kr/r6main.bat" -o "%D%r6main.new" >nul 2>&1
if errorlevel 1 goto :run
rem  keep it only if it really is the launcher (not an error page)
findstr /b /c:"rem R6MAIN" "%D%r6main.new" >nul 2>&1
if errorlevel 1 goto :run
move /y "%D%r6main.new" "%D%r6main.bat" >nul

:run
if exist "%D%r6main.new" del "%D%r6main.new" >nul 2>&1
if not exist "%D%r6main.bat" goto :nomain
call "%D%r6main.bat" %*
exit /b %errorlevel%

:nomain
echo.
echo   Could not get the launcher from r6rank.co.kr.
echo   Check the internet connection and press the button again.
echo.
pause
exit /b 1
