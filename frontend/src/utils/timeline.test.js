import { describe, expect, it } from "vitest";
import {
  isActivePlayer,
  lineupsByWeek,
  orderTimelineRows,
  playedWeeks,
  spanPercentages,
  toSegments,
  weekColumns,
} from "./timeline";

describe("weekColumns", () => {
  it("maps weeks to their column index", () => {
    const columns = weekColumns([47, 48, 50]);
    expect(columns.get(47)).toBe(0);
    expect(columns.get(48)).toBe(1);
    expect(columns.get(50)).toBe(2);
  });

  it("handles an empty axis", () => {
    expect(weekColumns([]).size).toBe(0);
    expect(weekColumns().size).toBe(0);
  });
});

describe("toSegments", () => {
  it("returns nothing for a player with no weeks", () => {
    expect(toSegments([], [47, 48])).toEqual([]);
    expect(toSegments([47], [])).toEqual([]);
  });

  it("gives a single week a single one-wide segment", () => {
    expect(toSegments([47], [47, 48, 49])).toEqual([{ start: 0, span: 1 }]);
  });

  it("merges consecutive weeks into one segment", () => {
    expect(toSegments([47, 48, 49], [47, 48, 49, 50])).toEqual([
      { start: 0, span: 3 },
    ]);
  });

  it("splits a bar on a real absence", () => {
    // Played 47, sat out 48, played 49.
    expect(toSegments([47, 49], [47, 48, 49])).toEqual([
      { start: 0, span: 1 },
      { start: 2, span: 1 },
    ]);
  });

  it("does NOT split a bar across a league bye week", () => {
    // Week 49 is missing from the axis entirely, so 48 and 50 are neighbours.
    const weeks = [47, 48, 50, 51];
    expect(toSegments([48, 50], weeks)).toEqual([{ start: 1, span: 2 }]);
  });

  it("ignores weeks that are not on the axis", () => {
    expect(toSegments([1, 999], [47, 48])).toEqual([]);
    expect(toSegments([1, 47], [47, 48])).toEqual([{ start: 0, span: 1 }]);
  });

  it("de-duplicates repeated weeks", () => {
    expect(toSegments([47, 47, 47], [47, 48])).toEqual([{ start: 0, span: 1 }]);
  });

  it("orders segments left to right regardless of input order", () => {
    expect(toSegments([51, 47], [47, 48, 51])).toEqual([
      { start: 0, span: 1 },
      { start: 2, span: 1 },
    ]);
  });

  it("covers the whole axis for a full-tenure player", () => {
    const weeks = [47, 48, 50];
    expect(toSegments([47, 48, 50], weeks)).toEqual([{ start: 0, span: 3 }]);
  });
});

describe("playedWeeks", () => {
  it("returns the played weeks in axis order", () => {
    expect(playedWeeks([50, 47], [47, 48, 50])).toEqual([47, 50]);
  });

  it("returns nothing when nothing was played", () => {
    expect(playedWeeks([], [47, 48])).toEqual([]);
  });
});

describe("isActivePlayer", () => {
  it("treats everyone as active when there is no latest week", () => {
    expect(isActivePlayer({ last_week: 40 }, null)).toBe(true);
    expect(isActivePlayer({ last_week: 40 }, undefined)).toBe(true);
  });

  it("is active only when the latest week matches", () => {
    expect(isActivePlayer({ last_week: 57 }, 57)).toBe(true);
    expect(isActivePlayer({ last_week: 54 }, 57)).toBe(false);
  });
});

