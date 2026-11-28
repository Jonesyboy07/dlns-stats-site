# Data ingestion and maintenance

The batch ingester is [`backend/main.py`](../backend/main.py). Run it from the repository root so default relative paths resolve as expected. `STEAM_API_KEY` is used for external match data requests; set it in your local `.env` before ingesting.

## Match feed

The `-matchfile` input is JSON organized into series, weeks, games, and match records. The tracked feed at [`data/matches.json`](../data/matches.json) is the reference for the supported structure:

```json
{
  "series": [
    {
      "title": "Night Shift",
      "weeks": [
        {
          "week": 1,
          "games": [
            {
              "team_a": "Team A",
              "team_b": "Team B",
              "matches": [
                {
                  "game": "Game 1",
                  "match_id": 12345678,
                  "team_a_side": 0,
                  "match_vod": "https://example.com/vod"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Each game may contain multiple match records. The match feed carries event/team metadata in addition to the match IDs.

## Submitting from the live admin

The web admin can ingest a night without committing data to Git. The [MatchAdmin](../frontend/src/pages/MatchAdmin.jsx) and [BracketAdmin](../frontend/src/pages/BracketAdmin.jsx) entry points
write to the runtime files beside `DB_PATH` (`dlns.sqlite3` and `brackets.json`):

- **MatchAdmin** (`/admin/matches`) posts the `title` / `week` / `sets` form to
  `POST /admin/match/bulk-submit`, implemented in [`backend/app/blueprints/admin.py`](../backend/app/blueprints/admin.py). The background job fetches each match from the
  match API, writes the match and player rows, commits, then calls
  [`record_items()`](../backend/app/blueprints/brackets.py) to add the games to
  [`data/brackets.json`](../data/brackets.json).
- **BracketAdmin** (`/admin/brackets`) saves the event and each series to
  [`data/brackets.json`](../data/brackets.json) first, then runs the same ingest job with `bracket_saved` set so
  the bracket is not rewritten.

Both jobs also write the rows derived from the match metadata — objectives, mid boss
kills, death details, damage by source and the per-player position trails — through
the same `ingest_match_extras()` the feed ingest uses. Nothing extra is fetched for
it: the metadata the job already holds is enough. If that step fails for a game, the
job still saves the submission and names the affected match IDs in its message, and
`-timelinebackfill` fills them afterwards.

[`data/brackets.json`](../data/brackets.json) is the schedule the home page and `/db/weeks` read, so a submission
that only reaches the database (for example because the bracket write failed) shows
on `/matches` but not in the home page's week groups. Keep `data/brackets.json`
writable by the service user and avoid resetting it to the Git version on deploys.

## Common commands

```bash
# Process unchecked match IDs from the feed
python backend/main.py -matchfile data/matches.json

# Reprocess every ID in the feed; increases API work
python backend/main.py -matchfile data/matches.json -recheckall true

# Limit concurrent match workers
python backend/main.py -matchfile data/matches.json -concurrency 6

# Reapply feed metadata to matches already in the database (no API calls)
python backend/main.py -matchfile data/matches.json -metasync true

