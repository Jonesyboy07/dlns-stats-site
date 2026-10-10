# Data ingestion and maintenance

The batch ingester is `backend/main.py`. Run it from the repository root so default relative paths resolve as expected. `STEAM_API_KEY` is used for external match data requests; set it in `.env` before ingesting.

## Match feed

The `-matchfile` input is JSON organized into series, weeks, games, and match records. The tracked feed at `data/matches.json` is the reference for the supported structure:

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

Normal ingestion tracks processed IDs in `data/matches_status.json` and skips those already checked. `-recheckall true` bypasses that skip. The maintenance flags run their task and exit; lane inference fills `players.lane_real`, while lane backfill fills the game-reported `players.lane`.

## CLI options

| Option | Purpose |
| --- | --- |
| `-matchfile PATH` / `-matchjson PATH` | JSON match feed (`-matchjson` is an alias) |
| `-recheckall true` | Process all feed IDs, including already checked IDs |
| `-concurrency N` | Concurrent match workers |
| `-userfetch true` | Refetch usernames for cached users |
| `-itembackfill true` | Backfill items across current matches |
| `-lanebackfill true` | Fill missing game-reported lane assignments |
| `-laneinfer true` | Infer real lanes from match paths. `-laneinfer force` re-infers matches that already have `lane_real` (needed after a change to the lane geometry) |
| `-goldbackfill true` | Backfill player soul-income sources |
| `-dmgbackfill true` | Backfill player damage sources |
| `-timelinebackfill true` | Backfill `match_objectives`, `match_mid_boss` and the `player_deaths` detail columns for matches missing them |
| `-pathsbackfill true` | Backfill `match_player_paths` (per-player position trails for the map replay) for matches missing them |
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
`docs/db_schema.md` for how the raw grid coordinates become world coordinates.

## Repository scripts

| Script | Purpose |
| --- | --- |
| `scripts/build_frontend.sh` | Install frontend dependencies if needed and run the Vite production build |
| `scripts/build_replay_index.py` | Build the replay index immediately |
| `scripts/start_web.sh` / `.bat` | Build frontend, then start Waitress |
| `scripts/start_forced.sh` / `.bat` | Start Waitress with frontend watch mode; refresh replay index first |
| `scripts/update_db_from_matches.sh` / `.bat` | Ingest `data/matches.json` and run metadata, username, lane, gold, and damage maintenance passes |
| `scripts/update_if_remote_changed.sh` | Server-side updater for a fixed deployment path/service; inspect its constants before use |

The updater script is deployment-specific (`/opt/dlns-stats-site`, `main`, and systemd service `dlns-stats`) and should not be run as a generic local update command.
