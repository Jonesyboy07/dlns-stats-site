# DB API Schema

The `db_api` Flask blueprint exposes the site's JSON API, primarily under `/db`.
Most endpoints are read/query endpoints; `/db/help-config` also accepts `POST`
and `PUT` requests to update help-page configuration.

Base path:
- `/db`

Notes:
- Responses are JSON.
- Most read endpoints are cached server-side; cache durations vary by endpoint.
- The API reads from the SQLite database at `data/dlns.sqlite3` unless `DB_PATH` overrides it.
- `/api/docs` serves the interactive API reference; `/api/openapi.json` serves the tracked OpenAPI document.

## Overview

Main route groups:
- `weeks` for event/week mapping loaded from `matches.json`
- `stats` for global and event-level aggregates
- `matches` for recent match lists and per-match detail
- `users` for user info, aggregates, and match history
- `search` for typeahead suggestions
- `heroes` for hero dictionaries and hero-specific aggregates
- `players` for a global player list
- `nightshift` for the Night Shift week index and per-week detail

## Route: `/db/nightshift/index`

Returns the week index behind the Night Shift page sidebar: one entry per event
week, oldest first, each carrying that week's per-region series summaries.

Query parameters:
- `event_title`: optional event filter, defaults to `Night Shift`

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `event_title` | string | Resolved event title |
| `available_event_titles` | array of strings | Every event with weeks in the database |
| `weeks` | array of objects | One entry per week, ascending |

`weeks[]`:

| Key | Type | Notes |
| --- | --- | --- |
| `week` | integer | Event week |
| `date` | string or null | Earliest `start_time` in the week (ISO-8601) |
| `regions` | object | Region (`NA`/`EU`) -> `{ series: [...] }` |

`regions[region].series[]` entries carry `round` (the raw stage title, e.g.
`FINALS`), `team_a`, `team_b`, `score_a`, `score_b` and `start_time`. Series
whose hand-authored `event_region` is blank are inferred from a team that has a
known region in the same week, and fall back to an `Other` bucket when no shared
team exists.

## Route: `/db/nightshift/<week>`

Returns every match in one event week together with summary stats and VOD links.

Query parameters:
- `event_title`: optional event filter, defaults to `Night Shift`

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `week` | integer | Event week |
| `event_title` | string | Resolved event title |
| `stats` | object | `total_matches`, `amber_wins`, `sapphire_wins`, `avg_duration_s`, `first_match_time` |
| `matches` | array of objects | Matches ordered by start time, each with its `players` |
| `all_weeks` | array of integers | Every week number recorded for the event |
| `vod_link`, `vod_links`, `series_vods`, `game_vods` | mixed | VOD links from `matches.json` |

Each `matches[]` entry includes the event context columns `event_region`
(`NA`/`EU`), `event_subtitle` (the stage title, e.g. `FINALS`) and `match_vod`,
which the week page uses to build the brackets, leaderboard and picks panels.

`patch_notes` holds the Deadlock patch notes posted while the week's games were
being played, so the page can link out to Steam instead of showing build numbers.
A note in the long gap between two nights is included with `during_games` false:

| Key | Type | Notes |
| --- | --- | --- |
| `gid` | string | Steam announcement id |
| `title` | string | e.g. `Minor Update - 10-05-2026` |
| `ts` | integer | Post time, Unix seconds |
| `published_at` | string | Post time, ISO 8601 |
| `url` | string or null | Steam store news URL; null if it could not be resolved |
| `during_games` | boolean | True when posted during a sitting (or its intermission) |

`players[]` entries carry `team`, `hero_id`, `hero_name`, `kills`, `deaths`,
`assists`, `net_worth`, `player_damage`, `player_healing`, `account_id`,
`persona_name` and `avatar_url`.

## Route: `/db/weeks`

Returns match-to-week mapping plus event metadata extracted from `matches.json`.

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `weeks` | object | Map of `match_id` string -> week number |
| `details` | object | Map of `match_id` string -> event details |
| `title` | string | Root title from `matches.json` |

`details[match_id]` contains:

