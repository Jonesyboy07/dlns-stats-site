# Configuration and operations

## Environment setup

The Flask app loads `.env` at startup. Start from the root template:

```bash
cp .env.example .env
```

Review the comments in `.env.example` and replace placeholders for the features you use. Do not commit `.env` or real credentials. For a local site, set a local `BASE_URL` and a private `SECRET_KEY`; a Steam API key is needed for ingestion, while Discord, Twitch, and replay settings are only needed for their respective integrations.

### Settings by feature

| Feature | Environment settings |
| --- | --- |
| Application | `SECRET_KEY`, `BASE_URL`, `OG_IMAGE` |
| Database and match API | `DB_PATH`, `API_LATEST_LIMIT`, `STEAM_API_KEY` |
| Cache and response compression | `CACHE_TYPE`, `CACHE_DEFAULT_TIMEOUT`, `CACHE_DIR`, `CACHE_THRESHOLD`, `CACHE_WARMUP_ON_STARTUP`, `CACHE_WARMUP_DELAY_SECONDS`, `COMPRESS_LEVEL`, `COMPRESS_BR_LEVEL`, `COMPRESS_MIN_SIZE` |
| Replay storage and indexing | `REPLAY_SHARE_API_URL`, `REPLAY_DOWNLOAD_BASE_URL`, `REPLAY_URL_CACHE_TTL_SECONDS`, `REPLAY_URL_FILE_CACHE_PATH`, `REPLAY_INDEX_FILE_CACHE_PATH`, `REPLAY_INDEX_REFRESH_HOURS` |
| Discord authentication and permissions | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_OWNER_ID`, `DISCORD_ADMIN_IDS`, `DISCORD_CO_OWNER_ID`, `MATCH_SUBMITTER` |
| Twitch stream status | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNEL`, `TWITCH_URL` |
| Image/asset hosting | `IMAGE_CDN_BASE`, `VITE_IMAGE_CDN_BASE`, `TEAM_LOGO_CDN_BASE`, `VITE_TEAM_LOGO_BASE` |
| External links and CORS | `YOUTUBE_URL`, `TWITCH_URL`, `DEADLOCK_URL`, `KOFI_URL`, `PATREON_URL`, `FRONTEND_URL` |
| DLNS exporter | `HERO_CLIENT_VERSION`, `ITEM_CLIENT_VERSION`, `ITEM_REQUEST_TIMEOUT_S`, `EXPO_JOB_RETENTION_SECONDS`, `EXPO_JOB_MAX_LOG_LINES`, `STEAM_API_KEY` |

`.env.example` documents placeholders and related setup details, but it also contains some legacy or deployment-specific entries that are not read by the current application. Only rely on a setting if it is documented as active above or confirmed in the relevant source code. New settings should be added to the example template when their implementation is added.

## Local and production servers

- `python run.py` starts the standard Flask app on `127.0.0.1:5050`.
- `python run_debug.py` starts the debug app on the same address and port; use only for local development.
- `wsgi.py` exports the standard app as `wsgi:app` for WSGI servers.
- `scripts/start_web.sh` and `scripts/start_web.bat` build the frontend and start Waitress on `127.0.0.1:5050`.
- `scripts/start_forced.sh` and `scripts/start_forced.bat` start Waitress with a frontend watcher and attempt a replay-index refresh first.

For public deployment, use a production WSGI server behind a reverse proxy, set `BASE_URL` to the public origin, set secure cookies when served over HTTPS, and use a strong private `SECRET_KEY`. Configure the proxy, TLS, process supervision, logging, and backups for your deployment environment. The start scripts bind to loopback, not a public network interface.

## Cache and replay behavior

Flask caching defaults to a filesystem cache under `_cache/flask_cache`; settings can be overridden with `CACHE_*`. Startup cache warmup is enabled by default and can be disabled with `CACHE_WARMUP_ON_STARTUP=false`.

Replay lookup requires both replay storage settings in `.env.example`. Lookup results persist in `_cache/replay_urls.json` (including negative results) and expire after `REPLAY_URL_CACHE_TTL_SECONDS` (48 hours by default). The replay index is stored separately, refreshed in the background at the configured interval (6 hours by default), or rebuilt manually:

```bash
python scripts/build_replay_index.py
```

See [data ingestion and maintenance](INGESTION.md) for the update scripts and database tasks.
