#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/dlns-stats-site"
SERVICE_NAME="dlns-stats"
BRANCH="main"
LOG_FILE="/var/log/dlns-stats-update.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$APP_DIR"

log "Checking for remote changes..."

git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true

LOCAL_COMMIT="$(git rev-parse HEAD)"

git fetch origin "$BRANCH" --quiet

REMOTE_COMMIT="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "No remote changes."
  exit 0
fi

log "Remote changes found."
log "Local:  $LOCAL_COMMIT"
log "Remote: $REMOTE_COMMIT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "ERROR: Local tracked file changes exist. Refusing to pull."
  git status --short | tee -a "$LOG_FILE"
  exit 1
fi

MATCHES_CHANGED="false"

if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -qx "data/matches.json"; then
  MATCHES_CHANGED="true"
  log "Detected change in data/matches.json."
else
  log "No change detected in data/matches.json."
fi

BACKUP_DIR="/opt/dlns-runtime-backups/$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$BACKUP_DIR"

log "Backing up runtime files to $BACKUP_DIR..."

for item in ".env" "data" "filehub" "instance" "public" "static/sounds"; do
  if [ -e "$APP_DIR/$item" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$item")"
    cp -a "$APP_DIR/$item" "$BACKUP_DIR/$item"
  fi
done

log "Stopping app service before update..."
systemctl stop "$SERVICE_NAME" || true

log "Pulling latest code..."
git pull --ff-only origin "$BRANCH"

log "Installing backend requirements..."
python3 -m pip install \
  --break-system-packages \
  --ignore-installed \
  -r "$APP_DIR/backend/requirements.txt"

if [ "$MATCHES_CHANGED" = "true" ]; then
  log "Running DB update because data/matches.json changed..."
  chmod +x "$APP_DIR/scripts/update_db_from_matches.sh"
  "$APP_DIR/scripts/update_db_from_matches.sh"
else
  log "Skipping DB update because data/matches.json did not change."
  log "Refetching all cached users..."
  python3 "$APP_DIR/backend/main.py" \
    -db "$APP_DIR/data/dlns.sqlite3" \
    -cache "$APP_DIR/data/user_cache.json" \
    -userfetch "true"
fi

log "Fixing ownership..."
chown -R www-data:www-data "$APP_DIR"
chmod +x "$APP_DIR/scripts/"*.sh
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

log "Restarting service. This will run start_forced.sh..."
systemctl restart "$SERVICE_NAME"

log "Update complete."