| Key | Type | Notes |
| --- | --- | --- |
| `series` | string | Series or event title |
| `week` | integer or null | Week number |
| `team_a` | string or null | Event team A |
| `team_b` | string or null | Event team B |
| `game` | string or null | Game label such as `Game 1` |
| `series_title` | string | Stage label from `matches.json`, e.g. `FINALS`. Often empty |
| `match_vod` | string | VOD URL for the game, empty when none is recorded |

Fallback behavior:
- If `matches.json` is missing or unreadable, returns `{ "weeks": {}, "title": "" }`.

## Route: `/db/stats/overview`

Returns aggregate match totals.

Query parameters:
- `event_title`: optional event filter

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `overview` | object | Aggregate totals |

`overview` fields:

| Field | Type |
| --- | --- |
| `total_matches` | integer |
| `amber_wins` | integer |
| `sapphire_wins` | integer |
| `avg_duration` | number or null |
| `max_duration` | integer or null |
| `min_duration` | integer or null |

## Route: `/db/stats/weekly`

Returns per-week aggregates for an event.

Query parameters:
- `event_title`: optional, defaults to `Night Shift`

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `weeks` | array | One row per `event_week` |

Each week row contains:

| Field | Type |
| --- | --- |
| `event_week` | integer |
| `total_matches` | integer |
| `amber_wins` | integer |
| `sapphire_wins` | integer |
| `avg_duration_min` | number |
| `amber_win_pct` | number |

## Route: `/db/stats/records`

Returns top single-game performances across several stats.

Query parameters:
- `event_title`: optional event filter

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `records` | object | Groups top 5 results by stat |

Possible `records` keys:
- `kills`
- `assists`
- `deaths`
- `obj_damage`
- `healing`
- `souls`

Each record entry contains:

| Field | Type |
| --- | --- |
| `value` | integer or number |
| `persona_name` | string or null |
| `account_id` | integer or null |
| `hero_id` | integer or null |
| `match_id` | integer |
| `duration_s` | integer or null |
| `event_week` | integer or null |

## Route: `/db/stats/averages`

Returns top players by average stat per game with a minimum of 5 games.

Query parameters:
- `event_title`: optional event filter

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `averages` | object | Groups top 5 players by average stat |

Possible `averages` keys:
- `kills`
- `assists`
- `deaths`
- `obj_damage`
- `healing`
- `souls`

Each average entry contains:

| Field | Type |
| --- | --- |
| `value` | number |
| `persona_name` | string or null |
| `account_id` | integer or null |
| `games_played` | integer |
| `top_hero_id` | integer or null |

## Route: `/db/matches/latest`

Returns the newest matches ordered by `created_at` descending.

Response:

| Key | Type |
| --- | --- |
| `matches` | array |

Each match contains:

| Field | Type |
| --- | --- |
| `match_id` | integer |
| `duration_s` | integer or null |
| `winning_team` | integer or null |
| `match_outcome` | integer or null |
| `game_mode` | integer or null |
| `match_mode` | integer or null |
| `event_title` | string or null |
| `event_week` | integer or null |
| `event_team_a` | string or null |
| `event_team_b` | string or null |
| `event_game` | string or null |
| `event_team_a_ingame_side` | integer or null |
| `start_time` | string or null |
| `game_version` | integer or null |
| `created_at` | string or null |

Notes:
- Limit is controlled by `API_LATEST_LIMIT` and defaults to `50` in this route implementation.

## Route: `/db/matches/latest/paged`

Returns a paginated recent-match list with optional filters and embedded player summaries.

Query parameters:
- `page`: optional, minimum `1`, defaults to `1`
- `per_page`: optional, clamped to `1..20`, defaults to `20`
- `order`: optional `asc` or `desc`, defaults to `desc`
- `team`: optional winning team filter, `0` or `1`
- `game_mode`: optional exact game mode filter
- `match_mode`: optional exact match mode filter
- `hero`: optional case-insensitive hero-name substring filter
- `player`: optional persona-name substring filter
- `include_players`: optional; `0`, `false` or `no` omits the embedded `players`
  array (roughly 60% of the payload). Any other value, or omitting it, includes it

