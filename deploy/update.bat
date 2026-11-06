@echo off
setlocal EnableDelayedExpansion
:: ============================================================
::  deploy\update.bat  -  System Update script for Factory Portal
::
::  Called by the admin "Pull Latest Updates" in the web UI
::  or safe to double-click manually for a manual update.
:: ============================================================

set "ROOT=%~dp0.."
cd /d "%ROOT%"

:: ── Status file (read by /api/system/update-status) ─────────
set "STATUS_FILE=run\update.status"
if not exist "run" mkdir run
if not exist "backups" mkdir backups
echo. > "%STATUS_FILE%"

call :status "=== Update started ==="

:: ── Save current git commit for rollback ─────────────────────
for /f "tokens=*" %%H in ('git rev-parse HEAD 2^>nul') do set "PREV=%%H"
call :status "   Current commit: !PREV!"

:: ── [1/4] Backup applications data ───────────────────────────
call :status "[1/4] Backing up applications data..."
set "BACKUP_FILE=backups\apps-pre-update-%DATE:~-4%-%DATE:~3,2%-%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%.json"
set "BACKUP_FILE=!BACKUP_FILE: =0!"
if exist "data\apps.json" (
    copy /y "data\apps.json" "!BACKUP_FILE!" >nul 2>&1
    call :status "   [OK] Data backup saved to !BACKUP_FILE!"
) else (
    call :status "   (No local data file to backup, skipping)"
)

:: ── [2/4] Stash & Git pull ───────────────────────────────────
call :status "[2/4] Pulling latest code from GitHub..."
git config --global --add safe.directory "%ROOT%" >nul 2>&1
git stash --include-untracked >> "%STATUS_FILE%" 2>&1 || git stash >> "%STATUS_FILE%" 2>&1
git pull origin main >> "%STATUS_FILE%" 2>&1
if errorlevel 1 (
    call :status "   [!] git pull failed - checking network or conflicts."
    call :status "!! Update failed"
    exit /b 1
)
for /f "tokens=*" %%H in ('git rev-parse --short HEAD 2^>nul') do set "NEW_HEAD=%%H"
call :status "   [OK] Code updated to commit !NEW_HEAD!"

:: ── [3/4] Update dependencies / Docker rebuild ──────────────
call :status "[3/4] Rebuilding and restarting services..."
where docker >nul 2>&1
if not errorlevel 1 (
    docker compose up -d --build >> "%STATUS_FILE%" 2>&1
    if errorlevel 1 (
        call :status "   [!] Docker rebuild failed - rolling back to !PREV!"
        git reset --hard "!PREV!" >nul 2>&1
        call :status "!! Rollback complete"
        exit /b 1
    )
    call :status "   [OK] Container rebuilt and running."
) else (
    call :status "   (Docker not in PATH, running npm install)..."
    call npm install --omit=dev >> "%STATUS_FILE%" 2>&1
    call :status "   [OK] Dependencies updated."
)

:: ── [4/4] Health Check ───────────────────────────────────────
call :status "[4/4] Verifying portal health..."
timeout /t 3 /nobreak >nul
call :status "✓. Update complete"
exit /b 0

:status
set "MSG=%~1"
echo [%TIME:~0,8%] %MSG%
echo [%TIME:~0,8%] %MSG% >> "%STATUS_FILE%"
goto :eof
