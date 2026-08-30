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
rem  If UPnP will not work it prints exactly what to type into the
rem  router by hand, with your real addresses.
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
echo   Opening the router - this takes up to 20 seconds.
echo.
echo   If the window title says "Select" and nothing moves, you clicked
echo   inside it. Windows pauses the output while text is selected.
echo   Press ESC and it will carry on.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); iex $t.Substring($t.LastIndexOf('#PS-START')+9)"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" goto :ok
goto :fail

:ok
echo   Done.
echo.
echo   Check the "router sees you as" line above against "my address"
echo   on the site. They must match. If they do not, you are behind
echo   two routers and this PC still cannot be reached - use Radmin.
echo.
echo   To undo: run r6upnp-close.bat
goto :end

:fail
echo   Not opened. Follow the steps printed above, or switch the
echo   site's connection mode to Radmin.
echo   Korean help: r6rank.co.kr - launcher tab

:end
echo.
pause
exit /b %RC%

#PS-START
$ErrorActionPreference = 'Stop'

function Line($t) { Write-Host $t }

Line '  reading this PC network settings...'

# ---------- where this PC sits ----------
$cfg = Get-NetIPConfiguration | Where-Object {
    $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up'
} | Select-Object -First 1

$ip = ''
$gw = ''
if ($cfg -and $cfg.IPv4Address) { $ip = $cfg.IPv4Address.IPAddress }
if ($cfg -and $cfg.IPv4DefaultGateway) { $gw = $cfg.IPv4DefaultGateway.NextHop }

Line ('  this PC : ' + $(if ($ip) { $ip } else { '(not found)' }))
Line ('  router  : ' + $(if ($gw) { $gw } else { '(not found)' }))
Line ''

if (-not $ip) {
    Line '  [X] Could not find this PC address.'
    exit 4
}

# ---------- UPnP needs the SSDP Discovery service ----------
# It is often off on Windows 11 or turned off by tuning tools.
# Without it the COM object answers nothing, even on a good router.
foreach ($name in 'SSDPSRV', 'upnphost') {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { continue }
    if ($svc.Status -eq 'Running') { Line ('  [O] service ' + $name + ' is running'); continue }
    Line ('  [ ] service ' + $name + ' is stopped - starting it')
    try {
        if ((Get-CimInstance Win32_Service -Filter ("Name='" + $name + "'")).StartMode -eq 'Disabled') {
            Set-Service -Name $name -StartupType Manual
        }
        Start-Service -Name $name
        Line ('  [O] service ' + $name + ' started')
    } catch {
        Line ('  [X] service ' + $name + ' would not start - ' + $_.Exception.Message)
    }
}
Line ''

# ---------- ask the router ----------
# Give it a few tries; SSDP discovery is not instant after a start.
$col = $null
for ($i = 1; $i -le 3 -and $null -eq $col; $i++) {
    Line ('  asking the router over UPnP... (' + $i + '/3)')
    try {
        $nat = New-Object -ComObject HNetCfg.NATUPnP
        $col = $nat.StaticPortMappingCollection
    } catch { $col = $null }
    if ($null -eq $col -and $i -lt 3) { Start-Sleep -Seconds 2 }
}

if ($null -eq $col) {
    Line ''
    Line '  [X] The router did not answer UPnP.'
    Line ''
    Line '  Open it by hand instead - it is a one time thing:'
    Line ''
    Line ('   1. open  http://' + $gw + '  in a browser (that is your router)')
    Line '   2. log in, then find "port forwarding"'
    Line '      (it may be called NAT, virtual server, or forwarding)'
    Line '   3. add three rules, all pointing at this PC:'
    Line ''
    Line ('        UDP  2346  ->  ' + $ip)
    Line ('        UDP  2347  ->  ' + $ip)
    Line ('        UDP  2348  ->  ' + $ip)
    Line ''
    Line '   4. while you are in there, look for a UPnP switch and turn'
    Line '      it on - then this file will work next time.'
    exit 3
}

# ---------- open ----------
$ok = 0
foreach ($p in 2346, 2347, 2348) {
    try { $col.Remove($p, 'UDP') } catch { }
    try { $col.Add($p, 'UDP', $p, $ip, $true, ('Rainbow Six ' + $p)); $ok++ }
    catch { Line ('  [X] UDP ' + $p + ' failed - ' + $_.Exception.Message) }
}
if ($ok -eq 0) { exit 5 }

# ---------- read it back ----------
# "added" is not the same as "the router kept it".
Line '  what the router actually has now:'
$seen = 0
$ext = ''
foreach ($p in 2346, 2347, 2348) {
    try {
        $m = $col.Item($p, 'UDP')
        Line ('  [O] UDP ' + $m.ExternalPort + ' -> ' + $m.InternalClient + '  (enabled: ' + $m.Enabled + ')')
        $ext = $m.ExternalIPAddress
        $seen++
    } catch {
        Line ('  [X] UDP ' + $p + ' is not there after all')
    }
}
if ($seen -eq 0) { exit 6 }

Line ''
if ($ext) { Line ('  router sees you as : ' + $ext) }
exit 0
