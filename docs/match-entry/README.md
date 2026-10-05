# Match entry and brackets: handoff

Status (2026-10-05): **parked as a future plan.** Nothing here is merged; draft PR #3 holds the dev build.

## Files in this folder

| File | What it is |
|---|---|
| `mockup.html` | Lo-fi clickable mockup. Open it in a browser (or VS Code's Live Preview / Live Server). Tabs: create event, enter match IDs per format, fix a typo, weekly paste box. Gauntlet has a Qualifiers toggle; the series editor has a "Disqualify a team" option. |
| `data-shape.md` | Proposed data model: event → stages (format) → series (`R1M1`, `winner_to`/`loser_to`) → games (match IDs). Scales to 64-team single elim (6 rounds, 63 series). |
| `options.md` | Research: how other esports sites auto-fetch matches, and the options for Night Shift (smarter form, "find matches" via deadlock-api, lobby bot, Discord `/report`). |

## Dev build (draft PR #3, branch `claude/project-thread-kto8n1`)

- Page: `/admin/brackets/` → `frontend/src/pages/BracketAdmin.jsx` (entry `frontend/src/entries/bracket_admin.entry.jsx`)
- API: `backend/app/blueprints/brackets.py` (stores `data/brackets.json`, saves series through MatchAdmin's bulk-submit job)
- Logic: `backend/app/utils/brackets.py` (generators + `compute()`), tests in `backend/tests/test_brackets.py`
- Formats built: Gauntlet (+ Qualifiers), single elimination with byes. Not built: double elim, round robin, swiss.
- Also fixes `db_init` missing `self_healing`/`teammate_healing` columns on a fresh DB.

Run locally:

```bash
git fetch origin
git checkout claude/project-thread-kto8n1
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
python run_debug.py   # http://localhost:5050/admin/brackets/
```

Saving a series writes to your local `data/dlns.sqlite3` and `data/matches.json`. Back both up first and don't commit test changes to `matches.json`.

## Decisions and feedback to carry forward

- **Winner is picked by hand.** Jev enters the winner from the results; checking which team was Hidden King / Archmother takes too long. The dev build currently does the opposite (works out sides from known players and asks for a side when it can't tell). When this resumes, each game gets a plain "who won" pick; side detection may only pre-fill it, never be required.
- Disqualification after a game: `outcome: { type: "dq", team, after_game, reason, played_games: "keep" | "void" }` on the series, overriding the score.
- Replacing a wrong match ID must refetch stats. Today's `PATCH /admin/match/edit` renames the row and keeps the old match's stats (`backend/app/blueprints/admin.py`, the `UPDATE matches SET match_id = ?` block).
- Unverified: week 57 has match ID `1073892640` (10 digits), probably a typo for `107389264`.
- Unverified: whether private lobby matches are searchable in deadlock-api bulk metadata / player match history. Needed before a "find matches" button.

## Prompt to start in Claude Code (VS Code)

> Read `docs/match-entry/README.md`, `docs/match-entry/data-shape.md` and open `docs/match-entry/mockup.html`. We're resuming the bracket match entry work on branch `claude/project-thread-kto8n1` (draft PR #3). First change: replace the side-detection flow in `BracketAdmin.jsx` and `brackets.py` with a per-game "who won" pick (team A / team B), keeping side detection only as a pre-fill. Run `python -m unittest backend.tests.test_brackets` and `cd frontend && npx vitest run` before committing.
