# Database Schema (SQLite)

This project uses a single SQLite database. The schema is created by the `SCHEMA_SQL` block in `main.py`.

## Overview

Tables:
- `users` stores Steam users and names.
- `matches` stores match-level metadata.
- `players` stores per-player stats for each match.
- `player_deaths` stores a midpoint-distance value for every player death.
- `user_stats` stores per-user aggregates derived from `players`.

Relationships:
- `players.match_id` -> `matches.match_id` (ON DELETE CASCADE)
- `players.account_id` -> `users.account_id` (ON DELETE SET NULL)
- `player_deaths.match_id` -> `matches.match_id` (ON DELETE CASCADE)
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
| `created_at` | TEXT | Yes | ISO-8601 UTC (scrape time) |

Notes:
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
| `lane` | INTEGER | Yes | Game-reported lane assignment (`assigned_lane`). DLNS 3-lane callouts: 1=York (Yellow), 4=Greenwich (Green), 6=Broadway (Blue). NULL when unavailable (frontend shows "—"). |
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

Stores one row for each player death in a match. Deaths are detected from increases in
the player stats snapshots. `midpoint_distance` is the death-time `y_pos` map coordinate,
where the map midpoint is zero; it is NULL when the source has no timestamped position.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `match_id` | INTEGER | No | FK -> `matches.match_id` |
| `account_id` | INTEGER | No | Player account ID |
| `death_index` | INTEGER | No | One-based death number for this player in this match |
| `death_time_s` | INTEGER | Yes | Timestamp of the first stats snapshot that reports the death |
| `midpoint_distance` | REAL | Yes | Signed distance from the map midpoint |

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

Sources are filtered to damage stat_type (0) and hero targets (slots 1-12, excluding the slot-0 non-hero aggregate). Labels are resolved in the frontend: hero abilities via `data/hero_meta.json` image keys, items via the `/db/items/names` catalog (class_name -> display name), plus Weapon/Melee pattern matching.

Primary Key:
- (`match_id`, `account_id`, `source`)

Indexes:
- `idx_dmgsrc_match` ON `player_damage_sources(match_id)`

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
