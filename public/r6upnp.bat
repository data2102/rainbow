@echo off
setlocal
title R6 - open the router

rem ============================================================
rem  r6rank.co.kr - open the router for Rainbow Six (HOST only)
rem ------------------------------------------------------------
rem  To host with the "public IP" mode, your router has to let the
rem  other players' packets reach this PC. This opens that door,
rem  using UPnP - the same thing Voobly used. Nothing to install.
rem
rem  Guests do not need this file. Host only, once.
rem  Opens: UDP 2346 (JOIN) 2347 (ANNOUNCE) 2348 (INFO)
rem
rem  ASCII only on purpose - see the note in r6launch.bat.
rem  Korean help: r6rank.co.kr - launcher tab
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Please right-click this file and pick "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo.
echo   Opening the router...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); iex $t.Substring($t.LastIndexOf('#PS-START')+9)"

set "RC=%ERRORLEVEL%"
echo.

if "%RC%"=="0" goto :ok
goto :fail

:ok
echo   Done. Compare the "router sees you as" address above with
echo   "my address" on the site. They must be the same.
echo   If they differ you are behind two routers, and this PC still
echo   cannot be reached - use the Radmin mode instead.
echo.
echo   To undo: run r6upnp-close.bat
goto :end

:fail
echo   ------------------------------------------------------------
echo   Could not open it automatically. Do it by hand:
echo.
echo    1. open 192.168.0.1 or 192.168.1.1 in a browser
echo    2. find "port forwarding"
echo    3. forward UDP 2346, 2347 and 2348 to this PC
echo.
echo   If the router has a UPnP setting, turn it on and run this again.
echo   Still stuck - switch the site's connection mode to Radmin.
echo   ------------------------------------------------------------

:end
echo.
pause
exit /b %RC%

#PS-START
$ErrorActionPreference = 'Stop'

try {
    $nat = New-Object -ComObject HNetCfg.NATUPnP
} catch {
    Write-Host '  [X] UPnP is not available on this PC.'
    exit 2
}

$col = $nat.StaticPortMappingCollection
if ($null -eq $col) {
    Write-Host '  [X] The router did not answer UPnP (it may be switched off there).'
    exit 3
}

# the address of this PC on the way out to the router
$cfg = Get-NetIPConfiguration | Where-Object {
    $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up'
} | Select-Object -First 1

if (-not $cfg -or -not $cfg.IPv4Address) {
    Write-Host '  [X] Could not find this PC address.'
    exit 4
}
$ip = $cfg.IPv4Address.IPAddress
Write-Host ('  this PC : ' + $ip)
Write-Host ('  router  : ' + $cfg.IPv4DefaultGateway.NextHop)
Write-Host ''

$ok = 0
foreach ($p in 2346, 2347, 2348) {
    try { $col.Remove($p, 'UDP') } catch { }
    try {
        $col.Add($p, 'UDP', $p, $ip, $true, ('Rainbow Six ' + $p))
        $ok++
    } catch {
        Write-Host ('  [X] UDP ' + $p + ' failed - ' + $_.Exception.Message)
    }
}

if ($ok -eq 0) { exit 5 }

# read it back - saying "added" is not the same as it being there
Write-Host '  checking what the router actually has:'
$seen = 0
$ext = ''
foreach ($p in 2346, 2347, 2348) {
    try {
        $m = $col.Item($p, 'UDP')
        Write-Host ('  [O] UDP ' + $m.ExternalPort + ' -> ' + $m.InternalClient + '  (enabled: ' + $m.Enabled + ')')
        $ext = $m.ExternalIPAddress
        $seen++
    } catch {
        Write-Host ('  [X] UDP ' + $p + ' is not there after all')
    }
}

if ($seen -eq 0) { exit 6 }

Write-Host ''
if ($ext) { Write-Host ('  router sees you as : ' + $ext) }
exit 0
