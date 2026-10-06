# Documentation

| Guide | Contents |
| --- | --- |
| [Project README](../README.md) | Overview, quick start, common commands, and test commands |
| [Configuration and operations](CONFIGURATION.md) | Environment variables, integrations, cache/replay settings, and serving the app |
| [Data ingestion](INGESTION.md) | Match-feed format, ingester options, and update scripts |
| [Development guide](AGENTS.md) | Source conventions, frontend/backend workflows, and tests |
| [Project structure](PROJECT_STRUCTURE.md) | Current repository layout and application organization |
| [Database schema](db_schema.md) | SQLite tables, fields, relationships, and indexes |
| [Database API notes](db_api_schema.md) | `/db` endpoint behavior and response notes |
| [OpenAPI specification](openapi_spec.json) | Machine-readable API contract served at `/api/openapi.json` |

The update history shown by the site is maintained in [`data/update.md`](../data/update.md). `.env.example` is the template for local environment configuration.
