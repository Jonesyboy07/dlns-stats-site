# Bracket administration

The bracket editor is available to admins at `/admin/brackets/`. Its UI is
[`frontend/src/pages/BracketAdmin.jsx`](../../frontend/src/pages/BracketAdmin.jsx);
the Flask routes and save jobs are in
[`backend/app/blueprints/brackets.py`](../../backend/app/blueprints/brackets.py),
and the format/advancement helpers are in
[`backend/app/utils/brackets.py`](../../backend/app/utils/brackets.py).
Focused backend coverage is in
[`backend/tests/test_brackets.py`](../../backend/tests/test_brackets.py).

## Supported workflows

- Create and edit events, rounds and series; supported formats are Gauntlet and
  single elimination.
- Enter teams and match IDs, choose each game's winner, and optionally record
  forfeits, unavailable matches, VODs and hero bans.
- Save a series to fetch match data and update the database. Scores and
  advancement are computed from game results rather than stored separately.
- Read the current event schedule from `brackets.json` beside the configured
  database. With the default `DB_PATH`, that file is [`data/brackets.json`](../../data/brackets.json).

The legacy MatchAdmin bulk-submit workflow also records submitted games in the
bracket schedule. Its route and ingestion logic are in
[`backend/app/blueprints/admin.py`](../../backend/app/blueprints/admin.py).
See [data ingestion](../INGESTION.md) for its input shape and maintenance tasks.

## Week safeguards and backups

Every bracket save keeps a backup of the previous schedule as
`brackets.json.bak-<utc stamp>`; the 10 most recent are retained. Before a
series save or an event week change, the backend compares the affected matches'
play dates with the matches already assigned to that week. If their date
windows differ by at least three days, it returns a confirmation warning
instead of changing data. The editor's **Save anyway** action explicitly
confirms the update. A new event can share a week with an existing event,
because regional events can run on different nights.

## Local development

Run the app against an isolated copy of the database and related data files:

```bash
python run_debug.py --sandbox
```

The first run seeds `data/sandbox/`; subsequent runs reuse it. To discard that
sandbox and copy the current real data again, run:

```bash
python run_debug.py --sandbox --reset
```

`--reset` deletes only the sandbox directory. Without `--sandbox`, writes go to
the configured database and its adjacent `brackets.json`. Build the frontend
with `cd frontend && npm install && npm run build` if the page bundle is not
available. To run the focused backend tests:

```bash
python -m unittest backend.tests.test_brackets
```

## Migrating legacy match schedules

[`scripts/migrate_brackets.py`](../../scripts/migrate_brackets.py) converts
weeks and regions in [`data/matches.json`](../../data/matches.json) into
bracket events. It reads match results from SQLite, writes only
`brackets.json`, and backs up that file before each write. By default it runs
as a dry run against sandbox data:

```bash
python scripts/migrate_brackets.py
python scripts/migrate_brackets.py --week 58
python scripts/migrate_brackets.py --write
```

To write the real schedule, explicitly select the data directory:

```bash
python scripts/migrate_brackets.py --target data --write
```

Hand corrections are read from
[`scripts/migrate_fixes.json`](../../scripts/migrate_fixes.json). Review the
script's `--help` output before using less common migration options.

For the earlier tournament data-shape proposal and match-submission research,
see [data-shape notes](data-shape.md) and [match-entry options](options.md);
they are historical references, not the current implementation specification.
