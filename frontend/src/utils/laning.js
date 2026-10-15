/**
 * The snapshot side of the laning tab (`components/laning/*`): souls, K/D/A and damage
 * over the opening minutes, plus the lane grouping the map, the head-to-head and the
 * build table all mirror.
 *
 * One source feeds it: the per-player timeline snapshots (`/matches/<id>/timeline`).
 * Lane assignment follows the scoreboard — the positionally-inferred `lane_real` when it
 * exists, otherwise the game-reported `lane` (see `playerLane`).
 *
 * Snapshot helpers are tolerant of the data the API actually sends: snapshots can start
 * after 0:00, `time_stamp_s` can be missing, and a match may have no snapshots at all.
 * Anything that cannot be known is returned as `null` rather than a misleading 0, so the
 * UI can show "—".
 *
 * The clock, the kill list and the reveal rules live in `laningTab.js`.
 */

import { LANE_ORDER, playerLane } from "./lanes";

/**
 * Laning ends here. Lanes hold for roughly the first ten minutes; after that rotations
 * and objectives dominate and the same numbers stop meaning "laning".
 */
export const LANING_END_S = 600;

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
