#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
APP_DIR="$(pwd)"

NPM_EXE="${NPM_EXE:-npm}"

# Keep npm's download cache inside the app. The service builds as www-data,
# whose home directory is usually not writable, so npm's default ~/.npm fails.
export npm_config_cache="${npm_config_cache:-$APP_DIR/.npm-cache}"

if [ ! -d "frontend" ]; then
    echo "Frontend folder not found."
    exit 1
fi

cd frontend

# Hash of the lockfile node_modules was last installed from. When it differs
# from the current lockfile (a pull added, removed or upgraded a package), or
# node_modules is missing, reinstall so the build never runs against stale
# dependencies.
STAMP_FILE="node_modules/.installed-lock.sha256"

lock_hash() {
    sha256sum package-lock.json | cut -d' ' -f1
}

install_deps() {
    if [ ! -f "package-lock.json" ]; then
        echo "No package-lock.json; falling back to npm install."
        "$NPM_EXE" install --no-audit --no-fund
        return
    fi

    # npm ci installs exactly what the lockfile says and never rewrites it.
    if ! "$NPM_EXE" ci --no-audit --no-fund; then
        # A corrupted npm cache shows up as ENOTEMPTY/EINTEGRITY errors. Clear
        # it and try once more before giving up.
        echo "npm ci failed; clearing the npm cache and retrying once..."
        "$NPM_EXE" cache clean --force || true
        rm -rf node_modules
        "$NPM_EXE" ci --no-audit --no-fund
    fi

    lock_hash > "$STAMP_FILE"
}

if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies (node_modules missing)..."
    install_deps
elif [ -f "package-lock.json" ] && [ "$(cat "$STAMP_FILE" 2>/dev/null || true)" != "$(lock_hash)" ]; then
    echo "package-lock.json changed since the last install; reinstalling dependencies..."
    install_deps
else
    echo "Frontend dependencies are up to date."
fi

echo "Building frontend..."
"$NPM_EXE" run build

echo "Frontend build complete."
