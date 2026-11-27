import { describe, expect, it } from "vitest";
import { MAP_RADIUS, worldToRelative } from "./matchMap";
import { ziplinePath } from "./mapZiplinePath";

/** A two-anchor, straight spline: no handles, so the curve is the chord. */
const straight = () => ({ origin: [0, 0], p0: [0, 0, 2150.4, 0], p1: [0, 0, 0, 0], p2: [0, 0, 0, 0] });

describe("ziplinePath", () => {
  it("maps a straight spline onto the same percentages a marker would use", () => {
    // (0, 0) is the map's centre and 2150.4 units is a tenth of the width.
    expect(ziplinePath(straight())).toBe("M50,50 C50,50 60,50 60,50");
  });

  it("flips the vertical axis like every other map position", () => {
    const path = ziplinePath({ ...straight(), p0: [0, 0, 0, 2150.4] });
    expect(path).toContain("M50,50");
    expect(path.endsWith("50,40")).toBe(true);
  });

  it("offsets every anchor by the spline origin", () => {
    const path = ziplinePath({ ...straight(), origin: [2150.4, 0] });
    expect(path.startsWith("M60,50")).toBe(true);
  });

  it("puts the outgoing and incoming handles on their own sides of the chord", () => {
    const path = ziplinePath({
      origin: [0, 0],
      p0: [0, 0, 2150.4, 0],
      p1: [0, 0, 0, 0], // incoming handle for anchor 1 (unused by anchor 0)
      p2: [1075.2, 1075.2, 0, 0],
    });
    expect(path).toBe("M50,50 C55,45 60,50 60,50");
  });

  it("joins every anchor pair into one continuous path", () => {
    const path = ziplinePath({
      origin: [0, 0],
      p0: [0, 0, 1000, 0, 2000, 0],
      p1: [0, 0, 0, 0, 0, 0],
      p2: [0, 0, 0, 0, 0, 0],
    });
    expect(path.match(/C/g)).toHaveLength(2);
    expect(path.startsWith("M50,50 C")).toBe(true);
  });

  it("refuses a spline it cannot place", () => {
    expect(ziplinePath(null)).toBe("");
    expect(ziplinePath({ origin: [0, 0], p0: [0, 0] })).toBe("");
    expect(ziplinePath({ ...straight(), p1: [0, 0] })).toBe("");
    expect(ziplinePath({ ...straight(), origin: ["x", 0] })).toBe("");
    expect(ziplinePath({ ...straight(), p0: [0, 0, Number.NaN, 0] })).toBe("");
  });

  it("keeps a point outside the playfield outside the frame instead of piling it on the edge", () => {
    const beyond = worldToRelative(0, MAP_RADIUS * 1.2);
    expect(beyond.top).toBeLessThan(0);
    const path = ziplinePath({ ...straight(), p0: [0, 0, 0, MAP_RADIUS * 1.2] });
    // 50 - 10% past the edge, rather than clamped to 0.
    expect(path.endsWith("50,-10")).toBe(true);
  });
});
