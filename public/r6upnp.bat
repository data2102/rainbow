@echo off
chcp 65001 >nul
setlocal
title R6 공유기 문 열기

rem ============================================================
rem  r6rank.co.kr — 공유기에 레인보우식스 문 열기 (방장만)
rem ------------------------------------------------------------
rem  공인 IP 방식으로 방장을 하려면, 공유기가 바깥에서 온 신호를
rem  내 컴퓨터까지 들여보내 줘야 합니다. 이 파일이 그 문을 엽니다.
rem
rem  UPnP 라는 규격을 씁니다. 예전 Voobly 도 같은 방법을 썼습니다.
rem  윈도우에 이미 들어 있는 기능이라 따로 설치할 것은 없습니다.
rem
rem  참가만 하는 사람은 실행하지 않아도 됩니다.
rem  방장을 할 때만, 한 번만 하면 됩니다.
rem
rem  여는 문: UDP 2346(JOIN) 2347(ANNOUNCE) 2348(INFO)
rem
rem  아래쪽 #PS-START 뒤가 실제로 하는 일입니다. 그대로 읽힙니다.
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   관리자 권한이 필요합니다.
    echo   이 파일을 오른쪽 클릭 - "관리자 권한으로 실행" 해주세요.
    echo.
    pause
    exit /b 1
)

echo.
echo   공유기에 문을 여는 중...
echo.

rem 이 파일 아래쪽의 파워셸 부분을 그대로 읽어서 실행한다.
rem (한 줄에 억지로 이어 붙이면 따옴표가 깨지기 쉬워 이렇게 나눠 두었다)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); iex $t.Substring($t.LastIndexOf('#PS-START')+9)"

set "RC=%ERRORLEVEL%"
echo.

if "%RC%"=="0" (
    echo   끝났습니다. 사이트 런쳐에서 실행하기를 눌러보세요.
    echo.
    echo   되돌리려면 이 파일을 지우지 말고, 공유기를 껐다 켜면 사라집니다.
    echo   바로 지우려면 r6upnp-close.bat 을 실행하세요.
) else (
    echo   ------------------------------------------------------------
    echo   자동으로 열지 못했습니다. 공유기에서 직접 열어주세요.
    echo.
    echo    1. 브라우저에 192.168.0.1 또는 192.168.1.1 을 칩니다
    echo    2. "포트 포워딩" 메뉴를 찾습니다
    echo    3. UDP 2346, 2347, 2348 을 내 컴퓨터로 보내도록 추가합니다
    echo.
    echo   공유기 설정에 UPnP 항목이 있으면 켜고 다시 실행해도 됩니다.
    echo.
    echo   그래도 안 되면 사이트 런쳐에서 접속 방식을 Radmin 으로 바꾸세요.
    echo   ------------------------------------------------------------
)

echo.
pause
exit /b %RC%

#PS-START
$ErrorActionPreference = 'Stop'

try {
    $nat = New-Object -ComObject HNetCfg.NATUPnP
} catch {
    Write-Host '  [X] 이 컴퓨터에서 UPnP 기능을 쓸 수 없습니다.'
    exit 2
}

$col = $nat.StaticPortMappingCollection
if ($null -eq $col) {
    Write-Host '  [X] 공유기가 UPnP 에 응답하지 않습니다. (공유기에서 UPnP 가 꺼져 있을 수 있습니다)'
    exit 3
}

# 공유기로 나가는 길에 붙어 있는 내 컴퓨터 주소를 찾는다
$cfg = Get-NetIPConfiguration | Where-Object {
    $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up'
} | Select-Object -First 1

if (-not $cfg -or -not $cfg.IPv4Address) {
    Write-Host '  [X] 내 컴퓨터의 주소를 찾지 못했습니다.'
    exit 4
}
$ip = $cfg.IPv4Address.IPAddress
Write-Host ('  내 컴퓨터 : ' + $ip)
Write-Host ('  공유기    : ' + $cfg.IPv4DefaultGateway.NextHop)
Write-Host ''

$ok = 0
foreach ($p in 2346, 2347, 2348) {
    try { $col.Remove($p, 'UDP') } catch { }
    try {
        $col.Add($p, 'UDP', $p, $ip, $true, ('Rainbow Six ' + $p))
        Write-Host ('  [O] UDP ' + $p + ' 열림')
        $ok++
    } catch {
        Write-Host ('  [X] UDP ' + $p + ' 실패 - ' + $_.Exception.Message)
    }
}

if ($ok -eq 0) { exit 5 }
exit 0
