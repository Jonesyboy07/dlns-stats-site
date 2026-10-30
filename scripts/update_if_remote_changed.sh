
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/dlns-stats-site"
SERVICE_NAME="dlns-stats"
BRANCH="main"
LOG_FILE="/var/log/dlns-stats-update.log"
BRACKETS_FILE="data/brackets.json"

BACKUP_FILE=""
SERVICE_STOPPED="false"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$APP_DIR"

# Restore live brackets even if the script fails.
cleanup() {
    exit_code=$?

    trap - EXIT

    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        if cp -p "$BACKUP_FILE" "$APP_DIR/$BRACKETS_FILE"; then
            rm -f "$BACKUP_FILE"
            BACKUP_FILE=""
            log "Live brackets.json preserved/restored."
        else
            log "ERROR: Could not restore brackets.json."
            log "Emergency backup remains at: $BACKUP_FILE"
            exit_code=1
        fi
    fi

    if [ "$SERVICE_STOPPED" = "true" ]; then
        log "Ensuring app service is running..."
        systemctl restart "$SERVICE_NAME" || {
            log "ERROR: Failed to restart service."
            exit_code=1
        }
    fi

    exit "$exit_code"
}

trap cleanup EXIT

log "Checking for remote changes..."

git config --global --add safe.directory "$APP_DIR" \
    >/dev/null 2>&1 || true

LOCAL_COMMIT="$(git rev-parse HEAD)"

git fetch origin "$BRANCH" --quiet

REMOTE_COMMIT="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    log "No remote changes."
    log "Refetching all cached users (no code update path)..."

    python3 "$APP_DIR/backend/main.py" \
        -db "$APP_DIR/data/dlns.sqlite3" \
        -cache "$APP_DIR/data/user_cache.json" \
        -userfetch "true"

    exit 0
fi

log "Remote changes found."
log "Local:  $LOCAL_COMMIT"
log "Remote: $REMOTE_COMMIT"

# Refuse to update if files OTHER than brackets.json
# have local tracked modifications.
if ! git diff --quiet -- . ":(exclude)$BRACKETS_FILE" ||
   ! git diff --cached --quiet -- . ":(exclude)$BRACKETS_FILE"; then

    log "ERROR: Other local tracked changes exist. Refusing to pull."

    git status --short | tee -a "$LOG_FILE"

    exit 1
fi

# Preserve fast-forward-only safety.
# If branches have diverged, don't attempt an unsafe pull.
if ! git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
    log "ERROR: Local branch cannot fast-forward to origin/$BRANCH."
    log "Push or reconcile local commits before automatic updates."
    exit 1
fi

MATCHES_CHANGED="false"

if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" |
   grep -qx "$BRACKETS_FILE"; then

    MATCHES_CHANGED="true"
    log "Detected change in data/brackets.json."
else
    log "No change detected in data/brackets.json."
fi

# Preserve local brackets.json only when it has modifications.
# This allows clean copies to receive remote changes normally.
if ! git diff --quiet HEAD -- "$BRACKETS_FILE"; then

    log "Local brackets.json changes detected."
    log "Creating temporary safety backup..."

    BACKUP_FILE="$(mktemp /var/tmp/dlns-brackets.XXXXXXXX)"

    cp -p "$APP_DIR/$BRACKETS_FILE" "$BACKUP_FILE"

    log "Backup created successfully."

    # Temporarily restore Git's tracked version.
    git restore --source=HEAD --staged --worktree -- "$BRACKETS_FILE"

    log "Temporarily reset brackets.json for safe pull."
fi

log "Stopping app service before update..."

systemctl stop "$SERVICE_NAME"
SERVICE_STOPPED="true"

log "Pulling latest code..."

git pull --ff-only origin "$BRANCH"

log "Pull successful."

# Restore live brackets.json before DB processing.
if [ -n "$BACKUP_FILE" ]; then
    log "Restoring live brackets.json..."

    cp -p "$BACKUP_FILE" "$APP_DIR/$BRACKETS_FILE"

    rm -f "$BACKUP_FILE"
    BACKUP_FILE=""

    log "Live brackets.json restored successfully."
fi

log "Installing backend requirements..."

python3 -m pip install \
    --break-system-packages \
    --ignore-installed \
    -r "$APP_DIR/backend/requirements.txt"

if [ "$MATCHES_CHANGED" = "true" ]; then

    log "Running DB update because data/brackets.json changed..."

    chmod +x "$APP_DIR/scripts/update_db_from_matches.sh"

    "$APP_DIR/scripts/update_db_from_matches.sh"

else

    log "Skipping DB update because data/brackets.json did not change."
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
SERVICE_STOPPED="false"

log "Update complete."
