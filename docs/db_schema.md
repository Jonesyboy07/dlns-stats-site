# Database Schema (SQLite)

This project uses a single SQLite database. The schema is created by the `SCHEMA_SQL` block in [`backend/main.py`](../backend/main.py) and initialized/upgraded when the web app starts.

## Overview

Tables:
- `users` stores Steam users and names.
- `matches` stores match-level metadata.
- `players` stores per-player stats for each match.
- `player_deaths` stores a midpoint-distance value for every player death.
- `match_objectives` stores objective destructions for the match timeline.
- `match_mid_boss` stores mid boss (Rejuvenator) kills.
- `match_player_paths` stores per-player position trails for the map replay.
- `match_demo_parse`, `match_player_series`, `match_kill_assists`, `match_hero_damage`
  and `match_demo_events` hold what demo parsing reads from replay files (see
  [Demo parsing](#demo-parsing)).
- `user_stats` stores per-user aggregates derived from `players`.
- `teams` stores one row per team identity, and `team_names` maps the raw team
  names written on each match onto it (see [Team identity](#team-identity)).

Relationships:
- `players.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `players.account_id` -> `users.account_id` (ON DELETE SET NULL)
- `player_deaths.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `match_objectives.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `match_mid_boss.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `match_player_paths.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `match_demo_parse`, `match_player_series`, `match_kill_assists` and
  `match_demo_events`: `match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `user_stats.account_id` -> `users.account_id` (ON DELETE CASCADE)

## Pragmas

- `PRAGMA journal_mode=WAL;`
- `PRAGMA foreign_keys=ON;`

## Table: `users`

Stores Steam user IDs and their persona names.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `account_id` | INTEGER | No | Primary key |
| `persona_name` | TEXT | Yes | Defaults to `Unknown` in code |
| `updated_at` | TEXT | Yes | ISO-8601 UTC |

## Table: `matches`

Stores per-match metadata.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | Primary key |
| `duration_s` | INTEGER | Yes | Match duration in seconds |
| `winning_team` | INTEGER | Yes | 0/1 as returned by API |
| `match_outcome` | INTEGER | Yes | Raw outcome enum from API |
| `game_mode` | INTEGER | Yes | Raw mode enum from API |
| `match_mode` | INTEGER | Yes | Raw match mode enum from API |
| `event_title` | TEXT | Yes | Event name from match JSON (e.g. Night Shift) |
| `event_week` | INTEGER | Yes | Event week from match JSON |
| `event_team_a` | TEXT | Yes | Team A/name from match JSON game entry |
| `event_team_b` | TEXT | Yes | Team B/name from match JSON game entry |
| `event_game` | TEXT | Yes | Game label from match JSON (e.g. Game 1) |
| `event_team_a_ingame_side` | INTEGER | Yes | Team A in-game side from match JSON, `0` = Amber and `1` = Sapphire |
| `start_time` | TEXT | Yes | ISO-8601 UTC (derived from API) |
| `game_version` | INTEGER | Yes | Deadlock build number active at `start_time`, from the leading number of the SteamTracking/GameTracking-Deadlock commit message (e.g. `6759`). NULL until resolved |
| `created_at` | TEXT | Yes | ISO-8601 UTC (scrape time) |

Notes:
- `game_version` is resolved by [`backend/game_version.py`](../backend/game_version.py). It pulls the full GameTracking-Deadlock commit history once (commits-only `git fetch`, under 1 MB, no API rate limit; requires `git` on the host) and stores a timestamp -> version table in `data/_cache/game_versions.json` (git-ignored, as is the clone beside it). It only re-syncs when a timestamp is newer than the last sync, at most every 10 minutes. Existing DBs are filled with `python backend/main.py -versionbackfill true` (`force` recomputes all); `update_db_from_matches` runs it.
- `start_time` may be derived from multiple API fields and normalized to ISO-8601 UTC.
- Migrations add `start_time`, `event_title`, `event_week`, `event_team_a`, `event_team_b`, `event_game`, and `event_team_a_ingame_side` if they do not exist.

## Table: `players`

Stores per-player stats for each match.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `account_id` | INTEGER | Yes | FK -> `users.account_id` |
| `player_slot` | INTEGER | Yes | 1-12 in API data |
| `team` | INTEGER | Yes | 0 or 1 derived from slot |
| `lane` | INTEGER | Yes | Game-reported lane assignment (`assigned_lane`). Lane ids: 1=York (Yellow), 4=Broadway (Blue), 6=Greenwich (Green). NULL when unavailable (frontend shows "—"). |
| `lane_real` | INTEGER | Yes | Inferred real lane from `match_paths` positional clustering during laning (see `-laneinfer`). Same 1/4/6 encoding. NULL when inference unavailable (fall back to `lane`). Corrects in-game lane swaps at game start. |
| `hero_id` | INTEGER | Yes | Hero identifier |
| `level` | INTEGER | Yes | Player level |
| `kills` | INTEGER | Yes | - |
| `deaths` | INTEGER | Yes | - |
| `assists` | INTEGER | Yes | - |
| `net_worth` | INTEGER | Yes | - |
| `last_hits` | INTEGER | Yes | - |
| `denies` | INTEGER | Yes | - |
| `creep_kills` | INTEGER | Yes | From snapshot, fallback to `last_hits` |
| `shots_hit` | INTEGER | Yes | Derived from stats snapshots |
| `shots_missed` | INTEGER | Yes | Derived from stats snapshots |
| `player_damage` | INTEGER | Yes | - |
| `obj_damage` | INTEGER | Yes | Uses boss damage as proxy |
| `player_healing` | INTEGER | Yes | - |
| `pings_count` | INTEGER | Yes | Length of `pings` array |
| `result` | TEXT | Yes | `Win` or `Loss` |

Primary Key:
- (`match_id`, `account_id`)

Indexes:
- `idx_players_match` ON `players(match_id)`
- `idx_players_account` ON `players(account_id)`

## Table: `player_deaths`

Stores one row for each player death in a match. When the match payload includes
`death_details`, that list is the source: it carries the exact death time, death position
and killer, and its length matches the per-player death count shown elsewhere. Payloads
without it fall back to increases in the player stats snapshots, which only date a death
to the snapshot that reported it (positions are sampled at that snapshot) and can
over-count the final death. Each per-axis midpoint distance uses the map origin as its
zero point; `midpoint_distance` is the Euclidean 3D distance and is NULL unless all three
coordinates are available. The killer's own position comes from the same `death_details`
entry, and is what the match timeline draws its killer-to-victim lines from; rows written
before that column existed stay NULL until `-timelinebackfill true` re-reads them.
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `account_id` | INTEGER | No | Player account ID |
| `death_index` | INTEGER | No | One-based death number for this player in this match |
| `death_time_s` | INTEGER | Yes | Exact death time from `death_details`, or the first stats snapshot that reports the death on the fallback path |
| `position_x` | REAL | Yes | Death-time map X coordinate |
| `position_y` | REAL | Yes | Death-time map Y coordinate |
| `position_z` | REAL | Yes | Death-time map Z coordinate |
| `midpoint_distance_x` | REAL | Yes | Signed X distance from the map midpoint |
| `midpoint_distance_y` | REAL | Yes | Signed Y distance from the map midpoint |
| `midpoint_distance_z` | REAL | Yes | Signed Z distance from the map midpoint |
| `midpoint_distance` | REAL | Yes | Unsigned 3D Euclidean distance from the map midpoint |
| `killer_player_slot` | INTEGER | Yes | In-game slot (1-12) of the killer, from `death_details`; NULL on the snapshot fallback |
| `time_to_kill_s` | REAL | Yes | Time-to-kill in seconds, as reported for the death |
| `death_duration_s` | INTEGER | Yes | Death duration in seconds, as reported for the death |
| `killer_position_x` | REAL | Yes | Map X coordinate the killer stood at, from `death_details[].killer_pos`; NULL on the snapshot fallback |
| `killer_position_y` | REAL | Yes | Map Y coordinate the killer stood at |
| `killer_position_z` | REAL | Yes | Map Z coordinate the killer stood at |

Primary Key:
- (`match_id`, `account_id`, `death_index`)

Indexes:
- `idx_player_deaths_match` ON `player_deaths(match_id)`

## Table: `player_gold_sources`

Stores each player's soul-income breakdown (from the final stats snapshot's `gold_sources` array). Populated during ingest or via `-goldbackfill`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` (ON DELETE CASCADE) |
| `account_id` | INTEGER | Yes | FK -> `users.account_id` |
| `source` | INTEGER | No | Source id (see `SOUL_SOURCE_LABELS` in the frontend) |
| `kills` | INTEGER | Yes | Kills contributing to this source |
| `damage` | INTEGER | Yes | Damage contributing to this source |
| `gold` | INTEGER | Yes | Gold earned from this source |
| `gold_orbs` | INTEGER | Yes | Gold-orbs picked up from this source |

Source ids (user-confirmed): 1=Enemy Kills, 2=Troopers, 3=Neutral Enemies, 4=Objectives, 5=Urn, 6=Kill Assists, 7=Denies, 8=Team Catch-Up, 9=Ability Assassinate (Leaping Slash), 10=Trophy Collector (Item), 11=Cultist Sacrifice (Item), 12=Breakable Pickups, 13=Golden Goose Egg (Item).

Primary Key:
- (`match_id`, `account_id`, `source`)

Indexes:
- `idx_goldsrc_match` ON `player_gold_sources(match_id)`

## Table: `player_damage_sources`

Stores each player's hero-damage breakdown by source (ability/weapon/item/melee), derived from the match `damage_matrix`. Populated during ingest or via `-dmgbackfill`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` (ON DELETE CASCADE) |
| `account_id` | INTEGER | Yes | FK -> `users.account_id` |
| `source` | TEXT | No | Internal source name (e.g. `synth_pulse`, `upgrade_magic_shock`, `Bullet`, `Ability`) |
| `damage` | INTEGER | Yes | Hero damage from this source. deadlock-api reports `damage_matrix` at 2x the snapshot `player_damage`, so values are halved on ingest (verified ratio == 2.0 for every player) — sum(source damage) == `players.player_damage`. |

Sources are filtered to damage stat_type (0) and hero targets (slots 1-12, excluding the slot-0 non-hero aggregate). Labels are resolved in the frontend: hero abilities via [`data/hero_meta.json`](../data/hero_meta.json) image keys, items via the `/db/items/names` catalog (class_name -> display name), plus Weapon/Melee pattern matching.

Primary Key:
- (`match_id`, `account_id`, `source`)

Indexes:
- `idx_dmgsrc_match` ON `player_damage_sources(match_id)`

## Table: `match_objectives`

One row per team objective the match metadata reports: Tier 1 and Tier 2 walkers, the
Titan (base guardian), the Titan shield generators, barrack bosses and the Core
(patron). Rows exist for every objective, including ones that survived the match
(`destroyed_time_s` of `0`). Populated during ingest or via `-timelinebackfill`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` (ON DELETE CASCADE) |
| `team` | INTEGER | No | Team that destroyed the objective (`0`/`1`) |
| `objective_id` | INTEGER | No | Valve `ECitadelTeamObjective` id (see below) |
| `destroyed_time_s` | INTEGER | Yes | Match second it was destroyed; `0` when it survived |
| `first_damage_time_s` | INTEGER | Yes | Match second it first took damage; `0` when untouched |
| `player_damage` | INTEGER | Yes | Damage dealt to it by heroes |
| `creep_damage` | INTEGER | Yes | Damage dealt to it by creeps |
| `player_spirit_damage` | INTEGER | Yes | Spirit damage dealt to it by heroes |

Objective ids: 0=Core (Patron), 1-4=Tier 1 walkers (lane slots 1-4), 5-8=Tier 2 walkers,
9=Titan (base guardian), 10-11=Titan shield generators, 12-15=barrack bosses. Labels come
from `TEAM_OBJECTIVE_NAMES` in [`backend/main.py`](../backend/main.py).

The enum's lane slots are **not** the lane ids used elsewhere (`players.lane`): Valve's map
data pairs slot 1 with lane 1, slot 3 with lane 4 and slot 4 with lane 6, so a match only
ever reports slots 1, 3 and 4. `TEAM_OBJECTIVE_LANES` / `objective_lane()` in
[`backend/main.py`](../backend/main.py) hold that mapping; Titan, the shield generators and the Core belong to no
single lane.

Primary Key:
- (`match_id`, `team`, `objective_id`)

Indexes:
- `idx_match_objectives_match` ON `match_objectives(match_id)`

## Table: `match_mid_boss`

Mid boss (Rejuvenator) kills for a match, in the order the API reports them. A match
has none, one, or a couple when the boss respawns. Populated during ingest or via
`-timelinebackfill`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` (ON DELETE CASCADE) |
| `boss_index` | INTEGER | No | Zero-based order in which the API listed the kill |
| `team_killed` | INTEGER | Yes | Team that landed the killing blow |
| `team_claimed` | INTEGER | Yes | Team that claimed the drop |
| `destroyed_time_s` | INTEGER | Yes | Match second the boss was killed |

Primary Key:
- (`match_id`, `boss_index`)

Indexes:
- `idx_match_mid_boss_match` ON `match_mid_boss(match_id)`

## Table: `match_player_paths`

Per-player position trails from the metadata API's `match_paths` block, used by the
match map replay. One row per player per match holding the whole match in compressed
blobs rather than ~25,000 rows. Populated during ingest or via `-pathsbackfill`.

The API sends `x_pos`/`y_pos` on a `0..x_resolution` grid that each player's **own**
bounding box was normalised into, so ingest converts to world coordinates once using
`x_min`/`x_max`/`y_min`/`y_max` from the same entry (see `_path_world_samples` in
[`backend/main.py`](../backend/main.py)). Everything else on the site, including the map, works in world
units, so the conversion cannot be deferred to read time.

Samples are one second apart, so sample `i` is match second `i`. Positions outside the
playfield are kept: the API records the pre-game waiting area (around x = -13,000,
outside the ±10,752 the minimap covers) and players return there at the end of a match,
and the replay needs the sample index to stay aligned with elapsed time.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` (ON DELETE CASCADE) |
| `player_slot` | INTEGER | No | Slot the trail belongs to |
| `account_id` | INTEGER | Yes | From the matching entry in `players` |
| `interval_s` | REAL | Yes | Seconds between samples (1.0 in practice) |
| `sample_count` | INTEGER | No | Number of samples in `positions` |
| `world_min_x` | REAL | Yes | Extent of this trail, for framing the map |
| `world_max_x` | REAL | Yes | |
| `world_min_y` | REAL | Yes | |
| `world_max_y` | REAL | Yes | |
| `positions` | BLOB | No | zlib-compressed little-endian int16, x and y interleaved |
| `health` | BLOB | Yes | One byte per sample, zlib-compressed |
| `move_type` | BLOB | Yes | One byte per sample, zlib-compressed |
| `combat_type` | BLOB | Yes | One byte per sample, zlib-compressed |

Primary Key:
- (`match_id`, `player_slot`)

Indexes:
- `idx_match_player_paths_match` ON `match_player_paths(match_id)`

`health`, `move_type` and `combat_type` come free in the same payload and are stored so
a richer replay needs no re-fetch; nothing reads them yet.

## Demo parsing

Written by `backend/main.py -demoparse` (code in
[`backend/demo_parsing/`](../backend/demo_parsing/), usage in
[data ingestion](INGESTION.md#demo-parsing)). Everything here comes from the match's
replay file rather than the metadata API. Times are match-clock seconds, the same clock
as `player_deaths.death_time_s`; teams are 0 (Amber) and 1 (Sapphire). A re-parse
replaces all of a match's rows in one transaction.

### Table: `match_demo_parse`

One row per match that has been attempted, whatever happened.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | Primary key; FK -> `matches.match_id` |
| `status` | TEXT | No | `ok`, `no_demo` or `failed` |
| `source` | TEXT | Yes | `cdn` (the replay share) or `valve` |
| `parser` | TEXT | Yes | `boon` |
| `parser_version` | TEXT | Yes | The boon version that produced the rows |
| `demo_build` | INTEGER | Yes | Game build the demo was recorded on |
| `duration_s` | REAL | Yes | Regulation length read from the demo |
| `attempted_at` | TEXT | Yes | ISO-8601 UTC of the latest attempt |
| `parsed_at` | TEXT | Yes | ISO-8601 UTC of the latest successful parse |
| `error` | TEXT | Yes | Why the latest attempt failed |

A failed re-parse keeps an earlier `ok` (and its data) and only records the error.

### Table: `match_player_series`

Each player's stats every second, one row per player per match (packed, like
`match_player_paths`, rather than ~17,000 rows per match).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `account_id` | INTEGER | No | |
| `hero_id` | INTEGER | Yes | |
| `team` | INTEGER | Yes | 0 or 1 |
| `step_s` | INTEGER | No | Seconds between samples (1) |
| `sample_count` | INTEGER | No | Samples per field; sample `i` is match second `i * step_s` |
| `fields` | TEXT | No | Comma-separated field names, in packed order: `souls,kills,deaths,assists,hero_damage,level` |
| `data` | BLOB | No | Each field as little-endian int32 deltas, concatenated, zlib-compressed. Decode with `unpack_series` in `demo_parsing/store.py` |

`souls` is the player's net worth (souls held plus souls spent), the same quantity as
`player_snapshots.net_worth`. Each value is what the player had at the end of that
second; `hero_damage` and K/D/A are running totals.

Primary Key: (`match_id`, `account_id`)

### Table: `match_kill_assists`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `kill_index` | INTEGER | No | Kills in time order |
| `time_s` | REAL | No | Within a second of the matching `player_deaths.death_time_s` |
| `victim_account_id` | INTEGER | Yes | |
| `killer_account_id` | INTEGER | Yes | Null when no hero got the kill (troopers, guardians) |
| `assister_account_ids` | TEXT | No | JSON array of account ids |

Primary Key: (`match_id`, `kill_index`)

### Table: `match_hero_damage`

Hero-on-hero damage summed per second, so any window (a team fight) can be totalled.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | |
| `time_s` | INTEGER | No | Match second |
| `attacker_account_id` | INTEGER | No | |
| `victim_account_id` | INTEGER | No | |
| `damage` | INTEGER | No | Damage dealt (after mitigation) in that second |

Primary Key: (`match_id`, `time_s`, `attacker_account_id`, `victim_account_id`); `WITHOUT ROWID`.

### Table: `match_demo_events`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `event_index` | INTEGER | No | |
| `kind` | TEXT | No | `breakable`, `mid_boss_killed` or `rejuv_pickup` |
| `time_s` | REAL | No | |
| `team` | INTEGER | Yes | The picking-up team for `rejuv_pickup`; null for the boss itself |
| `account_id` | INTEGER | Yes | Not recorded yet for any kind |
| `name` | TEXT | Yes | Breakable subclass, e.g. `citadel_breakable_prop_wooden_crate` |
| `x`, `y`, `z` | REAL | Yes | World position (breakables) |

Primary Key: (`match_id`, `event_index`)

Indexes:
- `idx_match_demo_events_kind` ON `match_demo_events(match_id, kind)`

## Table: `user_stats`

Stores aggregated per-user statistics computed from `players`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `account_id` | INTEGER | No | Primary key, FK -> `users.account_id` |
| `matches_played` | INTEGER | Yes | - |
| `wins` | INTEGER | Yes | - |
| `losses` | INTEGER | Yes | - |
| `kills` | INTEGER | Yes | - |
| `deaths` | INTEGER | Yes | - |
| `assists` | INTEGER | Yes | - |
| `last_hits` | INTEGER | Yes | - |
| `denies` | INTEGER | Yes | - |
| `creep_kills` | INTEGER | Yes | - |
| `shots_hit` | INTEGER | Yes | - |
| `shots_missed` | INTEGER | Yes | - |
| `player_damage` | INTEGER | Yes | - |
| `obj_damage` | INTEGER | Yes | - |
| `player_healing` | INTEGER | Yes | - |
| `pings_count` | INTEGER | Yes | - |
| `avg_kda` | REAL | Yes | (kills + assists) / max(deaths, 1) |
| `winrate` | REAL | Yes | wins / matches_played |
| `updated_at` | TEXT | Yes | ISO-8601 UTC |

## Team identity

A team is not stored on a match: `matches.event_team_a` / `event_team_b` hold the
raw name the feed used that week, and every team view is derived from those
strings. A rename — or an acquisition that rebrands a roster — therefore used to
arrive as a separate team with its own partial record.

Two tables fix that without touching a single match row: `teams` is the identity,
and `team_names` maps every spelling the feed has used onto it. Read paths resolve
a requested name to all of its spellings (`app/team_identity.py`), so the record,
roster and weeks stay continuous across a rename. The seed is
[`data/team_identities.json`](../data/team_identities.json) (override with
`TEAM_IDENTITIES_PATH`); it is applied at web-app startup by
`sync_team_identities()`. For the step-by-step workflow — renames, acquisitions,
and a team going independent — see the
[team identity runbook](TEAM_IDENTITY.md).

```json
{
  "teams": [
    {
      "name": "Current Name",
      "slug": "currentname",
      "logo_key": "currentname",
      "names": [
        { "name": "OLD NAME", "valid_to_week": 11, "logo_key": "oldname" },
        { "name": "Current Name", "valid_from_week": 12 }
      ]
    }
  ]
}
```

- `name` is the current (canonical) name and always resolves, even when `names`
  only lists older spellings.
- `slug` and the per-spelling `logo_key` are optional; both default to the
  name reduced to its alphanumerics (`"Melee Creeps"` -> `meleecreeps`), which is
  also how the crest file is named.
- `valid_from_week` / `valid_to_week` record which event weeks the spelling was
  in effect. They are informational for now: every spelling still counts towards
  the team's record, and each match keeps the name it was played under.
- Two teams cannot claim the same name (case-insensitive) or the same slug, and
  `valid_from_week` may not be after `valid_to_week`; the file is rejected before
  anything is written, and the app keeps the identities already in the DB.

### Table: `teams`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `team_id` | INTEGER | No | Primary key (autoincrement) |
| `slug` | TEXT | No | Unique, URL-safe identity (`/team/<slug>`) |
| `display_name` | TEXT | No | Current name |
| `logo_key` | TEXT | Yes | Default crest stem for the team |
| `created_at` | TEXT | Yes | ISO-8601 UTC |
| `updated_at` | TEXT | Yes | ISO-8601 UTC |

### Table: `team_names`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `name_key` | TEXT | No | Primary key: `LOWER(name)`, the key team queries group on |
| `team_id` | INTEGER | No | FK -> `teams.team_id` (ON DELETE CASCADE) |
| `display_name` | TEXT | No | Name as the feed wrote it |
| `valid_from_week` | INTEGER | Yes | First event week the spelling was used |
| `valid_to_week` | INTEGER | Yes | Last event week the spelling was used; null = open-ended |
| `logo_key` | TEXT | Yes | Crest stem for this spelling (historical badge) |
| `source` | TEXT | No | `seed` (owned by the JSON file) or `admin` (owned by the site) |
| `note` | TEXT | Yes | Free text, e.g. why a name changed |
| `created_at` | TEXT | Yes | ISO-8601 UTC |

Primary Key:
- `name_key`

Indexes:
- `idx_team_names_team` ON `team_names(team_id)`

Re-syncing is idempotent: rows are only written when something actually changed,
rows missing from the file are deleted when `source` is `seed`, and an `admin` row
is never moved or removed by the file.
