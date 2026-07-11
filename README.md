# DLNS Stats Site

DLNS Stats Site is a Flask-based web app for Deadlock Night Shift match tracking, player analysis, and community tooling.

It includes:
- Match ingestion and enrichment pipelines
- Public web pages for matches, users, and stats
- Internal and public JSON APIs
- React-powered sections for match, player, hero, and stats workflows

## What This Project Does

- Tracks and serves DLNS match and player data from SQLite
- Resolves hero names and caches external lookups
- Provides pages for:
  - Latest matches
  - Match details
  - User profiles and match history
  - Aggregated statistics
- Exposes API docs through OpenAPI at /api/docs
- Hosts additional tools:
  - /dlns

## Tech Stack

- Backend: Python + Flask
- Database: SQLite (default: data/dlns.sqlite3)
- Frontend: Server-rendered templates + React bundles in static/react-app
- Caching/Compression: Flask-Caching + Flask-Compress

## Quick Start

### 1) Install dependencies

```bash
pip install -r requirements.txt
```

Optional (for rebuilding React bundles):

```bash
cd frontend
npm install
```

### 2) Configure environment

Create a .env file (or set env vars in your host) and configure at minimum:

```bash
SECRET_KEY=change-me
BASE_URL=http://localhost:5050
DB_PATH=./data/dlns.sqlite3
STEAM_API_KEY=your_steam_api_key
IMAGE_CDN_BASE=https://cdn.dlns-stats.co.uk/public/images
VITE_IMAGE_CDN_BASE=https://cdn.dlns-stats.co.uk/public/images
```

Useful optional vars:

```bash
API_LATEST_LIMIT=20
CACHE_TYPE=SimpleCache
CACHE_DEFAULT_TIMEOUT=60
COMPRESS_LEVEL=6
COMPRESS_BR_LEVEL=5
FRONTEND_URL=
IMAGE_CDN_BASE=
VITE_IMAGE_CDN_BASE=
YOUTUBE_URL=
TWITCH_URL=
KOFI_URL=
PATREON_URL=
```

### 3) Ingest data

```bash
python main.py -matchfile matches.json
```

By default, the ingester only processes IDs not already marked as checked in `data/matches_status.json`.
To re-run every ID from the JSON file, use:

```bash
python main.py -matchfile matches.json -recheckall true
```

The match ingester uses async workers with `asqlite` for DB writes.
You can tune worker count (default `4`) with:

```bash
python main.py -matchfile matches.json -concurrency 6
```

The match input file is JSON and supports event grouping by week:

```json
{
  "title": "Night Shift",
  "weeks": [
    { "week": 31, "match_ids": [70457488, 70471960] }
  ]
}
```

### 4) Run the web app

```bash
python main_web.py
```

Default local URL:

http://localhost:5050

## Frontend Build (React)

The React app in frontend outputs built files into public/react-app.

```bash
cd frontend
npm run build
```

Use this after changing files in frontend/src.

## Project Layout

```text
main.py                 Data ingestion/processing
main_web.py             Flask app factory and route wiring
blueprints/             Feature blueprints (db, auth, stats, interviews, etc.)
templates/              Server-rendered HTML templates
static/                 Static files and built React bundles
public/                 Public static files and built React bundles
frontend/               React source and Vite config
data/                   SQLite database and runtime data files
docs/                   Project docs (schema notes, etc.)
```

## Main Routes

- / - latest matches
- /search
- /matches/<id>
- /users/<account_id>
- /stats/
- /api/docs
- /api/openapi.json
- /sitemap.xml
- /robots.txt

## API Notes

Core database APIs are under /db.

Examples:
- GET /db/matches/latest
- GET /db/matches/latest/paged
- GET /db/matches/<id>/players
- GET /db/users/<account_id>
- GET /db/users/<account_id>/stats

## SEO Endpoints

- /sitemap.xml is generated dynamically from current site and database content.
- /robots.txt is generated dynamically and points crawlers to the sitemap.
- Ensure BASE_URL is set correctly in production so canonical sitemap links are correct.

## Deployment Notes

- Run behind a reverse proxy in production
- Set BASE_URL to public origin (for sitemap + metadata)
- Keep SECRET_KEY private
- Move to managed DB/caching layers if traffic grows

## License

MIT. See LICENSE.