Response:

| Key | Type |
| --- | --- |
| `matches` | array |
| `page` | integer |
| `per_page` | integer |
| `total` | integer |
| `total_pages` | integer |

Each match contains the fields from `/db/matches/latest` plus:

| Field | Type | Notes |
| --- | --- | --- |
| `players` | array | Team/player summary rows; omitted when `include_players` is off |

Each embedded player row contains:

| Field | Type |
| --- | --- |
| `match_id` | integer |
| `team` | integer or null |
| `hero_id` | integer or null |
| `persona_name` | string or null |
| `account_id` | integer or null |
| `hero_name` | string, optional |

Special case:
- If `hero` does not match any hero names, the route returns an empty paginated result set.

## Route: `/db/matches/<match_id>/version`

Returns the Deadlock game version (build number) for a match. If the DB value is not yet backfilled it is resolved from `start_time` via the local timestamp cache. Returns `404` with `{"error": "match_not_found"}` for unknown matches.

Response:

| Field | Type |
| --- | --- |
| `match_id` | integer |
| `game_version` | integer or null |
| `start_time` | string or null |

## Route: `/db/matches/<match_id>/adjacent`

Returns lightweight context for a match and its neighbors by creation time.

Path parameters:
- `match_id`: integer match ID

Response:

| Field | Type |
| --- | --- |
| `start_time` | string or null |
| `winning_team` | integer or null |
| `event_title` | string or null |
| `event_week` | integer or null |
| `event_team_a` | string or null |
| `event_team_b` | string or null |
| `event_game` | string or null |
| `event_team_a_ingame_side` | integer or null |
| `game_version` | integer or null |
| `previous_match_id` | integer or null |
| `next_match_id` | integer or null |

## Route: `/db/matches/<match_id>/players`

Returns all player rows for a match.

Path parameters:
- `match_id`: integer match ID

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `players` | array | Raw `players` table rows plus `persona_name` |

Returned fields include all columns from the `players` table and:

| Extra Field | Type |
| --- | --- |
| `persona_name` | string or null |


## Route: `/db/matches/<match_id>/deaths`

Returns the recorded death locations for one match, with player metadata for map
filtering and display.

Path parameters:
- `match_id`: integer match ID

Query parameters:
- `team`: optional team filter, `0` or `1`
- `account_id`: optional player account ID; can be combined with `team`

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `match_id` | integer | Requested match ID |
| `count` | integer | Number of returned death events |
| `filters` | object | The normalized `team` and `account_id` filter values, or null |
| `deaths` | array | Death events ordered by time, then player and death index |

Each death event contains the `player_deaths` fields from `docs/db_schema.md`
plus `player_slot`, `team`, `hero_id`, and `persona_name`. Position and time
fields can be null when the source match data did not include them. Invalid
filter values return `400` with `invalid_team` or `invalid_account_id`.

## Route: `/db/matches/<match_id>/items`

Returns enriched purchased-item data for each player in a match.

Path parameters:
- `match_id`: integer match ID

Response:
- Object keyed by `account_id` as a string
- Each value is an array of up to 12 unique enriched item objects

Each item object contains:

| Field | Type |
| --- | --- |
| `name` | string |
| `item_slot_type` | string |
| `item_tier` | integer or null |

Notes:
- Data is resolved against `https://api.deadlock-api.com/v1/assets/items`
  (see `backend/constants.py`).
- If the external item catalog is unavailable, the route returns `{}`.

## Route: `/db/matches/<match_id>/users/<account_id>`

Returns a single player row for one user in one match.

Path parameters:
- `match_id`: integer match ID
- `account_id`: integer account ID

Success response:

| Key | Type |
| --- | --- |
| `player` | object |

The `player` object contains all `players` table columns, `persona_name`, and:

| Extra Field | Type |
| --- | --- |
| `hero_name` | string, optional |

Error response:
- `404`: `{ "error": "not_found" }`

## Route: `/db/users/<account_id>`

Returns basic user metadata.

Path parameters:
- `account_id`: integer account ID

Success response:

| Key | Type |
| --- | --- |
| `user` | object |

`user` fields:

| Field | Type |
| --- | --- |
| `account_id` | integer |
| `persona_name` | string or null |
| `updated_at` | string or null |

Error response:
- `404`: `{ "error": "not_found" }`

## Route: `/db/users/<account_id>/stats`

Returns aggregated `user_stats` data for one user.

Path parameters:
- `account_id`: integer account ID

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `stats` | object or null | Raw row from `user_stats` |

When present, `stats` contains all fields documented in `docs/db_schema.md` for the `user_stats` table.

## Route: `/db/users/<account_id>/matches`

Returns full match history for one user.

Path parameters:
- `account_id`: integer account ID

Response:

| Key | Type |
| --- | --- |
| `matches` | array |

Each row contains:

| Field | Type |
| --- | --- |
| `match_id` | integer |
| `team` | integer or null |
| `result` | string or null |
| `hero_id` | integer or null |
| `kills` | integer or null |
| `deaths` | integer or null |
| `assists` | integer or null |
| `last_hits` | integer or null |
| `denies` | integer or null |
| `creep_kills` | integer or null |
| `shots_hit` | integer or null |
| `shots_missed` | integer or null |
| `player_damage` | integer or null |
| `obj_damage` | integer or null |
| `player_healing` | integer or null |
| `pings_count` | integer or null |
| `duration_s` | integer or null |
| `winning_team` | integer or null |
| `game_mode` | integer or null |
| `match_mode` | integer or null |
| `start_time` | string or null |
| `created_at` | string or null |
| `hero_name` | string, optional |

## Route: `/db/users/<account_id>/matches/paged`

Returns paginated match history for one user.

Path parameters:
- `account_id`: integer account ID

Query parameters:
- `order`: optional `asc` or `desc`, defaults to `desc`
- `res`: optional result filter, `win` or `loss`
- `team`: optional team filter, `0` or `1`
- `page`: optional, minimum `1`, defaults to `1`
- `per_page`: optional, clamped to `1..20`, defaults to `20`

Response:

| Key | Type |
| --- | --- |
| `matches` | array |
| `page` | integer |
| `per_page` | integer |
| `total` | integer |
| `total_pages` | integer |

Each match row contains:

| Field | Type |
| --- | --- |
| `match_id` | integer |
| `team` | integer or null |
| `result` | string or null |
| `hero_id` | integer or null |
| `kills` | integer or null |
| `deaths` | integer or null |
| `assists` | integer or null |
| `creep_kills` | integer or null |
| `last_hits` | integer or null |
| `denies` | integer or null |
| `shots_hit` | integer or null |
| `shots_missed` | integer or null |
| `player_damage` | integer or null |
| `obj_damage` | integer or null |
| `player_healing` | integer or null |
| `pings_count` | integer or null |
| `duration_s` | integer or null |
| `winning_team` | integer or null |
| `start_time` | string or null |
| `created_at` | string or null |
| `hero_name` | string, optional |

## Route: `/db/search/suggest`

Returns typeahead suggestions for players, teams, heroes and match IDs.

Query parameters:
- `q`: required search text

Response:

| Key | Type |
| --- | --- |
| `results` | array |

Each result contains:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | `match`, `user`, `team` or `hero` |
| `text` | string | Display text |
| `url` | string | Site URL path such as `/matches/123` |
| `meta` | integer, optional | Match count, present on `team` results |

Behavior:
- Numeric queries search recent match IDs by prefix.
- Non-numeric queries return users by prefix (max 10), then teams by prefix
  (max 5, most matches first), then heroes by substring (max 5, alphabetical).
- Empty `q` returns `{ "results": [] }`.

## Route: `/db/stream/status`

Returns the Twitch live/offline state used by the header strip and the home page
stream widget. Cached for 60 seconds.

