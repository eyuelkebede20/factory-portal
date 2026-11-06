@echo off
setlocal EnableDelayedExpansion
title Workstation Startup Installer - Homicho Ammunition Engineering Industry

echo =====================================================================
echo    Homicho Ammunition Engineering Industry - Workstation Startup Setup
echo =====================================================================
echo.

:: 1. Determine Target Portal URL
:: Default URL: http://localhost:3010 (port 3010 matching docker-compose.yml)
set "DEFAULT_URL=http://localhost:3010"

if not "%~1"=="" (
    set "PORTAL_URL=%~1"
    goto :Configured
)

if not "%PORTAL_URL%"=="" goto :Configured

echo Default Target URL: %DEFAULT_URL%
echo.
echo Press ENTER to use the default URL, or type the server address:
echo (e.g. http://192.168.20.10:3010 or http://portal:3010)
set "INPUT_URL="
set /p "INPUT_URL=Portal URL [%DEFAULT_URL%]: "

if "%INPUT_URL%"=="" (
    set "PORTAL_URL=%DEFAULT_URL%"
) else (
    set "PORTAL_URL=%INPUT_URL%"
)

:Configured
:: Remove trailing slash if present
if "%PORTAL_URL:~-1%"=="/" set "PORTAL_URL=%PORTAL_URL:~0,-1%"

echo.
echo Target Portal URL configured: %PORTAL_URL%
echo.

:: 2. Target installation directory
set "INSTALL_DIR=C:\ProgramData\FactoryPortal"
mkdir "%INSTALL_DIR%" 2>nul
if errorlevel 1 (
    set "INSTALL_DIR=%LOCALAPPDATA%\FactoryPortal"
    mkdir "%INSTALL_DIR%" 2>nul
)

echo Installing startup files to: %INSTALL_DIR%

:: 3. Copy open-portal.ps1 or generate it if missing
if exist "%~dp0open-portal.ps1" (
    copy /y "%~dp0open-portal.ps1" "%INSTALL_DIR%\open-portal.ps1" >nul
) else (
    (
    echo # Opens the portal in the default browser at every user startup/login with startup confirmation.
    echo param([string]$Url = "%PORTAL_URL%"^)
    echo.
    echo # 1. Wait up to 30 seconds for the network ^& portal to become responsive
    echo $maxAttempts = 15
    echo $portalReady = $false
    echo for ($i = 0; $i -lt $maxAttempts; $i++^) {
    echo     try {
    echo         $res = Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    echo         if ($res.StatusCode -eq 200^) { $portalReady = $true; break }
    echo     } catch {}
    echo     Start-Sleep -Seconds 2
    echo }
    echo.
    echo # 2. Append ?startup=1 and workstation identity parameters
    echo $hostParam = [System.Uri]::EscapeDataString($env:COMPUTERNAME^)
    echo $userParam = [System.Uri]::EscapeDataString($env:USERNAME^)
    echo $sep = if ($Url -match "\\?"^) { "^&" } else { "?" }
    echo $targetUrl = "\${Url}\${sep}startup=1^&host=\${hostParam}^&user=\${userParam}"
    echo.
    echo # 3. Launch the portal in the default browser
    echo $process = Start-Process $targetUrl -PassThru -ErrorAction SilentlyContinue
    echo.
    echo # 4. Confirm with the browser: ensure browser process is active
    echo Start-Sleep -Seconds 3
    echo $browserConfirmed = $false
    echo if ($process -and (-not $process.HasExited^)^) {
    echo     $browserConfirmed = $true
    echo } else {
    echo     $activeBrowsers = Get-Process msedge, chrome, firefox, brave, opera -ErrorAction SilentlyContinue
    echo     if ($activeBrowsers^) { $browserConfirmed = $true }
    echo }
    echo.
    echo # 5. Record confirmed launch log
    echo $logDir = Join-Path $env:LOCALAPPDATA "FactoryPortal"
    echo if (-not (Test-Path $logDir^)^) { New-Item -ItemType Directory -Path $logDir -Force ^| Out-Null }
    echo $logFile = Join-Path $logDir "startup-launch.log"
    echo $timestamp = (Get-Date^).ToString("yyyy-MM-dd HH:mm:ss"^)
    echo $status = if ($browserConfirmed^) { "CONFIRMED_OPENED" } else { "LAUNCH_ATTEMPTED" }
    echo Add-Content -Path $logFile -Value "[\$timestamp] Portal: \$targetUrl ^| Status: \$status ^| PortalReady: \$portalReady"
    ) > "%INSTALL_DIR%\open-portal.ps1"
)

:: 4. Write companion open-portal.bat runner
(
echo @echo off
echo set "TARGET_URL=%PORTAL_URL%?startup=1&host=%%COMPUTERNAME%%&user=%%USERNAME%%"
echo start "" "%%TARGET_URL%%"
) > "%INSTALL_DIR%\open-portal.bat"

:: 5. Create Windows Startup Shortcut
set "ALL_USERS_STARTUP=C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
set "SHORTCUT_CREATED=0"

powershell.exe -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; $lnk = $sh.CreateShortcut('%ALL_USERS_STARTUP%\Factory Portal.lnk'); $lnk.TargetPath = 'powershell.exe'; $lnk.Arguments = '-WindowStyle Hidden -ExecutionPolicy Bypass -File """%INSTALL_DIR%\open-portal.ps1""" -Url """%PORTAL_URL%"""'; $lnk.WindowStyle = 7; $lnk.Save()" 2>nul

if not errorlevel 1 (
    if exist "%ALL_USERS_STARTUP%\Factory Portal.lnk" (
        set "SHORTCUT_CREATED=1"
        echo [OK] Created startup shortcut for All Users at:
        echo      %ALL_USERS_STARTUP%\Factory Portal.lnk
    )
)

if "%SHORTCUT_CREATED%"=="0" (
    powershell.exe -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; $userStartup = [Environment]::GetFolderPath('Startup'); $lnk = $sh.CreateShortcut(\"$userStartup\Factory Portal.lnk\"); $lnk.TargetPath = 'powershell.exe'; $lnk.Arguments = '-WindowStyle Hidden -ExecutionPolicy Bypass -File """%INSTALL_DIR%\open-portal.ps1""" -Url """%PORTAL_URL%"""'; $lnk.WindowStyle = 7; $lnk.Save()" 2>nul
    echo [OK] Created startup shortcut for Current User (%USERNAME%).
)

echo.
echo =====================================================================
echo    SUCCESS! Workstation setup complete.
echo    Factory Portal will automatically open on every login/startup.
echo =====================================================================
echo.
echo Opening default browser pointed to portal now...
start "" "%PORTAL_URL%?startup=1&host=%COMPUTERNAME%&user=%USERNAME%"
echo.
echo Browser opened. You can now close this window.
timeout /t 5 >nul
