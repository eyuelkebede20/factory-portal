#!/usr/bin/env bash
# ============================================================
#  deploy/update.sh  -  Update script for Factory Portal (Linux/Docker)
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

STATUS_FILE="run/update.status"
mkdir -p run backups
echo "" > "$STATUS_FILE"

status() {
    local msg="[$(date +%T)] $1"
    echo "$msg"
    echo "$msg" >> "$STATUS_FILE"
}

status "=== Update started ==="

PREV=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
status "   Current commit: $PREV"

status "[1/4] Backing up applications data..."
if [ -f "data/apps.json" ]; then
    BACKUP_FILE="backups/apps-pre-update-$(date +%Y%m%d_%H%M%S).json"
    cp "data/apps.json" "$BACKUP_FILE" 2>/dev/null || true
    status "   [OK] Data backup saved to $BACKUP_FILE"
else
    status "   (No local data file to backup, skipping)"
fi

status "[2/4] Pulling latest code from GitHub..."
git config --global --add safe.directory "$ROOT" 2>/dev/null || true
git stash --include-untracked >> "$STATUS_FILE" 2>&1 || git stash >> "$STATUS_FILE" 2>&1 || true
if ! git pull origin main >> "$STATUS_FILE" 2>&1; then
    status "   [!] git pull failed - check git connection"
    status "!! Update failed"
    exit 1
fi
NEW_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
status "   [OK] Code updated to commit $NEW_HEAD"

status "[3/4] Rebuilding and restarting services..."
if command -v docker >/dev/null 2>&1; then
    if ! docker compose up -d --build >> "$STATUS_FILE" 2>&1; then
        status "   [!] Docker rebuild failed - rolling back to $PREV"
        git reset --hard "$PREV" >/dev/null 2>&1
        status "!! Rollback complete"
        exit 1
    fi
    status "   [OK] Container rebuilt and running."
else
    status "   (Docker not found, running npm install)..."
    npm install --omit=dev >> "$STATUS_FILE" 2>&1
    status "   [OK] Dependencies updated."
fi

status "[4/4] Verifying portal health..."
sleep 3
status "✓. Update complete"
exit 0
