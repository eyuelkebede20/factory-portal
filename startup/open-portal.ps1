# Opens the portal in the default browser, at most once per day per user.
param([string]$Url = "http://portal")
$stamp = Join-Path $env:LOCALAPPDATA "factory-portal-last-open.txt"
$today = (Get-Date).ToString("yyyy-MM-dd")
if ((Test-Path $stamp) -and ((Get-Content $stamp -ErrorAction SilentlyContinue) -eq $today)) { exit 0 }
Start-Sleep -Seconds 10   # let the network come up after login
Set-Content -Path $stamp -Value $today
Start-Process $Url
