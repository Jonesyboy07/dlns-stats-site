import { describe, expect, it } from "vitest";
import {
  CNS_RELEASED_AT,
  DEFAULT_MAP_VERSION,
  MAP_RADIUS,
  MAP_VERSIONS,
  mapVersionConfig,
  mapVersionForMatch,
  worldToPercent,
  worldToPixels,
  worldToRelative,
} from "./matchMap";

// Real calibration points taken from the API's own map asset, which publishes both
// the world position and the relative image position for each one.
const API_CALIBRATION = [
  { name: "dock_camp", x: -9248, y: 0, left: 0.06994047619047619, top: 0.5 },
  { name: "slums_garage_down_camp", x: -3318, y: -1260, left: 0.345703125, top: 0.55859375 },
  { name: "chinatown_bell_1", x: 3248, y: -1888, left: 0.6510416666666666, top: 0.5877976190476191 },
];

describe("worldToRelative", () => {
  it("reproduces the API's own world -> image calibration exactly", () => {
    for (const point of API_CALIBRATION) {
      const { left, top } = worldToRelative(point.x, point.y);
      expect(left, point.name).toBeCloseTo(point.left, 12);
      expect(top, point.name).toBeCloseTo(point.top, 12);
    }
  });

  it("puts the world origin at the centre of the map", () => {
    expect(worldToRelative(0, 0)).toEqual({ left: 0.5, top: 0.5 });
  });

  it("grows left with +x and up with +y", () => {
    expect(worldToRelative(MAP_RADIUS, 0).left).toBe(1);
    expect(worldToRelative(-MAP_RADIUS, 0).left).toBe(0);
    // +y is "up", so it maps to the top of the image.
    expect(worldToRelative(0, MAP_RADIUS).top).toBe(0);
    expect(worldToRelative(0, -MAP_RADIUS).top).toBe(1);
  });

  it("returns null for an incomplete position", () => {
    expect(worldToRelative(null, 0)).toBeNull();
    expect(worldToRelative(0, undefined)).toBeNull();
    expect(worldToRelative("n/a", 12)).toBeNull();
  });
});

describe("worldToPercent", () => {
  it("scales the relative point to percentages", () => {
    expect(worldToPercent(0, 0)).toEqual({ left: 50, top: 50 });
  });

  it("clamps a position outside the playfield to the edge", () => {
    expect(worldToPercent(MAP_RADIUS * 4, -MAP_RADIUS * 4)).toEqual({ left: 100, top: 100 });
    expect(worldToPercent(-MAP_RADIUS * 4, MAP_RADIUS * 4)).toEqual({ left: 0, top: 0 });
  });

  it("returns null for a missing position", () => {
    expect(worldToPercent(null, null)).toBeNull();
  });
});

describe("worldToPixels", () => {
  it("maps onto a square image", () => {
    expect(worldToPixels(0, 0, 1024, 1024)).toEqual({ x: 512, y: 512 });
    expect(worldToPixels(-MAP_RADIUS, MAP_RADIUS, 1024, 1024)).toEqual({ x: 0, y: 0 });
  });
});

describe("mapVersionForMatch", () => {
  it("picks the old layout before the update and the new one after", () => {
    expect(mapVersionForMatch({ start_time: "2026-09-29T19:59:00Z" })).toBe("pre_cns");
    expect(mapVersionForMatch({ start_time: CNS_RELEASED_AT })).toBe("post_cns");
    expect(mapVersionForMatch({ start_time: "2026-10-05T18:00:00Z" })).toBe("post_cns");
  });

  it("accepts the raw epoch seconds the metadata API sends", () => {
    const before = Date.UTC(2026, 8, 29, 19, 0, 0) / 1000; // 29 Sep 2026, 19:00 UTC
    const after = Date.UTC(2026, 8, 29, 21, 0, 0) / 1000; // two hours later
    expect(mapVersionForMatch({ start_time: before })).toBe("pre_cns");
    expect(mapVersionForMatch({ start_time: after })).toBe("post_cns");
    // Milliseconds, in case a caller passes a Date-based value through.
    expect(mapVersionForMatch({ start_time: after * 1000 })).toBe("post_cns");
  });

  it("reports an unknown layout when there is no start time", () => {
    expect(mapVersionForMatch({})).toBeNull();
    expect(mapVersionForMatch(null)).toBeNull();
    expect(mapVersionForMatch({ start_time: "not a date" })).toBeNull();
  });
});

describe("mapVersionConfig", () => {
  it("returns the requested version", () => {
    expect(mapVersionConfig("pre_cns")).toBe(MAP_VERSIONS.pre_cns);
  });

  it("falls back to the default for an unknown or missing version", () => {
    expect(mapVersionConfig("nope")).toBe(MAP_VERSIONS[DEFAULT_MAP_VERSION]);
    expect(mapVersionConfig(null)).toBe(MAP_VERSIONS[DEFAULT_MAP_VERSION]);
  });

  it("gives every layout an image pair and the map radius", () => {
    for (const [id, version] of Object.entries(MAP_VERSIONS)) {
      expect(version.id, id).toBe(id);
      expect(version.overlay, id).toMatch(/^mapHud\/.+\.png$/);
      expect(version.background, id).toMatch(/^mapHud\/.+\.png$/);
      expect(version.radius, id).toBe(MAP_RADIUS);
    }
  });

  it("points the pre-update layout at the old minimap", () => {
    expect(MAP_VERSIONS.pre_cns.overlay).toBe("mapHud/old_minimap.png");
    expect(MAP_VERSIONS.pre_cns.background).toBe("mapHud/old_minimap_bg.png");
  });
});
