# Match entry and brackets: handoff

Status (2026-10-05): **in progress on branch `matchsubmit`.** The dev build from draft PR #3 (fork branch `claude/project-thread-kto8n1`) was cherry-picked here.

## Files in this folder

| File | What it is |
|---|---|
| `mockup.html` | Lo-fi clickable mockup. Open it in a browser (or VS Code's Live Preview / Live Server). Tabs: create event, enter match IDs per format, fix a typo, weekly paste box. Gauntlet has a Qualifiers toggle; the series editor has a "Disqualify a team" option. |
| `data-shape.md` | Proposed data model: event → stages (format) → series (`R1M1`, `winner_to`/`loser_to`) → games (match IDs). Scales to 64-team single elim (6 rounds, 63 series). |
| `options.md` | Research: how other esports sites auto-fetch matches, and the options for Night Shift (smarter form, "find matches" via deadlock-api, lobby bot, Discord `/report`). |

## Dev build (branch `matchsubmit`)

- Page: `/admin/brackets/` → `frontend/src/pages/BracketAdmin.jsx` (entry `frontend/src/entries/bracket_admin.entry.jsx`)
- API: `backend/app/blueprints/brackets.py` (stores `data/brackets.json`, saves series through MatchAdmin's bulk-submit job)
- Logic: `backend/app/utils/brackets.py` (generators + `compute()`), tests in `backend/tests/test_brackets.py`
- Formats built: Gauntlet (+ Qualifiers), single elimination with byes. Not built: double elim, round robin, swiss.
- **Edit event** (editor page): title, week, region, round names/best-of and seeded teams. Saving re-imports every series with games; a changed title/week moves the games in matches.json. Gauntlets can gain an opening round (e.g. Qualifiers) or drop an unplayed one. Any edit or series save marks the event as editor-made, so re-running the migration no longer replaces it.
- Also fixes `db_init` missing `self_healing`/`teammate_healing` columns on a fresh DB.

Run locally:

```bash
git checkout matchsubmit
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
python run_debug.py --sandbox   # http://localhost:5050/admin/brackets/
```

`--sandbox` points the app at `data/sandbox/` (git-ignored), seeded on first run with copies of `data/dlns.sqlite3`, `matches.json`, `brackets.json` and the user/avatar caches. Saving a series there never touches the real files. `--sandbox --reset` starts again from a fresh copy. Without `--sandbox`, saves write to the real `data/dlns.sqlite3` and `data/matches.json`.

## What a wrong week does, and the guards against it

An event's week (and title, region, round names) is copied onto every match row when a series is saved, so stats pages and the week tree read them from there. A series saved with the wrong week therefore *relabels* games that were already in stats — there is no undo, only the backups below.

Two guards run before anything is written:

- **Backups.** Every save of `brackets.json` first copies the file it is replacing to `brackets.json.bak-<utc stamp>`. The last 10 are kept. A bad save is then a file restore, not a reconstruction. (`scripts/migrate_brackets.py` writes its own `brackets.json.bak-<time>` too.)
- **Week check.** Saving a series (or changing an event's week) compares the nights the games would be filed under with the games already on that week. If the two date windows are 3 or more days apart, the save is refused with a 409 and nothing is written; the editor shows the reason and a **Save anyway** button that resends with `confirm_week: true`. The rules that keep it quiet otherwise: only games that would actually change week are judged (a first-time id has no stored date, so its night is fetched from the API; a re-save of a series already on that week is a no-op and is not checked), an event's own games are never its own peers, and a week with no dated games has nothing to compare against. Creating an event for a week another event already uses only warns (it is not refused — an EU and an NA run share a week).

## Migrating existing weeks

`scripts/migrate_brackets.py` turns each week + region of `matches.json` into a gauntlet event in `brackets.json`. It only ever writes `brackets.json`: `matches.json` is read as-is and the DB is opened read-only. Without `--write` it writes nothing.

### Commands

| Step | Command |
|---|---|
| Start the site on the sandbox | `python run_debug.py --sandbox` then open http://localhost:5050/admin/brackets/view |
| Fresh sandbox copy of the real data | `python run_debug.py --sandbox --reset` |
| Dry run (sandbox, writes nothing) | `python scripts/migrate_brackets.py` |
| One week, every game | `python scripts/migrate_brackets.py --week 43` |
| Every week, every game | `python scripts/migrate_brackets.py --detail` |
| Write the sandbox `brackets.json` | `python scripts/migrate_brackets.py --write` |
| Dry run on the real data | `python scripts/migrate_brackets.py --target data` |
| Write the real `data/brackets.json` | `python scripts/migrate_brackets.py --target data --write` |

Every write backs up the previous file as `brackets.json.bak-<time>`. Re-running replaces earlier migrated events (`"source": "matches.json"`) and keeps events made in the editor.

### Fixing weeks by hand

Weeks the script can't order are listed under "Needs review". Fix them in `scripts/migrate_fixes.json` (it applies to both the sandbox and the real data, so a fix made once carries over):

- `region`: move a set to another region
- `dq`: disqualify a team in a set (the other team advances)
- `winner`: who won a game the DB has no result for
- `order`: the ladder order when the results fit more than one

Set `"disabled": true` to keep a fix without using it. Each run lists every fix as `applied`, `disabled` or `not matched`. Fixes only change how brackets are built; to correct stats (e.g. a set's region in `matches.json`), edit the match in MatchAdmin.

Rounds otherwise come from results, not file order: a set's winner must play in the next set, and untitled sets next to a Challenger are the Finals.

## Decisions and feedback to carry forward

- **Winner is picked by hand (done).** Jev enters the winner from the results; checking which team was Hidden King / Archmother takes too long. Each game (forfeit or not) has a required team A / team B "who won" pick, stored as `games[].winner`. The roster check on the match ID only pre-fills an empty pick. At ingest, MatchAdmin's job places team A's side from that pick plus the API's `winning_team`. Games saved before this change fall back to the result already in the DB.
- Disqualification after a game: `outcome: { type: "dq", team, after_game, reason, played_games: "keep" | "void" }` on the series, overriding the score.
- Replacing a wrong match ID must refetch stats. Today's `PATCH /admin/match/edit` renames the row and keeps the old match's stats (`backend/app/blueprints/admin.py`, the `UPDATE matches SET match_id = ?` block).
- Unverified: week 57 has match ID `1073892640` (10 digits), probably a typo for `107389264`.
- Unverified: whether private lobby matches are searchable in deadlock-api bulk metadata / player match history. Needed before a "find matches" button.
