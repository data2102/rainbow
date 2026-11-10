# ============================================================
#  r6host.ps1 - make this PC a host for the r6rank.co.kr relay
# ------------------------------------------------------------
#  Run by r6launch.bat (r6clan://register/<token>) as administrator:
#    r6host.ps1 -Register <token>   one time per PC
#  Installed as a hidden task that runs at startup:
#    r6host.ps1 -Watch              keeps the tunnel up and the
#                                   port forward pointing at the game
#
#  Why the forward: the game listens on TCP 2346 only on ONE address
#  (the home LAN address, or Radmin's if Radmin is on), never on the
#  tunnel address. Players arrive on the tunnel address, so without a
#  forward they are refused. -Watch looks at where the game actually
#  listens every few seconds and points the forward there - so a new
#  home address or Radmin being on does not matter.
#
#  The private key is made here and never leaves this PC. Only the
#  public half goes to the site.
#
#  ASCII only on purpose (Windows PowerShell 5 reads files as ANSI).
# ============================================================
param([string]$Register = '', [switch]$Watch)

# 'Continue', not 'Stop': in Windows PowerShell 5 a native command's stderr (netsh says
# "not found" when deleting nothing) becomes a terminating error under 'Stop' and would
# kill the watcher. Cmdlets that must succeed say -ErrorAction Stop themselves.
$ErrorActionPreference = 'Continue'
$Dir     = 'C:\R6Clan'
$Site    = 'https://www.r6rank.co.kr'
$Tunnel  = 'r6relay'
$Conf    = Join-Path $Dir "$Tunnel.conf"
$LogFile = Join-Path $Dir 'r6host.log'
$WgDir   = Join-Path $env:ProgramFiles 'WireGuard'
$Port    = 2346
$TaskName = 'R6Relay Host'

function Log([string]$m) {
  try {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Remove-Item $LogFile -Force }
    Add-Content -Path $LogFile -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding ASCII
  } catch {}
}
function Say([string]$m) { Write-Host "  $m"; Log $m }

# ---------------------------------------------------------------- watch
function Get-TunnelIp {
  if (-not (Test-Path $Conf)) { return $null }
  $line = Get-Content $Conf | Where-Object { $_ -match '^\s*Address\s*=\s*([0-9.]+)' } | Select-Object -First 1
  if ($line -match '([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)') { return $Matches[1] }
  return $null
}

function Get-ProxyTarget([string]$listenIp) {
  $out = & netsh interface portproxy show v4tov4 2>$null
  foreach ($l in $out) {
    if ($l -match '^\s*([0-9.]+)\s+([0-9]+)\s+([0-9.]+)\s+([0-9]+)\s*$') {
      if ($Matches[1] -eq $listenIp -and [int]$Matches[2] -eq $Port) { return $Matches[3] }
    }
  }
  return $null
}

function Set-Proxy([string]$listenIp, [string]$target) {
  & netsh interface portproxy delete v4tov4 listenaddress=$listenIp listenport=$Port 2>$null | Out-Null
  if ($target) {
    & netsh interface portproxy add v4tov4 listenaddress=$listenIp listenport=$Port connectaddress=$target connectport=$Port | Out-Null
  }
}

function Watch-Loop {
  Log 'watch: start'
  while ($true) {
    try {
      $tip = Get-TunnelIp
      if ($tip) {
        $svc = Get-Service -Name "WireGuardTunnel`$$Tunnel" -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc; Log 'watch: tunnel restarted' }

        # where is the GAME listening? (not our own forward on the tunnel address)
        $game = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
          Where-Object { $_.LocalAddress -ne $tip -and $_.LocalAddress -notmatch ':' } |
          Where-Object {
            $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            $p -and $p.ProcessName -like 'RainbowSix*'
          } | Select-Object -First 1

        $want = $null
        if ($game -and $game.LocalAddress -ne '0.0.0.0') { $want = $game.LocalAddress }
        $have = Get-ProxyTarget $tip
        if ($want -ne $have) {
          # No game -> no forward, so a game that binds 0.0.0.0 next time is not blocked.
          Set-Proxy $tip $want
          Log ("watch: forward {0}:{1} -> {2}" -f $tip, $Port, $(if ($want) { $want } else { '(none)' }))
        }
      }
    } catch { Log ("watch: " + $_.Exception.Message) }
    Start-Sleep -Seconds 3
  }
}

# ---------------------------------------------------------------- register
function Find-Game {
  $sub = "Red Storm Entertainment\Tom Clancy's Rainbow Six\RainbowSix.exe"
  $try = @("${env:ProgramFiles(x86)}\$sub", "$env:ProgramFiles\$sub", "C:\Games\$sub", "D:\Games\$sub", "D:\$sub")
  foreach ($t in $try) { if ($t -and (Test-Path $t)) { return $t } }
  return $null
}

function Install-WireGuard {
  if (Test-Path (Join-Path $WgDir 'wireguard.exe')) { Say 'WireGuard: already installed'; return }
  Say 'WireGuard: downloading the official installer...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path $env:TEMP 'wireguard-installer.exe'
  Invoke-WebRequest -Uri 'https://download.wireguard.com/windows-client/wireguard-installer.exe' -OutFile $tmp -UseBasicParsing -ErrorAction Stop
  Start-Process -FilePath $tmp | Out-Null
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-Path (Join-Path $WgDir 'wg.exe')) { break }
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Path (Join-Path $WgDir 'wg.exe'))) { throw 'WireGuard did not finish installing. Install it from wireguard.com and press the register button again.' }
  Start-Sleep -Seconds 3
  Say 'WireGuard: installed (you can close its window)'
}

