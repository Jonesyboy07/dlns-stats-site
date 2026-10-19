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
| Application | `SECRET_KEY`, `BASE_URL`, `OG_IMAGE`, `SEO_PRERENDER` |
| Search indexing | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `INDEXNOW_KEY`, `INDEXNOW_ENDPOINT` |
| Database and match API | `DB_PATH`, `API_LATEST_LIMIT`, `STEAM_API_KEY` |
| Cache and response compression | `CACHE_TYPE`, `CACHE_DEFAULT_TIMEOUT`, `CACHE_DIR`, `CACHE_THRESHOLD`, `CACHE_WARMUP_ON_STARTUP`, `CACHE_WARMUP_DELAY_SECONDS`, `COMPRESS_LEVEL`, `COMPRESS_BR_LEVEL`, `COMPRESS_MIN_SIZE` |
| Replay storage and indexing | `REPLAY_SHARE_API_URL`, `REPLAY_DOWNLOAD_BASE_URL`, `REPLAY_URL_CACHE_TTL_SECONDS`, `REPLAY_URL_FILE_CACHE_PATH`, `REPLAY_INDEX_FILE_CACHE_PATH`, `REPLAY_INDEX_REFRESH_HOURS`, `REPLAY_SCAN_MAX_DIRS`, `REPLAY_SCAN_DEADLINE_SECONDS`, `REPLAY_LISTING_TIMEOUT_SECONDS`, `REPLAY_SCAN_PARTIAL_TTL_SECONDS` |
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

## Search metadata

Every React page is served by `templates/react.html`, whose title, description, canonical link and Open Graph/Twitter tags are filled in by `backend/app/seo.py`. Because the tags are rendered by Flask before any JavaScript runs, crawlers and link-preview bots see the same values as a visitor.

- `BASE_URL` must be the public origin; it is the prefix for canonical URLs, `og:url`, `sitemap.xml` and `robots.txt`.
- Canonical URLs prefer `/matches/<id>` (not `/match/<id>`) and `/player/<accountId>` (not `/users/<accountId>`). `/home` canonicalises to `/`, interview aliases to `/interviews/<short_id>`, and `/stats` to `/stats/` (the trailing slash is required because the slash-less form redirects).
- `/search`, `/admin/*`, `/react-admin*` and `/interviews/upload` are `noindex`.
- Detail routes for entities that do not exist (match, series, player, player×hero, hero, team or week) render the app shell with a “not found” title, `noindex, follow`, and a real **404** status. Existing profiles with no games yet stay indexable.
- `/sitemap.xml` lists the same canonical URLs. It is cached for 15 minutes; append `?flush=1` after a data refresh to rebuild it immediately.
- Sitemap quality rules: placeholder/negative match IDs and matches without a duration are excluded; player profiles with no recorded games are excluded; heroes with zero appearances are excluded; teams and weeks use the newest spelling/date from real matches. `lastmod` comes from the newest matching data rather than the build date. Row caps (15k matches + 15k players + 63 heroes + 500 teams + 300 weeks) keep the file under the 50,000-URL limit, so no sitemap index is needed. `test_every_sitemap_url_returns_200` in `backend/tests/test_seo.py` guards this.
- Match and player pages also emit JSON-LD (`SportsEvent` / `ProfilePage`); interview detail pages emit `Article`. Every indexable page adds a `BreadcrumbList`, combined with the page schema through `@graph`.
- The prerendered snapshot includes a visible, crawlable breadcrumb trail (`nav[aria-label="Breadcrumb"]`) before the React-managed content. Client-side navigation rebuilds the trail and JSON-LD from the route, then page components replace it with data-backed names once loaded.
- `backend/app/prerender.py` renders a compact content snapshot into `#root` for the home/match list, match, player, player×hero, hero, team, week and index pages. It contains real headings, player/team names, tables and internal links, so crawlers and no-JS visitors see content before the React bundle runs; React replaces it on mount. Snapshots are cached for five minutes and capped in memory. Set `SEO_PRERENDER=0` to disable it.

When adding a page to the React app, add its route metadata to `STATIC_ROUTES` in `frontend/src/utils/seo.js` (client-side navigation) and to `_STATIC_PAGES` in `backend/app/seo.py` (server-rendered shell). Add a `_build` branch in `backend/app/prerender.py` if the page needs crawlable content. Add its canonical URL to `backend/app/blueprints/sitemap.py` only when it is a public landing page worth indexing.

## Search Console, Bing and IndexNow

Ownership verification tags are rendered from environment variables, so no template edits are needed:

- `GOOGLE_SITE_VERIFICATION` → `<meta name="google-site-verification" content="…">`
- `BING_SITE_VERIFICATION` → `<meta name="msvalidate.01" content="…">`

The tags appear on both the React shell and the legacy Jinja pages.

IndexNow is optional and inert until a key is set:

- `INDEXNOW_KEY` must be 8-128 letters, digits or dashes. The site serves the key at `/<key>.txt`.
- `INDEXNOW_ENDPOINT` defaults to `https://api.indexnow.org/indexnow`.
- Submit URLs after ingest or publishing an interview:

  ```bash
  python scripts/indexnow_ping.py --recent 50
  python scripts/indexnow_ping.py /matches/123 /interviews/42
  ```

  The script exits non-zero when IndexNow rejects the submission.

Operational checklist after deploying these SEO changes:

1. Set `BASE_URL` to the public HTTPS origin; canonical URLs, Open Graph URLs, the sitemap and IndexNow all depend on it.
2. Add the Google/Bing verification tokens, deploy, and finish verification in each console.
3. Submit `https://<host>/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
4. Set `INDEXNOW_KEY`, deploy, then confirm `https://<host>/<key>.txt` returns the key.
5. Run the ping script after each match ingest; use `?flush=1` on the sitemap if you need it rebuilt immediately.
6. Watch Search Console → Indexing → Pages for “Soft 404” and “Crawled – currently not indexed”. Missing detail pages now return real 404s, so those reports should describe genuinely absent content.
7. Use URL Inspection on a match, player, hero and team page to confirm the rendered HTML title/description/canonical match the values in `view-source`.

## Performance

- The decorative gothic backdrop is ~3.6 MB. It is now requested only after the first paint (`requestIdleCallback`, with a timeout fallback), so it no longer competes with LCP text/fonts. Compressing that source image to WebP/AVIF is still worthwhile; the current file is the largest asset on the site.
- Match detail's timeline and laning tabs are lazy-loaded with `React.lazy`/`Suspense`. The initial `MatchDetail` chunk dropped from ~139 kB (37 kB gzip) to ~91 kB (24 kB gzip); the tabs load only when opened.
- `react.html` preconnects to `IMAGE_CDN_BASE` and preloads the two fonts used above the fold (`valveoracle-medium.ttf`, `valvepulp-bold.ttf`).
- Hero icons, avatars, crests and hero art use `loading="lazy" decoding="async"` by default. Above-the-fold identity images pass `priority`, which switches them to eager loading.
- `font-display: swap` is already set for every `@font-face`.

## Database backups

`data/dlns.sqlite3` is ignored by git and holds every match, week and player row, so a copy of it is the only way back from a bad write or an accidental ingest.

- `python scripts/backup_db.py` writes a verified snapshot to `_cache/dlns.auto_<utc stamp>.sqlite3` (`scripts/backup_db.bat` is the same thing for Windows callers). Options: `--db` (default `DB_PATH` or `./data/dlns.sqlite3`), `--dir` (default `_cache` beside the data directory), `--keep` (default 7 copies), `--quiet`.
- The snapshot is taken with SQLite's backup API, so it is consistent while the site is serving and the site does not need stopping.
- Each copy is checked (`PRAGMA quick_check` plus a `matches` row count against the source) before it replaces the temporary file; if the check fails, the temporary file is deleted and the command exits non-zero, so a failed run cannot leave behind something that looks like a backup.
- Only files matching `dlns.auto_*.sqlite3` are pruned, so hand-made copies such as `dlns.backup_before_<label>.sqlite3` are never deleted.
- To make it automatic on Windows, schedule the batch file daily (Task Scheduler → run `scripts\backup_db.bat`, or `schtasks /create /tn "DLNS DB backup" /tr "<repo>\scripts\backup_db.bat --keep 7" /sc daily /st 05:30`). On Linux use the same script from cron.

`data/brackets.json` has its own protection: every admin save keeps the file it replaced as `brackets.json.bak-<utc stamp>` (the last 10 are kept).

## Cache and replay behavior

Flask caching defaults to a filesystem cache under `_cache/flask_cache`; settings can be overridden with `CACHE_*`. Startup cache warmup is enabled by default and can be disabled with `CACHE_WARMUP_ON_STARTUP=false`.

Replay lookup requires both replay storage settings in `.env.example`. Lookup results persist in `_cache/replay_urls.json` (including negative results) and expire after `REPLAY_URL_CACHE_TTL_SECONDS` (48 hours by default). The replay index is stored separately, refreshed in the background at the configured interval (6 hours by default), or rebuilt manually:

```bash
python scripts/build_replay_index.py
```

When a match is missing from the index, the request falls back to a **bounded** live scan: at most `REPLAY_SCAN_MAX_DIRS` directories (100), a total wall-clock budget of `REPLAY_SCAN_DEADLINE_SECONDS` (5), and `REPLAY_LISTING_TIMEOUT_SECONDS` (3) per directory listing. A capped or timed-out scan caches its negative result for `REPLAY_SCAN_PARTIAL_TTL_SECONDS` (300) instead of the full 48 hours, so newly uploaded replays become discoverable quickly. Clicking the replay button forces one fresh lookup (`?retry=1`) instead of rescanning on every page view. The full index crawl remains the background path for exhaustive coverage.

See [data ingestion and maintenance](INGESTION.md) for the update scripts and database tasks.
