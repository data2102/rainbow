@echo off
title R6 - close the router

rem  Undo what r6upnp.bat opened.  ASCII only on purpose.

net session >nul 2>&1
if errorlevel 1 (
    echo   Please right-click and "Run as administrator".
    pause
    exit /b 1
)

echo.
echo   Closing...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=(New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection; foreach($p in 2346,2347,2348){ try{ $c.Remove($p,'UDP'); Write-Host ('  [O] UDP ' + $p + ' closed') }catch{ Write-Host ('  [-] UDP ' + $p + ' was not open') } }"
echo.
pause
