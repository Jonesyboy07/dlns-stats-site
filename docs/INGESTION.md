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
| `-laneinfer true` | Infer real lanes from match paths |
| `-goldbackfill true` | Backfill player soul-income sources |
| `-dmgbackfill true` | Backfill player damage sources |
| `-metasync true` | Reapply feed metadata to existing matches without API requests |
| `-db PATH` | SQLite database path |
| `-cache PATH` | User-cache JSON path |
| `-status PATH` | Match-status JSON path |
| `-herofetch true` | Fetch hero details into the hero cache |
| `-herostart ID`, `-heroend ID` | Inclusive hero ID range for hero fetch |
| `-herocache PATH` | Hero-details cache path |
| `-heroforce true` | Refetch hero details even when cached |
| `-herodelay SECONDS` | Delay between hero requests |

Boolean options accept strings such as `true` and default to `false`. Run `python backend/main.py --help` for the current CLI help.

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
