# Bracket data shape (sketch)

Written 2026-10-01. A proposal only; nothing in the repo uses it yet.

## Idea

The model is close to what Liquipedia, start.gg and Challonge use: **event → stages → series → games**.

- A **stage** has a `format`. The format is the only thing that knows how series link together.
- A **series** is one Team A vs Team B set. It has a slot id, a round, and links saying where its winner (and loser) go next.
- A **game** is one Deadlock match ID. This is what you already enter today.

Formats only differ in how the empty series and their links get created. Storing, submitting and stats stay the same for all of them.

## Shape

```jsonc
{
  "events": [
    {
      "id": "ns-week-58",
      "title": "Night Shift",
      "week": 58,
      "region": "EU",                 // or per series, as today
      "stages": [
        {
          "id": "main",
          "name": "Main",
          "format": "gauntlet",        // gauntlet | single_elim | double_elim | round_robin | swiss
          "best_of": 1,                // default, a series can override
          "rounds": [                  // column headers
            { "round": 1, "name": "Challenger" },
            { "round": 2, "name": "Finals", "best_of": 3 }
          ],
          "series": [
            {
              "id": "R1M1",
              "round": 1,
              "team_a": "Buff Enjoyers",
              "team_b": "Abrahams",
              "winner_to": { "series": "R2M1", "slot": "team_b" },
              "loser_to": null,
              "games": [
                { "game": 1, "match_id": 107347490, "team_a_side": 0 }
              ],
              "vod": "https://..."
            },
            {
              "id": "R2M1",
              "round": 2,
              "team_a": "Leviathan",   // defending champion, seeded straight into Finals
              "team_b": null,          // filled from the R1M1 winner
              "winner_to": null,
              "games": [
                { "game": 1, "match_id": 107356285, "team_a_side": 0 },
                { "game": 2, "match_id": 107363657, "team_a_side": 1 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

What is **not** stored: series scores, winners, standings and who advanced. All of these come from game results, which the API already gives us. Only the structure and match IDs are typed in.

## Does it scale to 64 teams?

Yes. One correction first: 64-team single elimination is **6 rounds**, not 32. Round 1 has 32 series, then 16, 8, 4, 2 and 1, for 63 series in total. Double elimination is about 126 series.

- **Entering it:** you never build that by hand. You pick "single elim, 64 teams", the site generates all 63 empty series with their `winner_to` links, and you paste the seeded team list. After that you only add match IDs to a series as it's played, and winners fill the next slot themselves.
- **Size:** 63 series with 1 to 3 games each is a few hundred lines of JSON. It's tiny for the file and the database.
- **Display:** a 6-column bracket needs horizontal scroll on phones. Liquipedia has the same problem; a per-round list view is the usual fallback.

The Night Shift Open data shows why this matters. Today its 50 games are stored with the round squeezed into a label (`"Qualifier R1 · match-3"`) and no teams. With this shape, each would be a series in round 1 with its two teams.

## Do other formats make it harder?

Not much, because each format is just a different generator for the same series list:

| Format | Links | What the site generates | What's computed |
|---|---|---|---|
| Gauntlet (today's Challenger → Finals) | `winner_to` | 2 series | Champion |
| Single elim | `winner_to` | All series upfront | Who advances |
| Double elim | `winner_to` + `loser_to` | Upper and lower brackets, grand final | Who advances or drops |
| Round robin / groups | none | Every pairing in the group | Standings table |
| Swiss | none | Next round's pairings, from standings | Standings, round by round |

The two genuinely extra pieces are:

- a **standings view** (a table instead of a bracket) for round robin and swiss, with a tiebreak rule
- **multi-stage events**, such as groups then playoffs. This is just two stages, with seeding from the first stage's standings into the second.

Things to decide later, not now: bracket resets in double-elim grand finals, byes when team counts aren't a power of 2 (`team_b: "BYE"` auto-advances), and forfeits (already supported per game today).

## Migration from today's `matches.json`

Every existing week maps to a `gauntlet` stage. Sets titled Challenger become round 1 and sets titled Finals become round 2, split by region. Titles today are inconsistent (`Challenger Match`, `CHALLENGER MATCH`, `challenger match`, `EU - FINALS`, …), so a one-off script would normalise them and flag the 88 untitled sets for review. Stats pages keep reading games the same way, so nothing else has to move at once.
