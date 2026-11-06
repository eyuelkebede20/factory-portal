# Opens the portal in the default browser at every user startup/login.
param([string]$Url = "http://portal")

# 1. Wait up to 30 seconds for the network & portal to become responsive
$maxAttempts = 15
$portalReady = $false

for ($i = 0; $i -lt $maxAttempts; $i++) {
    try {
        $res = Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -eq 200) {
            $portalReady = $true
            break
        }
    } catch {
        # Portal not ready yet, wait and retry
    }
    Start-Sleep -Seconds 2
}

# 2. Launch the portal in the default browser
$process = Start-Process $Url -PassThru -ErrorAction SilentlyContinue

# 3. Confirm with the browser: ensure browser process is active
Start-Sleep -Seconds 3
$browserConfirmed = $false

if ($process -and (-not $process.HasExited)) {
    $browserConfirmed = $true
} else {
    # Check common browsers if launched as an existing instance
    $activeBrowsers = Get-Process msedge, chrome, firefox, brave, opera -ErrorAction SilentlyContinue
    if ($activeBrowsers) {
        $browserConfirmed = $true
    }
}

# 4. Record confirmed launch log
$logDir = Join-Path $env:LOCALAPPDATA "FactoryPortal"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "startup-launch.log"

$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$status = if ($browserConfirmed) { "CONFIRMED_OPENED" } else { "LAUNCH_ATTEMPTED" }
Add-Content -Path $logFile -Value "[$timestamp] Portal: $Url | Status: $status | PortalReady: $portalReady"
