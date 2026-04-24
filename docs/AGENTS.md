# DLNS Stats Site — Agent Instructions

DLNS Stats Site is a Flask + React app for Deadlock Night Shift match tracking. See [README.md](README.md) for full project overview.

## Key Commands

### Backend
```bash
pip install -r requirements.txt
python debug_web.py          # Dev server (hot-reload, port 5050)
python wsgi.py               # WSGI entry for production
start_web.bat / start_web.sh # Production: waitress on port 5050, 12 threads
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite HMR dev server (port 5173, proxies /db/* → localhost:5050)
npm run build        # Outputs bundles to static/react-app/
npm run build:watch  # Watch mode during development
```

### Data ingestion
```bash
python main.py -matchfile matches.json             # Ingest new matches
python main.py -matchfile matches.json -recheckall true  # Re-ingest all
```

## Architecture

**Hybrid rendering**: Flask serves both Jinja2 templates and React SPAs.
- **Jinja2** — home, search, profile, static pages. Templates in `templates/`; see `templates/base.html` for the master layout.
- **React SPA** — matchlist, match detail, players, heroes, stats, sounds, rank, VO. Flask serves `templates/react.html` with a `page` variable; React bundles in `static/react-app/` are loaded per-page.
- **Feature decision**: Use React for interactive pages with filtering/pagination; use Jinja2 for simple renders.

### Backend

- App factory: `create_app()` in `main_web.py`
- 16 blueprints registered in `main_web.py` — see `blueprints/` for all features
- Primary read API: `blueprints/db_api.py` at prefix `/db`
- Auth: Discord OAuth2 in `blueprints/auth.py` at `/auth`
- Caching: `cache.py` wraps Flask-Caching (`SimpleCache` by default); use `@cache.cached(timeout=N)` on GET endpoints
- Compression: Brotli/gzip via Flask-Compress (enabled automatically)

### Database

- SQLite at `data/dlns.sqlite3` in WAL mode with foreign keys
- **Always open read-only** using the URI pattern in `blueprints/db_api.py`:
  ```python
  uri = f"file:{db_path.as_posix()}?mode=ro&cache=shared"
  conn = sqlite3.connect(uri, uri=True, timeout=15)
  ```
- Schema documented in [docs/db_schema.md](docs/db_schema.md)
- Key tables: `matches`, `players`, `users`, `user_stats`
- Indexes: `idx_players_match(match_id)`, `idx_players_account(account_id)`

### Frontend

- **Vite** with multiple entry points (one per feature), not a single SPA
- Entry files live in `frontend/src/entries/`; pages in `frontend/src/pages/`; shared components in `frontend/src/components/`
- API client: `frontend/src/api/matchesApi.js` — base URL auto-switches dev/prod via `import.meta.env.DEV`
- OpenAPI spec: `openapi_spec.json` (v2026.04)

## Conventions

| Area | Convention |
|------|-----------|
| React components | PascalCase exports, PascalCase filenames |
| Blueprint files | `snake_case.py` |
| Flask routes | lowercase with hyphens/underscores |
| DB columns | `snake_case` |
| API response | `jsonify({...})` with column-name keys via `_rows_to_dicts()` |
| New blueprint | Create in `blueprints/`, register in `main_web.py` `create_app()` |
| New React page | Add entry in `frontend/src/entries/`, add to `vite.config.js` input, add route in Flask (`blueprints/react_stats.py`) |

## Environment Variables

Required: `SECRET_KEY`, `BASE_URL`, `DB_PATH`, `STEAM_API_KEY`  
See [README.md](README.md#configure-environment) for the full list of optional vars.

## Important Files

| File | Purpose |
|------|---------|
| `main_web.py` | App factory, blueprint registration, config |
| `blueprints/db_api.py` | All `/db/*` JSON API endpoints |
| `cache.py` | Shared cache instance |
| `frontend/vite.config.js` | Bundle entry points and proxy config |
| `frontend/src/api/matchesApi.js` | Frontend API client |
| `templates/react.html` | Universal React mount template |
| `docs/db_schema.md` | Full database schema |
| `docs/db_api_schema.md` | API schema notes |
