/**
 * The match page's laning tab: the opening minutes read as three 2v2 matchups.
 *
 * Two sources feed it. The matchup and the lane-phase numbers come from the per-player
 * timeline snapshots (`/matches/<id>/timeline`); the kills come from the same event
 * rows the timeline tab already builds (`buildTimelineRows`). Lane assignment follows
 * the scoreboard — the positionally-inferred `lane_real` when it exists, otherwise the
 * game-reported `lane` (see `playerLane`).
 *
 * Snapshot helpers are tolerant of the data the API actually sends: snapshots can start
 * after 0:00, `time_stamp_s` can be missing, and a match may have no snapshots at all.
 * Anything that cannot be known is returned as `null` rather than a misleading 0, so the
 * UI can show "—".
 */

import { LANE_ORDER, playerLane } from "./lanes";

/**
 * Laning ends here for this tab. Lanes hold for roughly the first ten minutes; after
 * that rotations and objectives dominate and the same numbers stop meaning "laning".
 */
export const LANING_END_S = 600;

/** The milestones the panel reports: 5:00 and the end of laning. */
export const LANING_MILESTONES_S = [300, LANING_END_S];

/** A finite number, or null for a missing value (`Number(null)` is `0`, which is not a time). */
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `value` when it is an array, otherwise an empty list — a bad argument must not crash a render. */
const list = (value) => (Array.isArray(value) ? value : []);

/** The earliest snapshot by recorded time, or null when none carries a time. */
export function firstSnapshot(snapshots = []) {
  let found = null;
  for (const snapshot of list(snapshots)) {
    const at = numberOrNull(snapshot?.time_stamp_s);
    if (at === null) continue;
    if (!found || at < Number(found.time_stamp_s)) found = snapshot;
  }
  return found;
}

/** The latest snapshot at or before `seconds`, or null when none is that early. */
export function snapshotAt(snapshots = [], seconds) {
  let found = null;
  let best = -Infinity;
  for (const snapshot of list(snapshots)) {
    const at = numberOrNull(snapshot?.time_stamp_s);
    if (at === null || at > seconds || at < best) continue;
    best = at;
    found = snapshot;
  }
  return found;
}

/** Souls banked by `seconds`, or null when the timeline does not reach back that far. */
export function soulsAt(snapshots = [], seconds) {
  const snapshot = snapshotAt(snapshots, seconds);
  if (!snapshot) return null;
  return numberOrNull(snapshot.net_worth);
}

/** How far a stat climbed between the first snapshot and `seconds` (never negative). */
export function statDelta(snapshots = [], seconds, key) {
  const end = snapshotAt(snapshots, seconds);
  const start = firstSnapshot(snapshots);
  if (!end || !start) return null;
  return Math.max(0, (Number(end[key]) || 0) - (Number(start[key]) || 0));
}

/** Souls per minute up to `seconds`, or null when either side is unknown. */
export function soulsPerMinute(snapshots = [], seconds) {
  const souls = soulsAt(snapshots, seconds);
  if (souls == null || !(seconds > 0)) return null;
  return (souls / seconds) * 60;
}

/**
 * Everything the panel shows for one player over the laning window. Every field is null
 * when the snapshots cannot answer it, so a caller can render "—" without guessing.
 */
export function playerLaningStats(snapshots = [], seconds = LANING_END_S) {
  return {
    souls: soulsAt(snapshots, seconds),
    soulsPerMinute: soulsPerMinute(snapshots, seconds),
    kills: statDelta(snapshots, seconds, "kills"),
    deaths: statDelta(snapshots, seconds, "deaths"),
    assists: statDelta(snapshots, seconds, "assists"),
    damage: statDelta(snapshots, seconds, "player_damage"),
  };
}

/**
 * The two sides of every lane, in York/Broadway/Greenwich order, each ordered by slot so
 * the mirrored rows pair a lane's opponents the same way every time. `unassigned` counts
 * the players with no lane at all, who are not listed but should not vanish silently;
 * every lane is listed even when empty so the three boards stay comparable.
 */
export function laneMatchups(players = []) {
  const rows = new Map(LANE_ORDER.map((lane) => [lane, { lane, left: [], right: [] }]));
  let unassigned = 0;
  for (const player of list(players)) {
    const row = rows.get(Number(playerLane(player)));
    if (!row) {
      unassigned += 1;
      continue;
    }
    (Number(player?.team) === 1 ? row.right : row.left).push(player);
  }
  const bySlot = (a, b) => (a?.player_slot || 0) - (b?.player_slot || 0);
  for (const row of rows.values()) {
    row.left.sort(bySlot);
    row.right.sort(bySlot);
  }
  return { rows: LANE_ORDER.map((lane) => rows.get(lane)), unassigned };
}

/** Sum of a side's souls at `seconds`, and whether every value behind it was known. */
function sideSouls(players, snapshotsFor, seconds) {
  let total = 0;
  let known = false;
  for (const player of players) {
    const souls = soulsAt(snapshotsFor(player), seconds);
    if (souls == null) continue;
    total += souls;
    known = true;
  }
  return { total, known };
}

/**
 * Which side led a lane on souls at `seconds`. `snapshotsFor(player)` must return that
 * player's snapshot list. Returns `null` when either side has no known souls, so an
 * unknown lane is never drawn as a win, a loss or a tie.
 */
export function laneSoulsLead(leftPlayers, rightPlayers, snapshotsFor, seconds = LANING_END_S) {
  const left = sideSouls(leftPlayers, snapshotsFor, seconds);
  const right = sideSouls(rightPlayers, snapshotsFor, seconds);
  if (!left.known || !right.known) return null;
  return { left: left.total, right: right.total, diff: left.total - right.total };
}

/** Deaths inside the laning window, in the event feed's own time order. */
export function laningKills(rows = [], endS = LANING_END_S) {
  return list(rows).filter(
    (row) => row?.type === "death" && row.time_s != null && row.time_s <= endS
  );
}

/** Deaths per side (the victim's team) plus the opening kill, for the map caption. */
export function laningKillSummary(killRows = []) {
  const rows = list(killRows);
  const summary = { total: rows.length, amber: 0, sapphire: 0, firstBlood: rows[0] ?? null };
  for (const row of rows) {
    if (row.team === 0) summary.amber += 1;
    else if (row.team === 1) summary.sapphire += 1;
  }
  return summary;
}