Configuration:
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`: app credentials (client-credentials flow)
- `TWITCH_CHANNEL`: channel login, defaults to `deadlocknightshift`

Response:

| Key | Type | Notes |
| --- | --- | --- |
| `configured` | boolean | `false` when credentials are missing; the rest are then defaults |
| `channel` | string | Login name that was checked |
| `channel_url` | string | Link to open the channel |
| `live` | boolean | Whether a stream is currently up |
| `title` | string or null | Stream title, set while live |
| `game_name` | string or null | Streamed category, set while live |
| `viewer_count` | integer or null | Set while live |
| `started_at` | string or null | Set while live |
| `display_name` | string or null | Channel display name, when resolvable |
| `avatar_url` | string or null | Channel avatar, when resolvable |
| `next_stream` | object or null | `{ start_time, title, category }` from the channel schedule |
| `checked_at` | integer | Unix timestamp of the check |
| `error` | string, optional | `auth`, `network` or `streams:<status>` when a lookup failed |

Behavior:
- With no credentials the route returns immediately with `configured: false`.
- While a stream is live the identity and schedule lookups are skipped.
- `next_stream` is absent when the channel publishes no schedule.

## Route: `/db/heroes`

Returns the hero dictionary used by the frontend.

Response:
- A flat object mapping `hero_id` string -> hero name

## Route: `/db/heroes/<hero_id>/stats`

Returns aggregate performance metrics for a hero.

Path parameters:
- `hero_id`: integer hero ID

Response:

| Key | Type |
| --- | --- |
| `stats` | object or null |

`stats` fields:

| Field | Type |
| --- | --- |
| `games_played` | integer |
| `wins` | integer |
| `avg_kills` | number |
| `avg_deaths` | number |
| `avg_assists` | number |
| `avg_kda` | number |
| `avg_damage` | number |
| `avg_obj_damage` | number |
| `avg_healing` | number |
| `avg_souls` | number |
| `max_kills` | integer or null |
| `max_damage` | integer or null |
| `max_healing` | integer or null |
| `max_obj_damage` | integer or null |
| `pick_rate` | number |
| `win_rate` | number |

## Route: `/db/heroes/<hero_id>/top_items`

Returns the most common purchased items for a hero.

Path parameters:
- `hero_id`: integer hero ID

Response:

| Key | Type |
| --- | --- |
| `items` | array |
| `total_games` | integer |

Each item contains:

| Field | Type |
| --- | --- |
| `id` | integer |
| `name` | string |
| `item_slot_type` | string |
| `item_tier` | integer or null |
| `count` | integer |
| `pick_rate` | number |

Notes:
- Non-shop items and ability entries are excluded.
- If the external item catalog is unavailable, returns `{ "items": [] }`.

## Route: `/db/heroes/<hero_id>/matchups`

Returns strongest same-team and opposing-team matchup summaries for a hero.

Path parameters:
- `hero_id`: integer hero ID

Response:

| Key | Type |
| --- | --- |
| `effective_with` | array |
| `effective_against` | array |

Each matchup row contains:

| Field | Type |
| --- | --- |
| `hero_id` | integer |
| `games` | integer |
| `wins` | integer |
| `win_rate` | number |

Notes:
- Only heroes with at least 3 shared games are included.

## Route: `/db/heroes/<hero_id>/top_players`

Returns players with the most games on a hero.

Path parameters:
- `hero_id`: integer hero ID

Response:

| Key | Type |
| --- | --- |
| `players` | array |

Each row contains:

| Field | Type |
| --- | --- |
| `account_id` | integer or null |
| `persona_name` | string or null |
| `games_played` | integer |
| `wins` | integer |
| `win_rate` | number |

## Route: `/db/heroes/<hero_id>/meta`

Returns curated hero metadata from `data/hero_meta.json`.

Path parameters:
- `hero_id`: integer hero ID

Success response:
- Returns the raw JSON object stored for that hero in `data/hero_meta.json`

Error responses:
- `404`: `{ "error": "not found" }`
- `503`: `{ "error": "meta data unavailable" }`

## Route: `/db/players`

Returns a global player list ranked by match count.

Response:

| Key | Type |
| --- | --- |
| `players` | array |

Each row contains:

| Field | Type |
| --- | --- |
| `account_id` | integer |
| `persona_name` | string or null |
| `match_count` | integer |

Notes:
- Limited to the top 500 players.