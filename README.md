# DLNS Stats Site

DLNS Stats is a Flask and React application for exploring Deadlock Night Shift matches, players, teams, heroes, and event statistics. Match data is stored in SQLite, with a batch ingester for importing and enriching match records.

## Features

- Server-rendered pages and multi-entry React pages for match, player, hero, team, and stats workflows.
- JSON endpoints for matches, users, heroes, teams, and statistics.
- Discord authentication and administrative tools.
- Replay lookup, persistent replay URL caching, and a periodically refreshed replay index.
- OpenAPI documentation at `/api/docs` and `/api/openapi.json`.

## Requirements

- Python and pip.
- Node.js and npm to develop or build the React frontend.
- A SQLite database. The application creates/upgrades its schema on startup; match data is populated by the ingester.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
cp .env.example .env             # Windows: copy .env.example .env
```

Edit `.env` as needed. A Steam API key is needed for match ingestion, not for simply starting the site. See [configuration and operations](docs/CONFIGURATION.md) before enabling external integrations or deploying.

Start the Flask app:

```bash
python run.py
```

Open <http://127.0.0.1:5050>. For the Flask debug server, use `python run_debug.py` instead.

### Frontend development

In a second terminal, install the frontend dependencies and start Vite:

```bash
cd frontend
npm install
npm run dev
```

Vite serves the frontend on port 5173 and proxies backend requests to the Flask server on port 5050. To produce deployable React bundles instead, run `npm run build`; Vite writes them to `public/react-app/`.

## Data ingestion

Match ingestion is a separate command from running the website. Given a match feed in the supported JSON format:

```bash
python backend/main.py -matchfile data/matches.json
```

The ingester tracks checked match IDs in `data/matches_status.json` and skips them by default. To reprocess every match in the feed:

```bash
python backend/main.py -matchfile data/matches.json -recheckall true
```

For the full option reference, input format, and repository scripts, see [data ingestion](docs/INGESTION.md).

## Project map

```text
backend/             Flask application, API blueprints, and data ingester
data/                Tracked source data and runtime database/cache files
docs/                Project, API, schema, setup, and operations documentation
frontend/            React source, Vite configuration, and frontend tests
public/              Public assets and generated React bundles
scripts/             Build, server-start, data-update, and replay-index scripts
static/              Legacy/static site assets
templates/           Flask/Jinja templates
run.py               Local Flask entry point
run_debug.py         Flask debug entry point
wsgi.py              WSGI application entry point
```

The application factory is `backend/app/main_web.py`; blueprint registration is defined by `backend/app/blueprints/registry.json`. See the [project structure](docs/PROJECT_STRUCTURE.md) and [development guide](docs/AGENTS.md) for more detail.

## Routes and API

The primary JSON API is under `/db`. Site pages include `/`, `/search`, `/matches/<match_id>`, `/users/<account_id>`, `/stats/`, `/help`, and `/community`. Other blueprint routes support authentication, admin functions, interviews, and the DLNS exporter.

- Interactive API reference: <http://localhost:5050/api/docs>
- OpenAPI JSON: <http://localhost:5050/api/openapi.json> or [`docs/openapi_spec.json`](docs/openapi_spec.json)
- Endpoint notes: [`docs/db_api_schema.md`](docs/db_api_schema.md)
- Database tables: [`docs/db_schema.md`](docs/db_schema.md)

## Tests

Run backend tests from the repository root:

```bash
python -m unittest discover -s backend/tests
```

Run frontend tests from `frontend/`:

```bash
npm test
```

## Documentation

Start with the [documentation index](docs/README.md). It links to local setup and configuration, data ingestion, development conventions, API details, and the database schema.

## License

MIT. See [LICENSE](LICENSE).
