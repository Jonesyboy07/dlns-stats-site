# Match Timeline tab: design handoff

**For:** Claude Design
**From:** the DLNS stats site (Deadlock tournament stats; React + Tailwind, dark theme)
**Scope:** the **Timeline** tab of the match detail page. Polish what exists, and design the new pieces listed under *What to design*. We're building features first, so some sections below already exist in code without a design pass.

---

## What the tab is for

A reader opens a finished match and wants to know **how it was won**: when the game turned, which fights mattered, and what individual players did. The tab is a replay you can scrub: one clock drives every panel, and moving it updates all of them together.

Typical readers are players reviewing their own match, casters and analysts preparing talking points, and fans following a series. They arrive on desktop more often than on phone, but links get shared to Discord and opened on phones a lot.

## Current layout, top to bottom

1. **Header.** Section title, the kill score *at the current second* (Amber vs Sapphire, filling in as you scrub), the clock, and a "Copy link" button (the link carries `?t=` so it opens at that second). *(New, shipped without design:)* each team's souls sit in small text under its kill score, and the gap sits under the clock in the leading team's color, with an arrow pointing to that team ("◀ +2.3k souls"). The souls line is left out when the match has no snapshots.
2. **Roster.** Ten player chips in two team rows. Clicking one adds them to a selection; selected players get their own lane, have their item buys merged into the feed, and are emphasized on the map. There's a "Clear" action.
3. **Map + feed, side by side.**
   - **Map panel** (left): the game map with kill markers. Modes: *Deaths*, *Heatmap*, *Both*, *Realtime* (live hero positions with trails). Heat can be colored by team or a single color. Range: whole match or recent. Optional killer→victim lines (off / on hover / all). A focused fight zooms the map to that fight, with a way to exit.
   - **Transport** (under the map): play/pause, scrubber, speed (1×–4×, real time at 1×).
   - **Feed** (right): a chronological event list. Filters: *All events, Kills, Objectives, Team fights, Key items*. Events after the clock are dimmed (35% opacity); the latest past event is marked current. Kills carry badges (First Blood, Double/Triple… Kill, Shutdown, Team Wipe). Team fights are grouped cards that can be focused.
4. **Lanes.** Stacked horizontal tracks spanning 0:00 → end, sharing one vertical playhead:
   - **Soul lead** *(new, shipped without design)*: area chart of Amber souls minus Sapphire souls; Amber above the zero line, Sapphire below, on a symmetric scale. The label column shows the live lead ("Team Name +2.3k" or "Even").
   - **Fights**: bands tinted by the winning team, labeled with the score; click to focus.
   - **Kills**: one tick per kill, in the top half for Amber kills and the bottom half for Sapphire kills.
   - **Objectives**: diamonds in team color; Patron and Mid Boss are drawn larger.
   - **One lane per selected player**: red bars for time spent dead, dots for their kills, item icons for key (tier 3+) purchases.
   - A five-minute time axis underneath. Clicking anywhere on a lane seeks there.

A 130px label column sits to the left of the lanes.

## Design system (use these, don't invent new values)

Tokens are CSS custom properties, used through Tailwind.

| Role | Token | Value |
|---|---|---|
| Amber team | `--color-team-amber` | `oklch(0.8016 0.1705 73.27)` |
| Sapphire team | `--color-team-sapphire` | `oklch(0.5542 0.2465 261.44)` |
| Accent / playhead | `--color-accent` / `-light` | `oklch(68.88% 0.187 300)` (violet) |
| Danger (dead time) | `--color-danger`, `-bg`, `-border` | red at 12% / 30% alpha |
| Surfaces | `--color-table` < `--color-card` < `--color-panel` | `oklch(.13/.19/.28 … 279.82)` |
| Text | `--color-primary`, `-secondary`, `-dim` | white, near-white, mid-grey |
| Borders | `--color-border`, `-light`, `-lighter` | white at 8 / 12 / 14% |
| Neutral chip | `--color-badge-bg` | |

Team fills use `color-mix(in oklch, <team> 30–45%, transparent)`. **Amber and Sapphire are the only team colors.** Every team mark on the page uses them, so the map, feed and lanes read as one system.

Type: `font-valve-oracle` for uppercase labels (11px, semibold, 0.04em tracking), `font-valve-pulp` for numbers and scores, tabular numerals wherever values change during playback.

