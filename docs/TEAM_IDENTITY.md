# Team identity runbook

Teams are not rows in `matches`: every team view is derived from the raw
`event_team_a` / `event_team_b` the feed wrote that week. A rename — a rebrand, an
acquisition, or a team leaving an org — would therefore arrive as a second team
with its own partial record. [`data/team_identities.json`](../data/team_identities.json)
is where "these names are one team" is recorded, and
[`backend/app/team_identity.py`](../backend/app/team_identity.py) applies it.

The model decides one question: **is this the same team?** It does not model
organisations, so who *owns* a result is something you decide when you edit the
file. The table and column reference is in the
[database schema](db_schema.md#team-identity).

## Applying a change

1. Edit `data/team_identities.json` (override the path with `TEAM_IDENTITIES_PATH`).
2. Restart the web app — it syncs at startup and drops the cached team payloads.
   For an immediate change against a running DB:

   ```python
   from pathlib import Path
   from backend.main import db_connect
   from backend.app.team_identity import sync_team_identities

   conn = db_connect(Path("data/dlns.sqlite3"))
   try:
       sync_team_identities(conn)
   finally:
       conn.close()
   ```

3. Verify:

   ```bash
   curl -s localhost:5050/db/teams | jq '.teams[] | select(.slug == "cloud9")'
   curl -s "localhost:5050/db/team/Melee%20Creeps" | jq '{team_name, former_names, total_matches}'
   ```

   Expect one row for the team, the old name resolving with `resolved_from`, and
   `former_names` listing everything that is not current.

Re-syncing is idempotent and seed rows only: removing a team from the file splits
it back into the names the feed used. Entries already owned by the site
(`source` = `admin`) are never moved or deleted by the file.

## Rename (rebrand, acquisition)

Append the new spelling; the old one keeps the weeks it covered. History, record
and roster stay continuous.

```json
{ "name": "Cloud9", "slug": "cloud9",
  "names": [
    { "name": "Melee Creeps", "valid_to_week": 60, "logo_key": "meleecreeps" },
    { "name": "Cloud9", "valid_from_week": 61 }
  ] }
```

`logo_key` on a spelling keeps that era's crest (`meleecreeps.png`) available to
the lineage UI instead of repainting all of history with the new badge.

## Team goes independent again

Two outcomes, and the file records which one you mean.

### The team keeps its history (one lineage)

The franchise continues; the org name is just another spelling. Close the org
spelling at its last week and leave the returning name open-ended.

```json
{ "name": "Melee Creeps",
  "names": [
    { "name": "Melee Creeps", "logo_key": "meleecreeps" },
    { "name": "Cloud9", "valid_from_week": 61, "valid_to_week": 69 }
  ] }
```

This is deliberate: the team is one row with one record, `/team/Cloud9` and
`/team/Melee Creeps` both resolve, and `former_names` becomes `["Cloud9"]`.

### The org keeps its era (split)

If the Cloud9 results should stay with Cloud9 and the independent team starts
fresh, they are **two** teams — separate entries, and the independent team must
go forward under a name no other team claims:

```json
{ "teams": [
  { "name": "Cloud9", "names": [
      { "name": "Melee Creeps", "valid_to_week": 60, "logo_key": "meleecreeps" },
      { "name": "Cloud9", "valid_from_week": 61, "valid_to_week": 69 } ] },
  { "name": "Independent Name", "names": [
      { "name": "Independent Name", "valid_from_week": 70 } ] }
] }
```

Note the trade-off: a raw name belongs to exactly one team, so a split cannot
give the *same* spelling (e.g. "Melee Creeps") to both the old era and the new
one — that would retroactively pull weeks 1–60 into the new team. Supporting
that needs resolution per match rather than per name.

## Known limits

- **One range per spelling.** `team_names.name_key` is the primary key, so a name
  that comes back after a gap has a single `valid_from_week` / `valid_to_week`
  pair. The returning spelling is recorded open-ended and the gap is not shown in
  `name_history`; stats, URLs and `former_names` are unaffected. Allowing several
  periods per name is a contained schema change (key on `name_key` + period).
- **One team per name.** Weeks are metadata, not part of resolution
  (`LOWER(name) IN (…)`), so a name cannot mean two different teams in different
  weeks. Per-week resolution — or stamping `team_a_id` / `team_b_id` onto
  `matches` at ingest — is the upgrade if that is ever needed.
- **Ranges are informational.** They are validated for `from <= to` and for
  uniqueness of the name, but overlapping or stale ranges do not change any
  result until resolution becomes week-aware.
- **Other surfaces still key on the raw name.** Only the three team routes resolve
  aliases today. `sitemap.py` emits one URL per spelling (two URLs for one team
  once both are in the data), `/db/search/suggest` groups suggestions by spelling,
  and the player tenure timeline groups a player's matches by the name they were
  played under, so a rename shows as two stints even though `/db/team/<name>/weeks`
  resolves both to the same weeks. Bracket roster checks (`_known_roster`) still
  compare names directly. These are the UI/redirect follow-up.
