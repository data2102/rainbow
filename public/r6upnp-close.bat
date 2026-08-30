@echo off
chcp 65001 >nul
title R6 공유기 문 닫기

rem  r6upnp.bat 으로 연 문을 다시 닫습니다.

net session >nul 2>&1
if errorlevel 1 (
    echo   관리자 권한으로 실행해주세요.
    pause
    exit /b 1
)

echo.
echo   공유기에서 문을 닫는 중...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=(New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection; foreach($p in 2346,2347,2348){ try{ $c.Remove($p,'UDP'); Write-Host ('  [O] UDP ' + $p + ' 닫힘') }catch{ Write-Host ('  [-] UDP ' + $p + ' 이미 없음') } }"
echo.
pause
