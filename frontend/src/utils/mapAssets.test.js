import { describe, expect, it } from "vitest";
import MAP_ASSETS from "../data/mapAssets.json";
import { MAP_RADIUS } from "./matchMap";
import {
  OBJECTIVE_ICON_FILL,
  OBJECTIVE_ICONS,
  OBJECTIVE_MARKER_SIZE,
  mapFurniture,
  objectiveIconPath,
  objectiveMarkers,
  ziplinesFor,
} from "./mapAssets";
import { LANING_T1_BY_LANE } from "./laningTab";

/** A destruction as the timeline model reports it: `team` is the destroyer. */
const destruction = (objectiveId, team, timeS) => ({ objectiveId, team, timeS });

describe("vendored map assets", () => {
  it("describes the same world space as the rest of the maps", () => {
    expect(MAP_ASSETS.version).toBe("post_cns");
    expect(MAP_ASSETS.radius).toBe(MAP_RADIUS);
  });

  it("carries one zipline per lane, each a path inside the frame", () => {
    expect(MAP_ASSETS.ziplines.map((zipline) => zipline.lane)).toEqual([1, 4, 6]);
    for (const zipline of MAP_ASSETS.ziplines) {
      expect(zipline.path.startsWith("M")).toBe(true);
      expect(zipline.color).toMatch(/^#[0-9a-f]{6}$/);
      const coords = zipline.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      // A spline may start just outside the playfield; anything further is a bug.
      expect(Math.min(...coords)).toBeGreaterThan(-5);
      expect(Math.max(...coords)).toBeLessThan(105);
    }
  });

  it("positions both sides of every objective the game reports", () => {
    // 8 per side from the API, plus two base-guardian structures per lane and shrines.
    expect(MAP_ASSETS.objectives).toHaveLength(26);
    for (const objective of MAP_ASSETS.objectives) {
      expect(objective.key.startsWith(`team${objective.team}_`), objective.key).toBe(true);
      expect(objective.positions.length).toBeGreaterThanOrEqual(1);
      for (const [left, top] of objective.positions) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(100);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(100);
      }
    }
  });

  it("places the two base guardians of each lane as one objective", () => {
    const bases = MAP_ASSETS.objectives.filter((objective) => objective.tier === "base");
    expect(bases).toHaveLength(6);
    for (const base of bases) {
      expect(base.positions).toHaveLength(2);
      expect([12, 14, 15]).toContain(base.objectiveId);
      expect([1, 4, 6]).toContain(base.lane);
    }
    expect(new Set(bases.map((base) => base.objectiveId))).toEqual(new Set([12, 14, 15]));
  });

  it("places one shrine per team per outer lane, as ids 10 and 11", () => {
    const shrines = MAP_ASSETS.objectives.filter((objective) => objective.tier === "shrine");
    expect(shrines).toHaveLength(4);
    for (const shrine of shrines) {
      expect(shrine.positions).toHaveLength(1);
      expect([10, 11]).toContain(shrine.objectiveId);
    }
    // Each team owns one of each id, so a row lands on the right structure.
    for (const team of [0, 1]) {
      const ids = shrines.filter((shrine) => shrine.team === team).map((shrine) => shrine.objectiveId);
      expect(ids.sort()).toEqual([10, 11]);
    }
  });

  it("agrees with the site's lane slots for the tier 1 guardians", () => {
    // The laning tab maps a lane to its guardian's objective id; the asset must
    // place that same objective on that lane.
    for (const [lane, objectiveId] of Object.entries(LANING_T1_BY_LANE)) {
      const placed = MAP_ASSETS.objectives.filter(
        (objective) => objective.objectiveId === objectiveId,
      );
      expect(placed, `lane ${lane}`).toHaveLength(2);
      expect(placed.every((objective) => objective.lane === Number(lane))).toBe(true);
    }
  });
});

