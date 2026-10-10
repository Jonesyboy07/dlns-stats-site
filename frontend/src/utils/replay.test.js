import { describe, expect, it } from "vitest";
import { MAP_RADIUS } from "./matchMap";
import {
  decodeTrail,
  elapsedRows,
  isOnMap,
  nextTime,
  playerMarkersAt,
  replayDuration,
  trailPositionAt,
} from "./replay";

/** Interleaved int16 samples as the API's base64 payload. */
function encode(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  new Int16Array(buffer).set(samples);
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function trail(samples, player = {}) {
  return decodeTrail({ positions: encode(samples), player_slot: 1, ...player });
}

describe("decodeTrail", () => {
  it("reads interleaved x/y samples back", () => {
    const decoded = trail([100, -200, 300, -400]);
    expect(decoded.count).toBe(2);
    expect([...decoded.samples]).toEqual([100, -200, 300, -400]);
  });

  it("keeps the player metadata alongside the samples", () => {
    const decoded = trail([0, 0], { player_slot: 7, team: 1, hero_id: 12 });
    expect(decoded.player.player_slot).toBe(7);
    expect(decoded.player.team).toBe(1);
  });

  it("returns null when there is nothing usable", () => {
    expect(decodeTrail(null)).toBeNull();
    expect(decodeTrail({})).toBeNull();
    expect(decodeTrail({ positions: "" })).toBeNull();
    expect(decodeTrail({ positions: "not base64 !!" })).toBeNull();
    // a partial sample cannot form a whole x/y pair
    expect(decodeTrail({ positions: btoa("\x01\x00\x02") })).toBeNull();
  });
});

describe("isOnMap", () => {
  it("accepts the playfield and rejects anything beyond it", () => {
    expect(isOnMap(0, 0)).toBe(true);
    expect(isOnMap(MAP_RADIUS, -MAP_RADIUS)).toBe(true);
    expect(isOnMap(MAP_RADIUS + 1, 0)).toBe(false);
    expect(isOnMap(0, -MAP_RADIUS - 1)).toBe(false);
    expect(isOnMap(NaN, 0)).toBe(false);
  });
});

describe("trailPositionAt", () => {
  it("reads a sample exactly on the second", () => {
    const decoded = trail([0, 0, 1000, 2000]);
    expect(trailPositionAt(decoded, 0)).toEqual({ x: 0, y: 0 });
    expect(trailPositionAt(decoded, 1)).toEqual({ x: 1000, y: 2000 });
  });

  it("interpolates between seconds so motion is smooth", () => {
    const decoded = trail([0, 0, 1000, 2000]);
    expect(trailPositionAt(decoded, 0.25)).toEqual({ x: 250, y: 500 });
    expect(trailPositionAt(decoded, 0.5)).toEqual({ x: 500, y: 1000 });
  });

  it("holds the final sample and then stops answering", () => {
    const decoded = trail([0, 0, 1000, 2000]);
    expect(trailPositionAt(decoded, 1)).toEqual({ x: 1000, y: 2000 });
    expect(trailPositionAt(decoded, 2)).toBeNull();
    expect(trailPositionAt(decoded, 900)).toBeNull();
  });

  it("refuses positions outside the playfield", () => {
    // the pre-game spawn sits off the minimap
    const decoded = trail([-12960, -256, -12960, -256]);
    expect(trailPositionAt(decoded, 0)).toBeNull();
  });

  it("refuses nonsense input", () => {
    expect(trailPositionAt(null, 10)).toBeNull();
    expect(trailPositionAt(trail([]), 10)).toBeNull();
    expect(trailPositionAt(trail([0, 0, 1, 1]), -1)).toBeNull();
    expect(trailPositionAt(trail([0, 0, 1, 1]), null)).toBeNull();
    expect(trailPositionAt(trail([0, 0, 1, 1]), "abc")).toBeNull();
  });
});

describe("playerMarkersAt", () => {
  const east = trail([10752, 0, 10752, 0], { player_slot: 4, team: 0, hero_id: 3 });
  const centre = trail([0, 0, 0, 0], { player_slot: 9, team: 1, hero_id: 6 });
  const spawn = trail([-12960, -256, -12960, -256], { player_slot: 2, team: 1, hero_id: 1 });

  it("positions each marker on the map", () => {
    const markers = playerMarkersAt([east, centre], 0);
    expect(markers.map((marker) => marker.playerSlot)).toEqual([4, 9]);
    // world +x is the map's right edge, the centre is the middle
    expect(markers[0]).toMatchObject({ left: 100, top: 50, team: 0, heroId: 3 });
    expect(markers[1]).toMatchObject({ left: 50, top: 50, team: 1, heroId: 6 });
  });

  it("drops players it cannot place", () => {
    expect(playerMarkersAt([spawn], 0)).toEqual([]);
    expect(playerMarkersAt([east], 500)).toEqual([]);
  });

  it("names a player without a persona", () => {
    expect(playerMarkersAt([centre], 0)[0].name).toBe("Slot 9");
  });

  it("has a stable key per player", () => {
    expect(playerMarkersAt([east, centre], 0).map((m) => m.key)).toEqual(["player-4", "player-9"]);
    expect(playerMarkersAt([], 0)).toEqual([]);
  });
});

describe("elapsedRows", () => {
  const rows = [
    { key: "a", time_s: 100 },
    { key: "b", time_s: 300 },
    { key: "c", time_s: null },
    { key: "d", time_s: 300 },
  ];

  it("keeps what has happened and drops what has not", () => {
    expect(elapsedRows(rows, 300).map((row) => row.key)).toEqual(["a", "b", "d"]);
    expect(elapsedRows(rows, 299).map((row) => row.key)).toEqual(["a"]);
    expect(elapsedRows(rows, 0)).toEqual([]);
  });

  it("drops undated rows, which cannot say when they happened", () => {
    expect(elapsedRows(rows, 10_000).map((row) => row.key)).toEqual(["a", "b", "d"]);
  });

  it("handles unusable input", () => {
    expect(elapsedRows(rows, null)).toEqual([]);
    expect(elapsedRows(rows, "abc")).toEqual([]);
    expect(elapsedRows(null, 100)).toEqual([]);
  });
});

describe("nextTime", () => {
  it("advances by the elapsed time scaled by the playback rate", () => {
    expect(nextTime(10, 1, 1, 100)).toBe(11);
    expect(nextTime(10, 1, 2, 100)).toBe(12);
    expect(nextTime(10, 0.5, 0.5, 100)).toBe(10.25);
  });

  it("stops at the end of the match instead of running past it", () => {
    expect(nextTime(99, 5, 1, 100)).toBe(100);
    expect(nextTime(100, 5, 1, 100)).toBe(100);
  });

  it("never goes below zero", () => {
    expect(nextTime(0.1, -1, 1, 100)).toBe(0);
    expect(nextTime(0, 0, 1, 100)).toBe(0);
  });

  it("falls back to sane defaults for unusable input", () => {
    expect(nextTime(NaN, 1, 1, 50)).toBe(1);
    expect(nextTime(10, NaN, 1, 50)).toBe(10);
    expect(nextTime(10, 1, 0, 50)).toBe(11);
    expect(nextTime(10, 1, 1, null)).toBe(0);
  });
});

describe("replayDuration", () => {
  it("uses the longest trail when the match length is unknown", () => {
    expect(replayDuration([trail([0, 0, 1, 1, 2, 2])], null)).toBe(2);
  });

  it("uses the reported match length when it is longer", () => {
    expect(replayDuration([trail([0, 0, 1, 1, 2, 2])], 900)).toBe(900);
  });

  it("prefers the match length even when a trail runs past it", () => {
    // otherwise the closing seconds show only the players whose trail happens to run on
    const long = trail(Array.from({ length: 60 }, (_, index) => [index, index]).flat());
    expect(replayDuration([long], 50)).toBe(50);
  });

  it("handles having nothing to play", () => {
    expect(replayDuration([], null)).toBe(0);
    expect(replayDuration([], NaN)).toBe(0);
  });
});
