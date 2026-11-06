# Run ONCE per PC as Administrator (or deploy through GPO / Intune as a computer startup script).
# Usage: powershell -ExecutionPolicy Bypass -File install-startup.ps1 -Url http://portal
param([string]$Url = "http://portal")
$dir = "C:\ProgramData\FactoryPortal"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item "$PSScriptRoot\open-portal.ps1" "$dir\open-portal.ps1" -Force

$startup = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"   # runs for every user at login
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut("$startup\Homicho Ammunition Engineering Industry Portal.lnk")
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\open-portal.ps1`" -Url $Url"
$lnk.WindowStyle = 7
$lnk.Save()
Write-Host "Installed. The portal ($Url) will always open at startup and confirm browser launch."
