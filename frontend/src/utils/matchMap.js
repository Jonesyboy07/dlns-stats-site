/**
 * The match map: world coordinates -> a point on a minimap image.
 *
 * The match API reports positions in world units (death positions, camp and shop
 * entities, zipline origins). The origin sits at the centre of the map, +x runs
 * towards the map's right and +y runs "up" the map, and the playfield spans
 * ±MAP_RADIUS on both axes. Every published minimap is a square image of that same
 * square, so a position becomes a plain percentage pair:
 *
 *     left = (x + R) / 2R        top = (R - y) / 2R
 *
 * The formula was checked against every position the API publishes (all 51 neutral
 * camps and the lane shops, which carry both world and relative coordinates): it
 * reproduces their `left_relative` / `top_relative` exactly.
 *
 * Careful: `match_paths` (the per-second player trails) is a different space — its
 * values run 0..16383 normalised into each player's own bounding box, so they need the
 * `x_min`/`x_max` bounds from the same entry before they can be placed here. The
 * backend converts at ingest (see `_path_world_samples` in backend/main.py), so trails
 * arrive as world coordinates and go straight through `worldToPercent`.
 */

/** Half the map's width in world units; the playfield spans ±MAP_RADIUS. */
export const MAP_RADIUS = 10752;

/**
 * City Never Sleeps reworked the map, so matches either side of it need a different
 * image. Release time comes from the update post the site already tracks; matches
 * that started before it use the old map.
 */
export const CNS_RELEASED_AT = "2026-09-29T20:00:00Z";

/**
 * One entry per map layout. `overlay` is the minimap itself and `background` the
 * plain art it sits on; both are paths under the image CDN's `mapHud/` folder.
 */
export const MAP_VERSIONS = {
  pre_cns: {
    id: "pre_cns",
    label: "Before City Never Sleeps",
    overlay: "mapHud/old_minimap.png",
    background: "mapHud/old_minimap_bg.png",
    radius: MAP_RADIUS,
  },
  post_cns: {
    id: "post_cns",
    label: "City Never Sleeps",
    // The post-update minimap has not been added yet; drop it beside the old one
    // and correct this path if the file name differs.
    overlay: "mapHud/minimap_city_never_sleeps.png",
    background: "mapHud/minimap_city_never_sleeps_bg.png",
    radius: MAP_RADIUS,
  },
};

/** The layout most matches use today, for callers that must pick one. */
export const DEFAULT_MAP_VERSION = "pre_cns";

/**
 * Which layout a match was played on, or null when its start time is unknown.
 * `start_time` is ISO in the database but raw epoch seconds in the match metadata,
 * so both are accepted.
 */
export function mapVersionForMatch(match, releasedAt = CNS_RELEASED_AT) {
  const started = toTimestamp(match?.start_time);
  if (started === null) return null;
  return started >= toTimestamp(releasedAt) ? "post_cns" : "pre_cns";
}

/** The layout config for a match, falling back to the default when unknown. */
export function mapVersionConfig(version) {
  return MAP_VERSIONS[version] || MAP_VERSIONS[DEFAULT_MAP_VERSION];
}

/** A number, or null when the value is missing or not finite (`Number(null)` is 0). */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A timestamp in milliseconds from an ISO string or an epoch number (the metadata
 * API sends seconds, everything else sends milliseconds), or null when unusable.
 */
function toTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1e11 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A world position as percentages (0..1) of the minimap's width and height, or null
 * when the position is incomplete.
 */
export function worldToRelative(x, y, radius = MAP_RADIUS) {
  const px = toFiniteNumber(x);
  const py = toFiniteNumber(y);
  if (px === null || py === null) return null;
  return {
    left: (px + radius) / (2 * radius),
    top: (radius - py) / (2 * radius),
  };
}

/**
 * A world position as CSS percentages, ready to drop into `left` / `top`.
 * Positions inside the playfield stay as they are; anything outside is clamped to
 * the edge so a stray coordinate cannot scatter markers off the image.
 */
export function worldToPercent(x, y, radius = MAP_RADIUS) {
  const point = worldToRelative(x, y, radius);
  if (!point) return null;
  const clamp = (value) => Math.min(100, Math.max(0, value * 100));
  return { left: clamp(point.left), top: clamp(point.top) };
}

/** A world position as `{x, y}` pixels on a map image of the given size. */
export function worldToPixels(x, y, width, height, radius = MAP_RADIUS) {
  const point = worldToRelative(x, y, radius);
  if (!point) return null;
  return { x: point.left * width, y: point.top * height };
}