describe("lineupsByWeek", () => {
  const rows = [
    { name: "amy", played: [47, 48], active: true },
    { name: "zed", played: [48, 50], active: true },
    { name: "old", played: [47], active: false },
  ];

  it("groups players per week in row order", () => {
    const lineups = lineupsByWeek(rows);
    expect(lineups.get(47).map((r) => r.name)).toEqual(["amy", "old"]);
    expect(lineups.get(48).map((r) => r.name)).toEqual(["amy", "zed"]);
    expect(lineups.get(50).map((r) => r.name)).toEqual(["zed"]);
  });

  it("omits weeks nobody played, so a gap is distinguishable", () => {
    const lineups = lineupsByWeek(rows);
    expect(lineups.has(49)).toBe(false);
    expect(lineups.get(49)).toBeUndefined();
  });

  it("handles empty and missing input", () => {
    expect(lineupsByWeek([]).size).toBe(0);
    expect(lineupsByWeek().size).toBe(0);
    expect(lineupsByWeek([{ name: "x" }]).size).toBe(0);
  });

  it("orders each lineup by row order, not by week order", () => {
    const lineups = lineupsByWeek([
      { name: "first", played: [50, 47] },
      { name: "second", played: [47] },
    ]);
    expect(lineups.get(47).map((r) => r.name)).toEqual(["first", "second"]);
    expect(lineups.get(50).map((r) => r.name)).toEqual(["first"]);
  });
});

describe("spanPercentages", () => {
  const league = Array.from({ length: 10 }, (_, i) => i + 1); // weeks 1..10

  it("spans the whole strip for a founding team", () => {
    const s = spanPercentages(1, 10, league);
    expect(s.startPct).toBe(0);
    expect(s.widthPct).toBe(100);
    expect(s.weeks).toBe(10);
    expect(s.total).toBe(10);
  });

  it("sits at the right edge for a newcomer", () => {
    const s = spanPercentages(8, 10, league);
    expect(s.startPct).toBe(70);
    expect(s.widthPct).toBe(30);
    expect(s.weeks).toBe(3);
  });

  it("sits at the left edge for a team that disbanded early", () => {
    const s = spanPercentages(1, 2, league);
    expect(s.startPct).toBe(0);
    expect(s.widthPct).toBe(20);
  });

  it("covers a single week", () => {
    const s = spanPercentages(5, 5, league);
    expect(s.startPct).toBe(40);
    expect(s.widthPct).toBe(10);
    expect(s.weeks).toBe(1);
  });

  it("uses ordinals, so a bye week does not distort the width", () => {
    // League weeks 1,2,3,5,6 -> weeks 5..6 are 2 of 5 slots = 40% at 60%.
    const gapped = [1, 2, 3, 5, 6];
    const s = spanPercentages(5, 6, gapped);
    expect(s.startPct).toBe(60);
    expect(s.widthPct).toBe(40);
    expect(s.weeks).toBe(2);
  });

  it("treats weeks missing from the league list defensively", () => {
    const s = spanPercentages(99, 100, league);
    expect(s.startPct).toBe(0);
    expect(s.widthPct).toBe(100);
  });

  it("returns an empty span for empty inputs", () => {
    expect(spanPercentages(1, 10, []).widthPct).toBe(0);
    expect(spanPercentages(null, 10, league).widthPct).toBe(0);
    expect(spanPercentages(1, null, league).widthPct).toBe(0);
  });
});

describe("orderTimelineRows", () => {
  const players = [
    { account_id: 1, persona_name: "alumni high", appearances: 90, last_week: 50 },
    { account_id: 2, persona_name: "zed", appearances: 10, last_week: 57 },
    { account_id: 3, persona_name: "amy", appearances: 10, last_week: 57 },
    { account_id: 4, persona_name: "alumni low", appearances: 5, last_week: 31 },
  ];

  it("puts the active roster first, then alumni, each by games then name", () => {
    expect(orderTimelineRows(players, 57).map((p) => p.account_id)).toEqual([
      3, 2, 1, 4,
    ]);
  });

  it("keeps everyone when there is no latest week", () => {
    expect(orderTimelineRows(players, null)).toHaveLength(4);
  });

  it("does not mutate the input array", () => {
    const input = [...players];
    orderTimelineRows(input, 57);
    expect(input.map((p) => p.account_id)).toEqual([1, 2, 3, 4]);
  });

  it("handles missing names and games", () => {
    const rows = orderTimelineRows(
      [{ account_id: 1, last_week: 57 }, { account_id: 2, last_week: 57 }],
      57,
    );
    expect(rows).toHaveLength(2);
  });
});
