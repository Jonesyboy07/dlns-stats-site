import { describe, expect, it } from "vitest";
import {
  LANING_END_S,
  firstSnapshot,
  laneMatchups,
  snapshotAt,
  soulsAt,
  statDelta,
} from "./laning";

const snap = (time_stamp_s, overrides = {}) => ({
  time_stamp_s,
  net_worth: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  player_damage: 0,
  player_healing: 0,
  ...overrides,
});

const player = (overrides = {}) => ({
  account_id: 1,
  player_slot: 1,
  team: 0,
  lane: 1,
  lane_real: null,
  ...overrides,
});

describe("firstSnapshot / snapshotAt", () => {
  it("finds the earliest snapshot regardless of array order", () => {
    const late = snap(600);
    const early = snap(0);
    expect(firstSnapshot([late, early])).toBe(early);
  });

  it("returns null when no snapshot carries a usable time", () => {
    expect(firstSnapshot([])).toBeNull();
    expect(firstSnapshot([snap(null), snap(undefined)])).toBeNull();
  });

  it("takes the latest snapshot at or before the requested second", () => {
    const snapshots = [snap(0), snap(300), snap(600), snap(900)];
    expect(snapshotAt(snapshots, 600).time_stamp_s).toBe(600);
    expect(snapshotAt(snapshots, 599).time_stamp_s).toBe(300);
    expect(snapshotAt(snapshots, 0).time_stamp_s).toBe(0);
  });

  it("returns null when the timeline does not reach back that far", () => {
    expect(snapshotAt([snap(300), snap(600)], 120)).toBeNull();
  });
});

describe("soulsAt / statDelta", () => {
  it("reads souls at the milestone", () => {
    const snapshots = [snap(0, { net_worth: 500 }), snap(300, { net_worth: 2000 })];
    expect(soulsAt(snapshots, 300)).toBe(2000);
    expect(soulsAt(snapshots, LANING_END_S)).toBe(2000);
  });

  it("reports null souls before the first snapshot", () => {
    expect(soulsAt([snap(300, { net_worth: 2000 })], 120)).toBeNull();
    expect(soulsAt([], 300)).toBeNull();
  });

  it("measures a stat's climb from the first snapshot", () => {
    const snapshots = [snap(120, { kills: 1, player_damage: 100 }), snap(600, { kills: 3, player_damage: 900 })];
    expect(statDelta(snapshots, 600, "kills")).toBe(2);
    expect(statDelta(snapshots, 600, "player_damage")).toBe(800);
  });

  it("never returns a negative delta and is null without an endpoint", () => {
    const snapshots = [snap(0, { kills: 3 }), snap(600, { kills: 1 })];
    expect(statDelta(snapshots, 600, "kills")).toBe(0);
    expect(statDelta([snap(600, { kills: 3 })], 120, "kills")).toBeNull();
  });
});

describe("laneMatchups", () => {
  const players = [
    player({ account_id: 1, player_slot: 5, team: 0, lane_real: 1 }),
    player({ account_id: 2, player_slot: 2, team: 0, lane: 1, lane_real: 1 }),
    player({ account_id: 3, player_slot: 7, team: 1, lane: 1 }),
    player({ account_id: 4, player_slot: 3, team: 0, lane: 4 }),
    player({ account_id: 5, player_slot: 9, team: 1, lane: null, lane_real: null }),
  ];
  const { rows, unassigned } = laneMatchups(players);

  it("lists every lane in reading order", () => {
    expect(rows.map((row) => row.lane)).toEqual([1, 4, 6]);
  });

  it("splits a lane by team and orders each side by slot", () => {
    const york = rows.find((row) => row.lane === 1);
    expect(york.left.map((p) => p.account_id)).toEqual([2, 1]);
    expect(york.right.map((p) => p.account_id)).toEqual([3]);
  });

  it("prefers the inferred lane over the assigned one", () => {
    const ambiguous = [player({ account_id: 9, lane: 4, lane_real: 6 })];
    expect(laneMatchups(ambiguous).rows.find((row) => row.lane === 6).left).toHaveLength(1);
  });

  it("counts players with no lane instead of dropping them silently", () => {
    expect(unassigned).toBe(1);
  });

  it("keeps empty lanes so the three boards stay comparable", () => {
    const { rows: only } = laneMatchups([player({ lane: 4 })]);
    expect(only.find((row) => row.lane === 6).left).toEqual([]);
  });
});

describe("tolerance to missing or malformed input", () => {
  it("treats a non-array where a list is expected as empty instead of throwing", () => {
    // A wrong argument (e.g. a snapshots getter returning the stats object) must not
    // take the page down; it degrades to "unknown".
    expect(snapshotAt({ souls: 1 }, 300)).toBeNull();
    expect(firstSnapshot(undefined)).toBeNull();
    expect(soulsAt(null, 300)).toBeNull();
  });

  it("keeps the empty lane rows when players is not a list", () => {
    expect(laneMatchups(undefined).rows.map((row) => row.lane)).toEqual([1, 4, 6]);
  });
});