describe("mapFurniture", () => {
  it("has icon art and a measured fill for every tier the geometry places", () => {
    const tiers = new Set(MAP_ASSETS.objectives.map((objective) => objective.tier));
    expect(Object.keys(OBJECTIVE_ICONS).sort()).toEqual([...tiers].sort());
    expect(Object.keys(OBJECTIVE_ICON_FILL).sort()).toEqual([...tiers].sort());
    for (const tier of tiers) {
      expect(objectiveIconPath(tier)).toMatch(/^mapHud\/objectives\/[a-z_]+\.png$/);
      expect(OBJECTIVE_MARKER_SIZE[tier]).toBeGreaterThan(0);
      expect(OBJECTIVE_ICON_FILL[tier]).toBeGreaterThan(0.1);
      expect(OBJECTIVE_ICON_FILL[tier]).toBeLessThanOrEqual(1);
    }
    expect(objectiveIconPath("nope")).toBeNull();
  });

  it("is only drawn on the layout it was surveyed for", () => {
    expect(mapFurniture("post_cns")).toBe(MAP_ASSETS);
    expect(mapFurniture(null)).toBe(MAP_ASSETS);
    expect(mapFurniture("pre_cns")).toBeNull();
  });

  it("withholds the ziplines with it", () => {
    expect(ziplinesFor("post_cns")).toHaveLength(3);
    expect(ziplinesFor("pre_cns")).toEqual([]);
  });
});

describe("objectiveMarkers", () => {
  it("stands every structure up with no destructions", () => {
    const markers = objectiveMarkers({ version: "post_cns" });
    // 26 objectives, but each lane's base-guardian pair is two structures.
    expect(markers).toHaveLength(32);
    expect(markers.every((marker) => marker.fallen === false && marker.timeS === null)).toBe(true);
  });

  it("drops a shrine when its own id falls, and only that team's", () => {
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [destruction(11, 1, 1800)],
      t: 1900,
    });
    const shrines = markers.filter((marker) => marker.tier === "shrine");
    expect(shrines).toHaveLength(4);
    const fallen = shrines.filter((marker) => marker.fallen);
    expect(fallen).toHaveLength(1);
    expect(fallen[0].team).toBe(1);
    expect(fallen[0].objectiveId).toBe(11);
  });

  it("drops both of a lane's base guardians when their one objective falls", () => {
    // Base guardians share objective id 12 with one row per side, so a pair falls together.
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [destruction(12, 0, 1200)],
      t: 1500,
    });
    const base = markers.filter((marker) => marker.objectiveId === 12 && marker.team === 0);
    expect(base).toHaveLength(2);
    expect(base.every((marker) => marker.fallen && marker.timeS === 1200)).toBe(true);
    expect(base[0].id).not.toBe(base[1].id);
  });

  it("knocks down the objective the row names as owner", () => {
    // Amber (team 0) lost lane 1's tier 1 guardian: the marker on Amber's side falls.
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [destruction(LANING_T1_BY_LANE[1], 0, 600)],
      t: 900,
    });
    const fallen = markers.filter((marker) => marker.fallen);
    expect(fallen).toHaveLength(1);
    expect(fallen[0].team).toBe(0);
    expect(fallen[0].lane).toBe(1);
    expect(fallen[0].label).toBe("Guardian");
    expect(fallen[0].timeS).toBe(600);
  });

  it("keeps an objective standing until the clock reaches its fall", () => {
    const objectives = [destruction(0, 1, 2400)];
    const before = objectiveMarkers({ version: "post_cns", objectives, t: 2399 });
    expect(before.every((marker) => marker.fallen === false)).toBe(true);

    const after = objectiveMarkers({ version: "post_cns", objectives, t: 2400 });
    const core = after.filter((marker) => marker.tier === "core" && marker.team === 1);
    expect(core).toHaveLength(1);
    expect(core[0].fallen).toBe(true);
  });

  it("shows the end of the match when there is no clock", () => {
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [destruction(0, 1, 1500)],
      t: null,
    });
    expect(markers.find((marker) => marker.tier === "core" && marker.team === 1).fallen).toBe(true);
  });

  it("takes the earliest time when the same objective is reported twice", () => {
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [destruction(3, 0, 900), destruction(3, 0, 700)],
      t: 800,
    });
    const guardian = markers.find((marker) => marker.objectiveId === 3 && marker.team === 0);
    expect(guardian.timeS).toBe(700);
    expect(guardian.fallen).toBe(true);
  });

  it("ignores rows it cannot place", () => {
    const markers = objectiveMarkers({
      version: "post_cns",
      objectives: [
        { objectiveId: null, team: 0, timeS: 100 },
        { objectiveId: 2, team: 0, timeS: 100 }, // lane slot with no position
        { objectiveId: 13, team: 1, timeS: 100 }, // second-slot barrack: no position
        destruction(1, 7, 100), // not a side
        destruction(1, 0, 0), // never destroyed
        destruction(1, 0, null),
      ],
      t: 900,
    });
    expect(markers.every((marker) => marker.fallen === false)).toBe(true);
  });

  it("draws nothing on the older layout", () => {
    expect(objectiveMarkers({ version: "pre_cns", t: 900 })).toEqual([]);
  });
});
