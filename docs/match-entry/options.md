# Faster Night Shift match submission: how others do it, and options for DLNS

Written 2026-10-01. Research only, no code changed.

## How submission works today

MatchAdmin (`frontend/src/pages/MatchAdmin.jsx`, `backend/app/blueprints/admin.py`) asks for, per week:

- series title and week number
- per set: set title, team A, team B, region, VOD link
- per match: match ID, **winner** (required, `MatchAdmin.jsx:166`), game label

The backend then fetches each ID from `api.deadlock-api.com/v1/matches/{id}/metadata`, works out which in-game side team A was on from the winner you typed, and falls back to roster history (`_detect_team_a_side_from_history`, `admin.py:319`) only if the winner is missing. The frontend blocks that fallback because winner is mandatory.

Every value the API already knows (winner, start time, order of games) is still typed by hand. Only the pairing of "this match ID belongs to this set" is genuinely new information.

## How other games' stat sites get team matches automatically

There is no magic: something has to tag a match as "this is a tournament game between X and Y" at the moment it is played. Games do it in one of four ways.

1. **League / ticket IDs stamped on the lobby (Dota 2).** Organisers register a league with Valve. Lobbies created under that league carry its `leagueid`, and the game knows each team's registered team ID. Sites like OpenDota, Datdota and Liquipedia just ask "all matches for league N" (Steam Web API `GetMatchHistory?league_id=`, or OpenDota `/leagues/{id}/matches`). Teams and results come for free.
2. **Tournament codes with a callback (League of Legends, Valorant).** The organiser asks Riot's Tournament API for a code per game. Players join the lobby with that code, and when the game ends Riot POSTs the match ID and result to the organiser's callback URL. Pro leagues also buy official data feeds (GRID, Bayes).
3. **The platform runs the servers (CS2 via FACEIT/ESEA, start.gg-integrated games).** The tournament platform creates the server, so it already knows the teams, and it publishes match results via its own API or webhooks. HLTV-style sites read those, or scrape and parse demos.
4. **Humans report it (most community leagues, any game).** A Discord bot or form where a captain or admin types `/report <match id>` after each game. The site then fetches the stats by ID. This is what DLNS does today, just centralised on you.

Deadlock has no league IDs and no official tournament API, so options 1 and 3 don't exist. Option 2 has an unofficial equivalent through deadlock-api (below).

## What the Deadlock APIs can offer

From deadlock-api's docs (I couldn't call the API from this sandbox, the network blocks it, so none of this is tested against real Night Shift matches):

| Endpoint | What it gives | Limits |
|---|---|---|
| `GET /v1/matches/metadata` (bulk) | Filter by `account_ids`, min/max unix timestamp, `game_mode`, `match_ids` (up to 1000), order by start time | 5 req/s per IP |
| `GET /v1/players/{account_id}/match-history` | A player's matches with `match_id`, `start_time`, `match_mode`, `player_team`, `match_result` | 5 req/hour per IP without a key, 400/hour with one |
| `POST /v1/matches/custom/create` (+ `/{lobby_id}/ready`, `/start`, `GET /{party_id}/match-id`) | A deadlock-api bot creates a custom lobby, sits in the spectator slot, and returns the match ID when it starts, optionally by webhook to a `callback_url` | API key required; 100 req per 30 min; bot leaves after 15 min |

**Unknown that decides option B:** whether private/custom lobby matches show up in bulk metadata or match history at all. Night Shift matches fetch fine by ID, but that doesn't prove they are searchable. This needs one test from a machine that can reach the API, e.g. take a known NS player and a known NS night and check that the IDs come back.

## Options

### A. Smarter form (no new API, smallest change). Recommended first.

- Make **winner optional**. Read `winning_team` from the API and work out team A's side from roster history, which the backend already does. Only ask when the roster is unknown (new team, mostly subs).
- **Paste box**: one line per set, e.g. `EU FINALS ABRAHAMS vs LEVIATHAN 107356285 107363657`, parsed into the form.
- **Pre-fill** week (last + 1) and series title; autocomplete team names from existing ones.
- **Validate IDs as you type** with the existing preview endpoint, showing teams' players, start time and winner. This would catch typos; week 57 has `1073892640`, ten digits where every other ID is nine (`data/matches.json`), which looks like a typo for `107389264`. I inferred that and haven't checked it against the API.

Result: you'd enter team names and match IDs only.

### B. "Find matches" button (needs the unknown above to be yes)

You enter the week, the sets (team A vs team B), and a time window for the night. The backend takes each team's known roster from past matches, queries bulk metadata for those account IDs inside the window, and keeps matches where at least 3 or 4 players of each team are on opposite sides. It then fills in match IDs, game order by start time, team A's side and the winner. You review and press submit.

Even simpler: enter just the date and the list of teams, and the site proposes the sets itself.

### C. Lobby bot with webhook (closest to "fully automatic")

Like Riot's tournament codes. Before each game, an admin (or a Discord command) asks the site for a lobby; the site calls deadlock-api `custom/create` with a `callback_url` on dlns-stats, players join via the party code, and when the game starts deadlock-api POSTs the match ID to the site, already tagged with the set it belongs to. Caveats: needs an API key from deadlock-api, depends on their bot service being up on match night, the bot occupies the spectator slot (may clash with casters), and it changes how Night Shift hosts lobbies, so it's a decision for the Night Shift organisers, not just the site.

### D. Captain reporting via Discord

A Discord slash command `/report <match id>` for captains or casters, feeding a pending queue you approve in MatchAdmin. Spreads the typing out but doesn't remove it. Works alongside A.

## Suggested path

1. Do **A** now: it removes the winner field and typos with no external dependency.
2. Run the one API test above. If NS lobbies are searchable, build **B** on top of A.
3. Consider **C** only if the Night Shift organisers want to change how lobbies are created.

Sources: [deadlock-api docs](https://api.deadlock-api.com/docs), [deadlock-api-rust overview (DeepWiki)](https://deepwiki.com/deadlock-api/deadlock-api-rust), [Matches API](https://deepwiki.com/deadlock-api/deadlock-api-rust/3.2-matches-api), [Custom match creation](https://deepwiki.com/deadlock-api/deadlock-api-rust/3.2.4-custom-match-creation), [Bulk metadata](https://deepwiki.com/deadlock-api/deadlock-api-rust/3.2.2-bulk-metadata-queries), [Match history](https://deepwiki.com/deadlock-api/deadlock-api-rust/3.1.1-match-history-endpoint).
