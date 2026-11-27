/**
 * Zipline splines -> SVG paths in percent space.
 *
 * The Deadlock map asset publishes each lane's zipline as a Source-style spline:
 * every anchor carries its own position (`P0`), the handle pointing back at the
 * previous anchor (`P1`) and the handle pointing at the next one (`P2`), all as
 * offsets from a shared `origin` in world units. The curve between anchor i and
 * anchor i + 1 is therefore:
 *
 *     start    = origin + P0[i]
 *     control1 = origin + P0[i] + P2[i]
 *     control2 = origin + P0[i+1] + P1[i+1]
 *     end      = origin + P0[i+1]
 *
 * Verified on the published data: every handle lands between its two anchors, and
 * P0[0] / P1[0] are zero -- no incoming handle for the first anchor.
 *
 * The path is emitted in the same 0..100 percentage space the rest of the maps
 * position markers in (see `worldToRelative`), so the drawing box scales with the
 * image and a point here sits where the equivalent death cross would.
 *
 * Only the generator (`scripts/fetch_map_assets.mjs`) needs this: it bakes the
 * paths into `frontend/src/data/mapAssets.json` once, so the browser never has to
 * flatten splines at runtime. Kept here so Vitest can cover the maths.
 */

import { MAP_RADIUS, worldToRelative } from "./matchMap.js";

const XY_STRIDE = 2;

/** `value` rounded to hundredths of a percent, which is a tenth of a map pixel. */
const hundredths = (value) => Math.round(value * 100) / 100;

/** One anchor's `x`/`y` from a flat `[x0, y0, x1, y1, ...]` array. */
function offset(flat, index) {
  if (!Array.isArray(flat) || flat.length < (index + 1) * XY_STRIDE) return null;
  const x = Number(flat[index * XY_STRIDE]);
  const y = Number(flat[index * XY_STRIDE + 1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * A world point as `{ x, y }` percentages of the minimap, or null when incomplete.
 * Deliberately unclamped: a spline that starts just outside the playfield should
 * still curve correctly rather than bunch up on the edge.
 */
function percentPoint(origin, x, y, radius) {
  const point = worldToRelative(origin.x + x, origin.y + y, radius);
  if (!point) return null;
  return { x: hundredths(point.left * 100), y: hundredths(point.top * 100) };
}

/**
 * The zipline as an SVG path string over a `0 0 100 100` viewBox, or "" when the
 * spline is unusable (mismatched handle arrays, non-finite numbers).
 *
 * `zipline` is `{ origin: [x, y], p0, p1, p2 }` with the three handles as flat
 * coordinate arrays of equal length and at least two anchors.
 */
export function ziplinePath(zipline, radius = MAP_RADIUS) {
  const origin = {
    x: Number(zipline?.origin?.[0]),
    y: Number(zipline?.origin?.[1]),
  };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return "";

  const { p0, p1, p2 } = zipline;
  const anchors = Array.isArray(p0) ? p0.length / XY_STRIDE : 0;
  const sameLength =
    Array.isArray(p1) && Array.isArray(p2) && p1.length === p0.length && p2.length === p0.length;
  if (!sameLength || anchors < 2 || !Number.isInteger(anchors)) return "";

  const commands = [];
  for (let index = 0; index < anchors - 1; index += 1) {
    const from = offset(p0, index);
    const to = offset(p0, index + 1);
    const outHandle = offset(p2, index);
    const inHandle = offset(p1, index + 1);
    if (!from || !to || !outHandle || !inHandle) return "";

    const start = percentPoint(origin, from.x, from.y, radius);
    const control1 = percentPoint(origin, from.x + outHandle.x, from.y + outHandle.y, radius);
    const control2 = percentPoint(origin, to.x + inHandle.x, to.y + inHandle.y, radius);
    const end = percentPoint(origin, to.x, to.y, radius);
    if (!start || !control1 || !control2 || !end) return "";

    commands.push(
      index === 0 ? `M${start.x},${start.y}` : "",
      `C${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`,
    );
  }
  return commands.filter(Boolean).join(" ");
}
