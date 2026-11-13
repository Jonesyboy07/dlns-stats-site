# Documentation

| Guide | Contents |
| --- | --- |
| [Project README](../README.md) | Overview, quick start, common commands, and test commands |
| [Configuration and operations](CONFIGURATION.md) | Environment variables, integrations, cache/replay settings, and serving the app |
| [Python CDN](CDN.md) | File serving, caching, site CSS sync, uploads, and nginx deployment |
| [Data ingestion](INGESTION.md) | Match-feed format, ingester options, and update scripts |
| [Development guide](AGENTS.md) | Source conventions, frontend/backend workflows, and tests |
| [Project structure](PROJECT_STRUCTURE.md) | Current repository layout and application organization |
| [Analytics](ANALYTICS.md) | Privacy-first analytics design and legitimate-interest assessment |
| [Database schema](db_schema.md) | SQLite tables, fields, relationships, and indexes |
| [Database API notes](db_api_schema.md) | `/db` endpoint behavior and response notes |
| [OpenAPI specification](openapi_spec.json) | Machine-readable API contract served at `/api/openapi.json` |
| [Bracket administration](match-entry/README.md) | Current bracket editor workflows, safeguards, and migration |
| [Bracket data-shape notes](match-entry/data-shape.md) | Earlier design proposal; refer to the current bracket guide and implementation |
| [Match-entry research](match-entry/options.md) | Historical research on speeding up match submission |
| [Team crest guide](../public/images/teamLogos/README.md) | Naming, fallback, and artwork requirements for team logos |

## Operational references
 
- [nginx CDN example](cdn-nginx.conf) and [CDN systemd unit](dlns-cdn.service), used with the [Python CDN guide](CDN.md).
- [Stats page design](stats-redesign/Stats%20Page.dc.html) and its [preview](stats-redesign/Preview.dc.html).
- The OpenAPI document is generated from [`backend/app/openapi_spec.py`](../backend/app/openapi_spec.py) by [`scripts/sync_openapi.py`](../scripts/sync_openapi.py).
- The site's update history is maintained in [`data/update.md`](../data/update.md), and [`.env.example`](../.env.example) is the local environment template.
