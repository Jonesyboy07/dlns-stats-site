# Project structure

The repository root contains the runnable entry points and the site assets. The Python application and batch ingester are grouped under `backend/`; the React source and Vite configuration are under `frontend/`.

```text
.
├── backend/
│   ├── app/
│   │   ├── blueprints/       Flask route groups and blueprint registry
│   │   ├── utils/            Shared backend helpers
│   │   ├── main_web.py       Flask application factory
│   │   ├── debug_web.py      Debug app factory
│   │   ├── cache.py          Shared cache instance
│   │   └── wsgi.py            App import helper
│   ├── tests/                Python unittest tests
│   ├── main.py               Match ingestion and database maintenance CLI
│   ├── constants.py
│   └── requirements.txt
├── data/                     Match feed and other data; SQLite and caches are runtime files
├── docs/                     Project guides, schema/API references, and OpenAPI spec
├── frontend/
│   ├── src/
│   │   ├── entries/          Vite entry points, generally one per React page
│   │   ├── pages/            Page components
│   │   ├── components/       Shared and feature components
│   │   ├── api/              API clients
│   │   └── utils/            Frontend utilities and tests
│   ├── package.json
│   └── vite.config.js
├── public/                   Public assets; React build output is public/react-app/
├── scripts/                  Build, server, ingestion, and replay-index utilities
├── static/                   Additional and legacy static assets
├── templates/                Flask/Jinja templates
├── run.py                    Local Flask entry point
├── run_debug.py              Debug Flask entry point
└── wsgi.py                   WSGI entry point for production servers
```

## Application layout

- `backend/app/main_web.py` creates the Flask app, configures shared services, and registers blueprints.
- `backend/app/blueprints/registry.json` is the source of truth for registered blueprints. Their implementations are in the adjacent Python modules.
- The Flask app renders Jinja templates from `templates/`, serves public assets from `public/`, and falls back to `static/` for migrated assets.
- `frontend/src/entries/` contains multiple Vite entry points; built bundles are written to `public/react-app/` and are ignored by Git.
- `backend/main.py` is a separate CLI for ingesting and maintaining match data.
- The SQLite schema is initialized/upgraded by the web application and the ingester. See [database schema](db_schema.md).

For local setup, see the [README](../README.md). For development and testing commands, see [development guide](AGENTS.md).
