import { describe, expect, it } from "vitest";
import {
  TIMELINE_END,
  TIMELINE_MIN_GAP,
  TIMELINE_START,
  timelinePositions,
} from "./buildTimeline";

/** Real medians from a Night Shift player, already sorted ascending. */
const REAL_BUILD = [462, 543, 746, 1012, 1021, 1429];

const gaps = (positions) => positions.slice(1).map((value, index) => value - positions[index]);

describe("timelinePositions", () => {
  it("returns nothing for an empty build", () => {
    expect(timelinePositions([])).toEqual([]);
    expect(timelinePositions()).toEqual([]);
  });

  it("centres a single item", () => {
    const [only] = timelinePositions([600]);
    expect(only).toBeCloseTo((TIMELINE_START + TIMELINE_END) / 2, 5);
  });

  it("spreads a real build over most of the track", () => {
    const positions = timelinePositions(REAL_BUILD);
    // A 0..latest axis would put 7:42 at 32% and leave the first third empty, so
    // the icons must cover the bulk of the track instead.
    expect(positions[positions.length - 1] - positions[0]).toBeGreaterThan(75);
  });

  it("scales with the data range, so a short build fills the track", () => {
    // Same shape with the times divided by ten: the positions must not move.
    const scaled = timelinePositions([46.2, 142.9]);
    const original = timelinePositions([462, 1429]);
    scaled.forEach((position, index) => expect(position).toBeCloseTo(original[index], 6));
  });

  it("keeps every icon inside the track, in ascending order", () => {
    const positions = timelinePositions(REAL_BUILD);
    expect(positions).toHaveLength(REAL_BUILD.length);
    positions.forEach((position) => {
      expect(position).toBeGreaterThanOrEqual(TIMELINE_START);
      expect(position).toBeLessThanOrEqual(TIMELINE_END);
    });
    expect(gaps(positions).every((gap) => gap > 0)).toBe(true);
  });

  it("separates items that are seconds apart", () => {
    const positions = timelinePositions(REAL_BUILD);
    // 16:52 and 17:01 are nine seconds apart — without the gap pass their icons
    // and labels would sit on top of each other.
    gaps(positions).forEach((gap) => expect(gap).toBeGreaterThanOrEqual(TIMELINE_MIN_GAP - 1e-9));
  });

  it("splits identical times instead of stacking them", () => {
    const positions = timelinePositions([500, 500, 500]);
    expect(new Set(positions).size).toBe(3);
    expect(gaps(positions).every((gap) => gap >= TIMELINE_MIN_GAP - 1e-9)).toBe(true);
  });

  it("compresses a build that is denser than the track rather than stacking it", () => {
    // Five quick pickups and a late outlier: the gap pass cannot fit at full
    // width, so the spacing shrinks — but nothing overlaps or leaves the track.
    const dense = timelinePositions([100, 101, 102, 1000, 1001, 1002]);
    expect(dense[dense.length - 1]).toBeCloseTo(TIMELINE_END, 5);
    expect(dense[0]).toBeGreaterThanOrEqual(TIMELINE_START);
    expect(gaps(dense).every((gap) => gap > 0)).toBe(true);
  });

  it("accepts a custom minimum gap", () => {
    // Six items at 16% need 80% of the 90% track, so the gap holds. A wider gap
    // than the track can seat is compressed instead (tested above).
    const wide = timelinePositions(REAL_BUILD, { minGap: 16 });
    expect(gaps(wide).every((gap) => gap >= 16 - 1e-9)).toBe(true);
  });

  it("treats unparseable times as the earliest slot", () => {
    const [missing, real] = timelinePositions([null, 900]);
    expect(missing).toBeLessThan(real);
    expect(missing).toBeGreaterThanOrEqual(TIMELINE_START);
  });
});