Badge tones: `warning` (First Blood, Shutdown), `accent` (multi-kills), `danger` (Team Wipe).

## What to design

### 1. Polish pass on the whole tab (priority)
- **Hierarchy.** There's a lot on screen. The reader should be able to see *who's winning and why* at a glance before digging into controls. The soul lead and the score are the headline numbers.
- **Control density.** The map panel has four sets of options (mode, heat color, range, lines). Group or tuck away the ones most readers won't touch.
- **The soul-lead track and header souls.** Both shipped without design. Check the track's height (currently 48px), its readout in the label column, and the header's souls line (see item 1 of the layout).
- **Hover and focus states** across lanes, feed rows and map markers. Hovering a kill in one place should visibly link it to the others. Today only one direction exists: hovering a feed row highlights the kill on the map.

### 2. New pieces coming next (design these alongside)
- **Fight cards with stakes** *(shipped without design)*: each team-fight card has a third line with the respawn time each side sat through ("Dead time Amber 20s · Sapphire 40s") and the top killer when someone got 2+ kills (hero icon, name, "×3"). The follow-up objective now names who took it ("→ Sapphire took Walker"), since it isn't always the winner. Per-fight souls and damage aren't available: soul snapshots are 3–5 minutes apart, too coarse to split by fight, so don't design for them.
- **Turning points:** the 2–3 biggest soul-lead swings (measured between snapshots 3–5 minutes apart, so a turning point is a window, which may contain one or more fights), shown as clickable chips (e.g. "Turning point · 24:10 · +6k swing") that seek there and focus the fight. Where do they live: above the lanes, in the header, or pinned in the feed?
- **Live roster** *(shipped without design)*: each chip shows hero, name, "K/D · souls" at the current second (e.g. "3/1 · 8.4k"), and a red respawn countdown while dead (the portrait and name dim). K/D is exact. Souls are estimated between snapshots minutes apart, and the hover text says so. Assists aren't shown: deaths record only the killer. Chips are now wider, so check how 6 of them wrap per team panel.

### 3. Open questions that need structure, not just styling
- **Map control mode:** shading which areas of the map each team occupies over time (a new map mode, from position data). How does it coexist with heat and death markers?
- **Collapsing quiet stretches in the feed:** fold runs of minor events into a summary row ("3 min · 2 picks"). What does the folded row look like and how does it expand?
- **Phone layout (≤ 640px):** map and feed are side by side on desktop. On phone, decide the stacking order, where the transport goes (sticky?), and how lanes work at ~340px wide (horizontal scroll inside the lanes is fine; page-level horizontal scroll is not).

## Constraints

- **One clock.** Every panel reads the same second. Don't design anything that implies panels can be at different times.
- **One playhead** spans the whole lane stack. Tracks must share the same 0 → duration axis and left/right edges.
- **Lane heights are fixed per track**, and the label column is fixed-width (130px) so labels and tracks line up row by row. Propose new heights if needed, but keep rows aligned.
- **Future events are dimmed, not hidden**, so the reader can see what's coming.
- **Data can be partial.** Older matches may have no positions, no snapshots (so no soul lead), or estimated respawn times. Every section needs an empty or degraded state. "No timeline recorded for this match yet" is the current fallback.
- **Spoilers.** The site has a spoiler mode that hides results. Opening the tab at the end of the match shows the final score, so consider a spoiler-safe opening state (e.g. start at 0:00 with the score hidden).
- Dark theme only today; keep contrast WCAG AA against `--color-card`.

## Deliverables we'd like back

1. A desktop mockup of the full tab at ~1280px with the polish pass applied.
2. A phone mockup (~375px).
3. Component specs for: header with souls (refine what shipped), live roster chip (alive / dead states; refine what shipped), fight card with stakes (refine what shipped), turning-point chip, soul-lead track.
4. Notes on any token additions (ideally none).

## Code map (for reference)

- Page: `frontend/src/pages/MatchDetail.jsx` (Timeline tab block)
- Components: `frontend/src/components/Timeline{Header,Roster,MapPanel,Map,Transport,Feed,Lanes}.jsx`
- Logic (pure, tested): `frontend/src/utils/matchTimeline{,Model,Feed,Lanes,Map,Roster}.js`
- Tokens: `frontend/src/App.css`
- Previous design work: `docs/stats-redesign/`
