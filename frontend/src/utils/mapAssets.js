/**
 * The map's fixed furniture: lane ziplines and the objectives (guardians, walkers,
 * base guardians, shrines, Titan, Patron) as of a moment in the match.
 *
 * The geometry is vendored by `scripts/fetch_map_assets.mjs` and committed as
 * `src/data/mapAssets.json`, so a page load never calls a third party. Positions are
 * the structures' **centres** in percent of the minimap: deadlock-api publishes
 * marker top-left corners, and the generator adds the marker's half-size. It
 * describes the current (City Never Sleeps) layout only, which is why
 * `mapFurniture` returns null for the older map: drawing today's towers on
 * yesterday's art would place them on the wrong terrain.
 *
 * Each objective carries one or more positions -- a lane's two base guardians share
 * one `match_objectives` id, so they fall together.
 *
 * `match_objectives.team` is the side that *owns* the objective -- the one that lost
 * it. Verified two ways: the asset's own keys are `team{0,1}_{tier}`, and for the
 * Patron, whose fall is always the losing side's, the destroyed row's team is the
 * loser (checked against `winning_team` in the same metadata payload).
 */

import MAP_ASSETS from "../data/mapAssets.json";
import { mapVersionConfig } from "./matchMap";
import { objectiveLabel } from "./matchTimeline";

/**
 * The glyph's target **width in px** by tier. This is the number to change if markers
 * want to be bigger or smaller: `titan`/`core` are the arch and the Patron, `tier1` the
 * lane guardians, `tier2` the walkers.
 */
export const OBJECTIVE_MARKER_SIZE = { tier1: 22, tier2: 32, base: 13, shrine: 18, titan: 26, core: 26 };

/**
 * How much of each icon file's canvas the glyph actually spans, measured from the
 * alpha bounds of the published PNGs (guardian/walker/base_guardian 44%, titan 73%
 * wide, patron 23%). The files pad their art very differently, so the box is sized
 * `marker size / fill` to make every glyph land at the same visual width. Measured,
 * not guessed -- re-measure if the art is replaced.
 */
export const OBJECTIVE_ICON_FILL = { tier1: 0.44, tier2: 0.44, base: 0.44, shrine: 0.44, titan: 0.73, core: 0.23 };

/**
 * Objective art, as paths under the image CDN's `mapHud/` folder -- the same folder
 * the minimap itself lives in, so the whole map's art is in one place. The published
 * art is a white glyph, drawn here as a mask so it takes the owner's team colour.
 *
 * A missing file is not an error: the marker falls back to a hollow team-coloured
 * diamond.
 */
export const OBJECTIVE_ICONS = {
  tier1: "mapHud/objectives/guardian.png",
  tier2: "mapHud/objectives/walker.png",
  base: "mapHud/objectives/base_guardian.png",
  shrine: "mapHud/objectives/shrine.png",
  titan: "mapHud/objectives/titan.png",
  core: "mapHud/objectives/patron.png",
};

/**
 * The icon's CDN path, or null for an unknown tier. Deliberately plain: the CDN
 * answers 404 to any path carrying a query string, and its 404s are `no-store`, so
 * there is nothing to bust -- do not add a `?v=` here.
 */
export function objectiveIconPath(tier) {
  return OBJECTIVE_ICONS[tier] ?? null;
}

/** Draw order, smallest first, so the Patron is never hidden behind a guardian. */
const TIER_ORDER = { tier1: 0, tier2: 1, base: 2, shrine: 3, titan: 4, core: 5 };

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The furniture for a match's layout, or null when the layer must not be drawn.
 * An unknown version resolves to the configuration's default, which is the current
 * map -- and so the one the geometry belongs to.
 */
export function mapFurniture(version = null) {
  return mapVersionConfig(version).id === MAP_ASSETS.version ? MAP_ASSETS : null;
}

/** The ziplines as `{ lane, color, path }`, or [] when the layer is off. */
export function ziplinesFor(version = null) {
  return mapFurniture(version)?.ziplines ?? [];
}

/**
 * Every objective the asset knows a position for, with its state at `t`.
 *
 * `objectives` are the timeline model's rows (`{ objectiveId, team, timeS }`), where
 * `team` is the side that owns the objective. A row whose `timeS` is still ahead of
 * `t` leaves the objective standing: the map shows what the clock has reached, not
 * what the match eventually did. With no clock (a static view) the state is the end
 * of the match.
 *
 * Each marker is `{ id, objectiveId, label, team, lane, tier, left, top, timeS,
 * fallen }`, where `team` is the owning side and `timeS` is when it fell (null when
 * it never did). One marker per physical structure, so a lane's two base guardians
 * come back as two markers sharing an objective id and a fall time.
 */
export function objectiveMarkers({ objectives = [], t = null, version = null } = {}) {
  const furniture = mapFurniture(version);
  if (!furniture) return [];

  // Earliest fall per (objective id, owner): a duplicate row must not move a tower.
  const fallenAt = new Map();
  for (const event of objectives || []) {
    const objectiveId = toNumber(event?.objectiveId);
    const owner = toNumber(event?.team);
    const timeS = toNumber(event?.timeS);
    if (objectiveId === null || (owner !== 0 && owner !== 1)) continue;
    if (timeS === null || timeS <= 0) continue;
    const key = `${objectiveId}:${owner}`;
    const previous = fallenAt.get(key);
    if (previous === undefined || timeS < previous) fallenAt.set(key, timeS);
  }

  const at = toNumber(t);
  return furniture.objectives
    .flatMap((objective) => {
      const timeS = fallenAt.get(`${objective.objectiveId}:${objective.team}`) ?? null;
      return (objective.positions || []).map(([left, top], index) => ({
        id: `${objective.key}:${index}`,
        objectiveId: objective.objectiveId,
        label: objectiveLabel(objective.objectiveId),
        team: objective.team,
        lane: objective.lane,
        tier: objective.tier,
        left,
        top,
        timeS,
        fallen: timeS !== null && (at === null || at >= timeS),
      }));
    })
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));
}