function Open-Firewall {
  $game = Find-Game
  foreach ($n in 'Rainbow Six (r6rank)', 'Rainbow Six UDP (r6rank)', 'Rainbow Six TCP (r6rank)', 'Rainbow Six PING (r6rank)') {
    & netsh advfirewall firewall delete rule name="$n" 2>$null | Out-Null
  }
  if ($game) {
    # a BLOCK rule from a cancelled "allow this app" popup beats our allow - clear them
    & netsh advfirewall firewall delete rule name=all program="$game" 2>$null | Out-Null
    & netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=in  action=allow program="$game" enable=yes profile=any | Out-Null
    & netsh advfirewall firewall add rule name="Rainbow Six (r6rank)" dir=out action=allow program="$game" enable=yes profile=any | Out-Null
  } else {
    Say 'Firewall: game not found in the usual folders - opening the ports only'
  }
  foreach ($proto in 'TCP', 'UDP') {
    & netsh advfirewall firewall add rule name="Rainbow Six $proto (r6rank)" dir=in  action=allow protocol=$proto localport=2346-2348 enable=yes profile=any | Out-Null
    & netsh advfirewall firewall add rule name="Rainbow Six $proto (r6rank)" dir=out action=allow protocol=$proto localport=2346-2348 enable=yes profile=any | Out-Null
  }
  & netsh advfirewall firewall add rule name="Rainbow Six PING (r6rank)" dir=in action=allow protocol=icmpv4:8,any enable=yes profile=any | Out-Null
  Say 'Firewall: game and ports 2346-2348 (TCP/UDP) allowed'
}

function Do-Register([string]$token) {
  Write-Host ''
  Write-Host '  ==== r6rank.co.kr - host setup ===='
  Write-Host ''
  New-Item -ItemType Directory -Force -Path $Dir -ErrorAction Stop | Out-Null
  Install-WireGuard
  $wg = Join-Path $WgDir 'wg.exe'
  $wgui = Join-Path $WgDir 'wireguard.exe'

  $priv = "$(& $wg genkey)".Trim()
  $pub  = "$($priv | & $wg pubkey)".Trim()
  if ($pub.Length -ne 44) { throw 'Could not make a WireGuard key (wg.exe).' }

  Say 'Site: registering this PC...'
  $payload = @{ action = 'relayRegister'; token = $token; pubkey = $pub } | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Uri "$Site/api/room" -Method Post -Body $payload -ContentType 'application/json' -UseBasicParsing -ErrorAction Stop
  } catch {
    $msg = $_.Exception.Message
    try {
      $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      $j = $sr.ReadToEnd() | ConvertFrom-Json
      if ($j.error) { $msg = $j.error }
    } catch {}
    throw "The site refused the registration: $msg"
  }
  Say ("Site: registered as {0}  (tunnel address {1})" -f $r.handle, $r.ip)

  $text = @(
    '[Interface]'
    "PrivateKey = $priv"
    "Address = $($r.ip)/32"
    ''
    '[Peer]'
    "PublicKey = $($r.serverKey)"
    "Endpoint = $($r.endpoint)"
    'AllowedIPs = 10.66.0.0/24'
    'PersistentKeepalive = 25'
  ) -join "`r`n"
  Set-Content -Path $Conf -Value $text -Encoding ASCII -ErrorAction Stop
  # SIDs, not names: group names are translated on Korean Windows
  & icacls $Conf /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null

  # one tunnel only: drop an older one made by hand in the WireGuard window
  if (Get-Service -Name "WireGuardTunnel`$$Tunnel" -ErrorAction SilentlyContinue) {
    & $wgui /uninstalltunnelservice $Tunnel | Out-Null
    Start-Sleep -Seconds 3
  }
  $old = Join-Path $WgDir "Data\Configurations\$Tunnel.conf.dpapi"
  if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
  & $wgui /installtunnelservice $Conf | Out-Null
  Start-Sleep -Seconds 3
  Say 'Tunnel: installed - it starts with Windows from now on'

  Open-Firewall

  Set-Service -Name iphlpsvc -StartupType Automatic
  Start-Service -Name iphlpsvc -ErrorAction SilentlyContinue

  # copy this script where the task expects it, then (re)install the watcher
  $self = $PSCommandPath
  $dest = Join-Path $Dir 'r6host.ps1'
  if ($self -and ($self -ne $dest)) { Copy-Item $self $dest -Force -ErrorAction Stop }
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest`" -Watch"
  $trg = New-ScheduledTaskTrigger -AtStartup
  $prn = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
  $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Principal $prn -Settings $set -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Say 'Watcher: running - it follows the game address by itself'

  Start-Sleep -Seconds 2
  $ok = Test-Connection -ComputerName 10.66.0.1 -Count 2 -Quiet
  if ($ok) { Say 'Check: relay server answers through the tunnel - OK' }
  else     { Say 'Check: no answer from the relay yet - wait a minute, it may still be connecting' }

  Write-Host ''
  Write-Host '  DONE. The site starts the game by itself in a moment.'
  Write-Host '  (Radmin is not needed for hosting.)'
  Write-Host ''
}

# ---------------------------------------------------------------- main
if ($Watch) { Watch-Loop; exit 0 }
if ($Register) {
  $ok = $false
  try { Do-Register $Register; $ok = $true }
  catch {
    Write-Host ''
    Say ("FAILED: " + $_.Exception.Message)
    Write-Host "  log: $LogFile"
  }
  Write-Host ''
  if ($ok) {
    # nothing to read on success - the site page carries on by itself
    Write-Host '  This window closes in 5 seconds.'
    Start-Sleep -Seconds 5
  } else {
    Read-Host '  Press Enter to close' | Out-Null
  }
  exit 0
}
Write-Host 'Use the [host register] button on r6rank.co.kr - launcher tab.'
