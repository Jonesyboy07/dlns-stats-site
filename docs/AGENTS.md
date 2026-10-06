# Development guide

This guide summarizes the current repository workflows and conventions for contributors. See the [README](../README.md) for setup and the [project structure](PROJECT_STRUCTURE.md) for the source layout.

## Commands

Run commands from the repository root unless noted.

### Backend

```bash
python -m pip install -r backend/requirements.txt
python run.py                 # Local Flask server at 127.0.0.1:5050
python run_debug.py           # Debug server at 127.0.0.1:5050
python -m unittest discover -s backend/tests
```

For production, `wsgi.py` exposes the Flask app as `wsgi:app`. `scripts/start_web.sh` and `scripts/start_web.bat` build the frontend and run Waitress. See [configuration and operations](CONFIGURATION.md).

### Frontend

```bash
cd frontend
npm install
npm run dev          # Vite development server (port 5173)
npm run build        # Bundles to ../public/react-app/
npm run build:watch  # Rebuild on source changes
npm test             # Run Vitest tests
```

The Vite development server proxies backend paths such as `/db`, `/auth`, `/admin`, `/interviews`, `/dlns`, `/public`, and `/static` to port 5050.

### Data ingestion

```bash
python backend/main.py -matchfile data/matches.json
python backend/main.py -matchfile data/matches.json -recheckall true
python backend/main.py -matchfile data/matches.json -metasync true
python backend/main.py -db data/dlns.sqlite3 -laneinfer true
```

See [data ingestion](INGESTION.md) for the supported input shape, all maintenance options, and wrapper scripts.

## Architecture

- **Flask/Jinja:** shared site layout and server-rendered pages use templates in `templates/`.
- **React:** interactive pages use separate entry points in `frontend/src/entries/`; page components live in `frontend/src/pages/`.
- **Routes:** Flask blueprints are listed in `backend/app/blueprints/registry.json` and loaded by `backend/app/blueprints/loader.py`.
- **Database:** SQLite is initialized by the application/ingester. The `/db` API uses read-only connections for query endpoints. Schema details are in [db_schema.md](db_schema.md).
- **API:** the primary JSON API is in `backend/app/blueprints/db_api.py`; its OpenAPI reference is available at `/api/docs`.

When adding a React page, follow an existing page's pattern: add the entry under `frontend/src/entries/`, include it in `frontend/vite.config.js`, and add or update the matching Flask page route/template as appropriate.

## Test locations

- Backend: `backend/tests/` (Python `unittest`).
- Frontend: `frontend/src/**/*.test.js` and `frontend/src/**/*.test.jsx` (Vitest).

## Key files

| File | Purpose |
| --- | --- |
| `run.py` | Local Flask entry point |
| `run_debug.py` | Debug Flask entry point |
| `wsgi.py` | WSGI application object |
| `backend/app/main_web.py` | Flask app factory and configuration |
| `backend/app/blueprints/registry.json` | Registered blueprint list |
| `backend/app/blueprints/db_api.py` | Main `/db` JSON API |
| `frontend/vite.config.js` | Vite entries, build output, dev proxies, and Vitest config |
| `docs/openapi_spec.json` | Tracked OpenAPI specification |
| `docs/db_schema.md` | SQLite schema reference |
| `docs/db_api_schema.md` | `/db` endpoint notes |