# Refresh cached usernames or run a targeted maintenance pass
python backend/main.py -userfetch true
python backend/main.py -lanebackfill true
python backend/main.py -laneinfer true
python backend/main.py -goldbackfill true
python backend/main.py -dmgbackfill true
python backend/main.py -itembackfill true
```

Normal ingestion tracks processed IDs in [`data/matches_status.json`](../data/matches_status.json) and skips those already checked. `-recheckall true` bypasses that skip. Forfeit and unavailable games are filed under negative placeholder IDs; the match API rejects those, so the fetcher skips them instead of spending request quota on them, and they are never marked checked. `-metasync` still applies the metadata authored for those rows. The maintenance flags run their task and exit; lane inference fills `players.lane_real`, while lane backfill fills the game-reported `players.lane`.

## CLI options

| Option | Purpose |
| --- | --- |
| `-matchfile PATH` / `-matchjson PATH` | JSON match feed (`-matchjson` is an alias) |
| `-recheckall true` | Process all feed IDs, including already checked IDs |
| `-concurrency N` | Concurrent match workers |
| `-userfetch true` | Refetch usernames for cached users |
| `-itembackfill true` | Backfill items across current matches |
| `-lanebackfill true` | Fill missing game-reported lane assignments |
| `-laneinfer true` | Infer real lanes from match paths. `-laneinfer force` re-infers matches that already have `lane_real` (needed after a change to the lane geometry or to the position transform) |
| `-goldbackfill true` | Backfill player soul-income sources |
| `-dmgbackfill true` | Backfill player damage sources |
| `-timelinebackfill true` | Backfill `match_objectives`, `match_mid_boss` and the `player_deaths` detail columns for matches missing them. Pass a match id instead of `true` to backfill only that match |
| `-pathsbackfill true` | Backfill `match_player_paths` (per-player position trails for the map replay) for matches missing them. Pass a match id instead of `true` to backfill only that match |
| `-sinceweek N` | Limit the `-timelinebackfill`, `-pathsbackfill` and `-demoparse` sweeps to matches from event week N onwards |
| `-demoparse true` | Parse replay demos for matches not yet parsed (see [Demo parsing](#demo-parsing)). Pass a match id instead of `true` to parse only that match |
| `-demoreparse true` | With `-demoparse`: also re-run matches already parsed or that failed |
| `-demotimeout SECONDS` | With `-demoparse`: how long one demo may take (default 600) |
| `-demokeep true` | With `-demoparse`: keep each match's downloaded and decompressed files for debugging |
| `-metasync true` | Reapply feed metadata to existing matches without API requests |
| `-timelineprobe MATCH_ID` | Fetch one match's metadata, print a timeline summary, and dump the raw JSON under `-probedir`; read-only, never touches the DB or feed |
| `-probedir PATH` | Output directory for `-timelineprobe` raw dumps (default `data/_probe`) |
| `-db PATH` | SQLite database path |
| `-cache PATH` | User-cache JSON path |
| `-status PATH` | Match-status JSON path |
| `-herofetch true` | Fetch hero details into the hero cache |
| `-herostart ID`, `-heroend ID` | Inclusive hero ID range for hero fetch |
| `-herocache PATH` | Hero-details cache path |
| `-heroforce true` | Refetch hero details even when cached |
| `-herodelay SECONDS` | Delay between hero requests |

Boolean options accept strings such as `true` and default to `false`. Run `python backend/main.py --help` for the current CLI help.

### Position trail backfill

`-pathsbackfill true` targets matches with no rows in `match_player_paths`, so
re-running it only fetches what is still missing. It is the heaviest maintenance pass:
the match metadata payload carries every player's whole-match trail, so each match costs
one request of a couple of megabytes and takes a few seconds. A full sweep over a few
hundred matches therefore takes a while, and committing every ten matches means partial
progress survives an interruption.

Normal ingest writes trails at the same time as the rest of a match, so a backfill is
only needed for matches ingested before `match_player_paths` existed. See
[the database schema](db_schema.md) for how the raw grid coordinates become world coordinates.

A full sweep is expensive, so `-pathsbackfill <match_id>` fetches a single match
instead. That is the practical way to populate one match for local work:

```
python3 backend/main.py -pathsbackfill 38787362
```

`-sinceweek N` keeps either sweep to the matches played from week N onwards, which is
what a repair after a broken night usually wants:

```
python3 backend/main.py -timelinebackfill true -sinceweek 60
python3 backend/main.py -pathsbackfill true -sinceweek 60
```

### Demo parsing

`-demoparse` reads a match's replay file (`.dem`) rather than the metadata API, which
gives what the API cannot: every player's souls, kills, deaths, assists, hero damage and
level **every second**, the assisters of each kill, hero-on-hero damage per second, and
timed events (breakables, the mid boss kill and Rejuvenator pickups). The code is in
[`backend/demo_parsing/`](../backend/demo_parsing/); the tables are described in
[the database schema](db_schema.md#demo-parsing).

**Setup.** The parser, [boon](https://github.com/pnxenopoulos/boon), is optional and only
needed where this command runs, not on the web server:

```
python -m pip install -r backend/requirements-demo.txt
```

Or install it into a separate virtualenv and set `DEMO_PYTHON` to that interpreter.
boon 0.11+ reads demos recorded from the City Never Sleeps update (2026-09-29) onwards;
older demos fail with the pinned version and are recorded as `failed`.

**Where demos come from.** First the replay share, through the index the web app keeps
(`_cache/replay_index.json`, or `REPLAY_INDEX_FILE_CACHE_PATH`) and
`REPLAY_DOWNLOAD_BASE_URL`. For matches from the last 30 days that are not on the share,
Valve's replay host is tried as well, but Valve deletes demos within weeks. The share
stores each demo as a zstd-compressed `.dem` inside a zip; the command decompresses it
(Python 3.14+, or the `zstandard` package).

**What a run does.** Each match is downloaded to a temporary folder (`DEMO_WORK_DIR`,
default the system temp directory), parsed in a separate process with a time limit, and
written in one transaction; the files are deleted afterwards. Every match gets a
`match_demo_parse` row, so re-running only does what is left:

| Status | Meaning | Next sweep |
| --- | --- | --- |
| `ok` | Parsed | Skipped (re-run with `-demoreparse true`) |
| `no_demo` | Not on the share or at Valve | Checked again: a replay may be uploaded later |
| `failed` | Found, but download or parse failed; `error` says why | Skipped (re-run with `-demoreparse true`) |

A 30-minute match takes about 25 seconds including the download and adds about 110 KB to
the database.

```
python3 backend/main.py -demoparse 121839019
python3 backend/main.py -demoparse true -sinceweek 60
```

### Which database the CLI uses

`-db` defaults to `DB_PATH` when that is set in the environment (or `.env`), which is
the same value the web app reads, so a maintenance pass and the running server work on
one file. When `DB_PATH` is unset it falls back to `data/dlns.sqlite3` in the checkout.
Every backfill prints the database it resolved, and reports an empty database as empty
rather than as complete, so targeting the wrong file is visible instead of looking like
a job that had already finished.

## Repository scripts

| Script | Purpose |
| --- | --- |
| [`scripts/build_frontend.sh`](../scripts/build_frontend.sh) | Install frontend dependencies if needed and run the Vite production build |
| [`scripts/build_replay_index.py`](../scripts/build_replay_index.py) | Build the replay index immediately |
| [`scripts/start_web.sh`](../scripts/start_web.sh) / [`scripts/start_web.bat`](../scripts/start_web.bat) | Build frontend, then start Waitress |
| [`scripts/start_forced.sh`](../scripts/start_forced.sh) / [`scripts/start_forced.bat`](../scripts/start_forced.bat) | Start Waitress with frontend watch mode; refresh replay index first |
| [`scripts/update_db_from_matches.sh`](../scripts/update_db_from_matches.sh) / [`scripts/update_db_from_matches.bat`](../scripts/update_db_from_matches.bat) | Ingest `data/matches.json` and run metadata, username, lane, gold, and damage maintenance passes |
| [`scripts/update_if_remote_changed.sh`](../scripts/update_if_remote_changed.sh) | Server-side updater for a fixed deployment path/service; inspect its constants before use |

The updater script is deployment-specific (`/opt/dlns-stats-site`, `main`, and systemd service `dlns-stats`) and should not be run as a generic local update command.
