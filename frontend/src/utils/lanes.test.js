import { describe, expect, it } from "vitest";
import { AMBER, SAPPHIRE, WIN, LOSS, UNKNOWN } from "./playerStats";
import { LANE_META, LANE_ORDER, UNKNOWN_LANE, laneBreakdown, laneMeta, playerLane } from "./lanes";

const match = (overrides = {}) => ({
  match_id: 1,
  team: AMBER,
  winning_team: AMBER,
  result: "Win",
  lane: 4,
  lane_real: null,
  ...overrides,
});

describe("laneMeta / playerLane", () => {
  it("maps the 1/4/6 encoding to the lane names", () => {
    expect(LANE_ORDER).toEqual([1, 4, 6]);
    expect(laneMeta(1).name).toBe("York");
    expect(laneMeta(4).name).toBe("Broadway");
    expect(laneMeta(6).name).toBe("Greenwich");
    expect(laneMeta("6").name).toBe("Greenwich");
  });

  it("has no colour for an unknown lane", () => {
    expect(laneMeta(null)).toBeNull();
    expect(laneMeta(3)).toBeNull();
    expect(UNKNOWN_LANE.color).toBeNull();
  });

  it("prefers the inferred lane over the assigned one", () => {
    expect(playerLane(match({ lane: 4, lane_real: 6 }))).toBe(6);
    expect(playerLane(match({ lane: 4, lane_real: null }))).toBe(4);
    expect(playerLane(match({ lane: null, lane_real: null }))).toBeNull();
    expect(playerLane(undefined)).toBeNull();
  });
});

describe("laneBreakdown", () => {
  const rows = [
    match({ match_id: 1, lane_real: 1 }),
    match({ match_id: 2, lane_real: 1 }),
    match({ match_id: 3, lane_real: 4, team: SAPPHIRE, winning_team: AMBER }),
    match({ match_id: 4, lane_real: 6 }),
    // No lane recorded at all: neither the inferred nor the assigned value exists.
    match({ match_id: 5, lane: null, lane_real: null, team: null, winning_team: null, result: null }),
  ];
  const { rows: lanes, total } = laneBreakdown(rows);
  const byName = Object.fromEntries(lanes.map((lane) => [lane.name, lane]));

  it("counts games and share per lane in reading order", () => {
    expect(total).toBe(5);
    expect(lanes.map((lane) => lane.name)).toEqual(["York", "Broadway", "Greenwich", "Unknown"]);
    expect(byName.York.games).toBe(2);
    expect(byName.Greenwich.games).toBe(1);
    expect(byName.Broadway.games).toBe(1);
    expect(byName.Unknown.games).toBe(1);
    expect(byName.York.share).toBeCloseTo(0.4);
  });

  it("computes the win rate from decided games only", () => {
    expect(byName.York.winRate).toBe(1);
    expect(byName.Broadway.winRate).toBe(0);  // the lane 4 game is a loss
    // The unrecorded game has no result, so it cannot produce a rate.
    expect(byName.Unknown.winRate).toBeNull();
  });

  it("always lists all four lanes, even at zero", () => {
    const empty = laneBreakdown([]);
    expect(empty.total).toBe(0);
    expect(empty.rows).toHaveLength(4);
    empty.rows.forEach((lane) => {
      expect(lane.games).toBe(0);
      expect(lane.share).toBeNull();
      expect(lane.winRate).toBeNull();
    });
  });

  it("keeps lane colours for real lanes and none for the unknown row", () => {
    expect(byName.York.color).toBe(LANE_META[1].color);
    expect(byName.Unknown.color).toBeNull();
  });

  it("counts an unrecognised lane id as unknown rather than dropping it", () => {
    const { rows: only } = laneBreakdown([match({ lane: 9, lane_real: null })]);
    expect(only.find((lane) => lane.name === "Unknown").games).toBe(1);
  });

  it("treats a win, a loss and an unknown consistently", () => {
    const mixed = laneBreakdown([
      match({ match_id: 1, lane: 1, team: AMBER, winning_team: AMBER }),
      match({ match_id: 2, lane: 1, team: AMBER, winning_team: SAPPHIRE }),
      match({ match_id: 3, lane: 1, team: null, winning_team: null, result: null }),
    ]).rows[0];
    expect(mixed.wins).toBe(1);
    expect(mixed.losses).toBe(1);
    expect(mixed.decided).toBe(2);
    expect(mixed.winRate).toBe(0.5);
    expect(mixed.games).toBe(3);
  });
});

describe("lane constants", () => {
  it("keeps the game's colour for each lane", () => {
    expect(LANE_META[1].color).toBe("#facc15");  // yellow
    expect(LANE_META[4].color).toBe("#22d3ee");  // blue
    expect(LANE_META[6].color).toBe("#4ade80");  // green
  });

  it("has outcome codes that match the rest of the app", () => {
    expect([WIN, LOSS, UNKNOWN]).toEqual(["W", "L", "U"]);
  });
});
