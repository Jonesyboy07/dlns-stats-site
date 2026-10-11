/**
 * The map replay's data layer: the stored per-player trails read as on-map points at a
 * given second. Everything here is pure so the playback clock and the transport can be
 * tested without a DOM.
 */

import { MAP_RADIUS, worldToPercent } from "./matchMap";

/** Playback rates the transport offers, slowest first. 1 is real time. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4];

/**
 * Base64 to bytes. Returns an empty array for anything unusable so callers can treat
 * "no trail" and "empty trail" the same way.
 */
function base64ToBytes(value) {
  if (typeof value !== "string" || value === "") return new Uint8Array(0);
  let binary;
  try {
    binary = atob(value);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * One player's trail as interleaved `x0, y0, x1, y1, ...` world coordinates, decoded
 * once so every later read is an index into the same array. Returns null when the
 * payload carries no usable samples.
 */
export function decodeTrail(player) {
  const bytes = base64ToBytes(player?.positions);
  // Int16Array needs whole samples: two axes of two bytes each.
  const usable = bytes.length - (bytes.length % 4);
  if (usable === 0) return null;
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
  return { player, samples, count: samples.length / 2 };
}

/** Whether a world position is inside the playfield the minimap draws. */
export function isOnMap(x, y, radius = MAP_RADIUS) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= radius &&
    Math.abs(y) <= radius
  );
}

/**
 * A trail's position at `timeS`, interpolated between the one-second samples so motion
 * is smooth rather than stepping. Returns null when there is nothing to draw: past the
 * end of the trail, or outside the playfield. The API records the pre-game spawn,
 * which sits off the minimap, and a hero pinned to the map edge for the opening
 * seconds would read as a real position.
 */
export function trailPositionAt(trail, timeS) {
  if (!trail || !trail.count) return null;
  // `Number(null)` is 0, so a missing time must be rejected before any coercion.
  if (timeS === null || timeS === undefined || timeS === "") return null;
  const time = Number(timeS);
  if (!Number.isFinite(time) || time < 0) return null;

  const last = trail.count - 1;
  if (time > last) return null;
  const index = Math.floor(time);
  const next = Math.min(index + 1, last);
  const fraction = time - index;

  const x = trail.samples[index * 2] + (trail.samples[next * 2] - trail.samples[index * 2]) * fraction;
  const y =
    trail.samples[index * 2 + 1] + (trail.samples[next * 2 + 1] - trail.samples[index * 2 + 1]) * fraction;

  return isOnMap(x, y) ? { x, y } : null;
}

/**
 * Every player's marker at `timeS`, in map percentages, skipping anyone the trail
 * cannot place.
 */
export function playerMarkersAt(trails, timeS) {
  return trails.reduce((markers, trail) => {
    const position = trailPositionAt(trail, timeS);
    if (!position) return markers;
    const point = worldToPercent(position.x, position.y);
    if (!point) return markers;
    const player = trail.player || {};
    markers.push({
      key: `player-${player.player_slot}`,
      playerSlot: player.player_slot,
      team: player.team ?? null,
      heroId: player.hero_id ?? null,
      name: player.persona_name || `Slot ${player.player_slot}`,
      left: point.left,
      top: point.top,
    });
    return markers;
  }, []);
}

/**
 * The timeline rows that have happened by `timeS`. Rows with no time are dropped: the
 * replay shows what has occurred, and an undated row cannot say.
 */
export function elapsedRows(rows, timeS) {
  const time = Number(timeS);
  if (!Array.isArray(rows) || !Number.isFinite(time)) return [];
  return rows.filter((row) => row?.time_s != null && row.time_s <= time);
}

/**
 * The clock value after `deltaSeconds` of real time at `speed`. Playback stops at the
 * end rather than looping, and never runs past the last second the trails can answer.
 */
export function nextTime(current, deltaSeconds, speed, endS) {
  const from = Number.isFinite(current) ? current : 0;
  const delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const end = Number.isFinite(endS) && endS > 0 ? endS : 0;
  return Math.max(0, Math.min(from + delta * rate, end));
}

/**
 * How long the replay runs, in seconds. The match's own length is authoritative: it is
 * what every trail covers, so using a longer trail instead would leave the last seconds
 * showing only the handful of players whose trail happens to run on. Without a
 * recorded length the longest trail is the best available answer.
 */
export function replayDuration(trails, durationS) {
  const match = Number(durationS);
  if (Number.isFinite(match) && match > 0) return match;
  const longest = trails.reduce((longest, trail) => Math.max(longest, trail.count || 0), 0);
  return longest > 0 ? longest - 1 : 0;
}
