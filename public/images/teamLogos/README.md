# Team crests

One image per team, served from the images CDN at
`https://cdn.dlns-stats.co.uk/public/images/teamLogos/` — this folder is the
source for it, so a crest added here ships with the site.

## Filename

The filename is the team's name run through the same rule the backend uses for
item and ability icons:

> lowercase → `&` becomes `and` → remove everything that is not `a-z` or `0-9`

| Team | File |
| --- | --- |
| `ABRAHAMS` | `abrahams.png` |
| `MELEE CREEPS` | `meleecreeps.png` |
| `ANJOKI'S GOONS` | `anjokisgoons.png` |
| `POPPERS' PUPILS` | `popperspupils.png` |
| `Virtus.pro` | `virtuspro.png` |
| `feelings=off feeding=on` | `feelingsofffeedingon.png` |
| `1win Team` | `1winteam.png` |

Because the rule strips case, spacing and punctuation, one file covers every
spelling the match feed has used — `ABRAHAMS`, `Abrahams` and `aBRAHAMS` all
resolve to `abrahams.png`, and both `SLICE N DICE` and `SLICE 'N DICE` to
`slicendice.png`. Nothing else needs configuring.

It does **not** cover word drift. A team that has been misspelt or reworded
(`BUFF ENJOYER` vs `BUFF ENJOYERS`) needs the feed corrected, or an entry in
`ALIASES` in `frontend/src/utils/teamLogos.js`.

Keep filenames **lowercase**. Windows and macOS are case-insensitive so a
mis-cased name works locally, but the CDN is not — `Abrahams.PNG` would 404
only in production.

## Fallback

`default.jpg` (note: `.jpg`, unlike the per-team files) is shown for any team
with no crest of its own. Leave it in place or those teams fall back to their
initials instead.

## Artwork

Square canvas with transparency, 512×512 is plenty — the largest render is 72px
on the team page (and 32px in the team list, 36px in a match header, 24px in a
series row). Keep the padding between crests **consistent**: they are drawn with
`object-contain`, so a logo cropped tight to its own artwork will sit visibly
larger than one with a margin around it.

Crests are shown on a dark card (`oklch(0.19 0.025 279.82)`), so a
white-on-transparent mark will disappear. Give it a dark outline or a filled
backing rather than a second file.
