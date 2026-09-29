import { describe, expect, it } from "vitest";
import {
  axisLabels,
  gameResult,
  recordOf,
  sameTeam,
  seriesGroups,
  teamWeekRange,
  tenureCells,
  tenureSummary,
} from "./team";

const MATCH = {
  match_id: 1,
  event_team_a: "Poppers' Pupils",
  event_team_b: "Melee Creeps",
  event_title: "Night Shift",
  event_week: 57,
  event_team_a_ingame_side: 0,
  winning_team: 0,
  duration_s: 1800,
  start_time: "2026-09-13T10:00:00Z",
};

const match = (overrides = {}) => ({ ...MATCH, ...overrides });

describe("sameTeam", () => {
  it("ignores case and missing values", () => {
    expect(sameTeam("MELEE CREEPS", "Melee Creeps")).toBe(true);
    expect(sameTeam(null, undefined)).toBe(true);
    expect(sameTeam("a", "b")).toBe(false);
  });
});

describe("gameResult", () => {
  it("reads the result from the player's side of the winner", () => {
    // Team A (side 0) won.
    expect(gameResult(match(), "Poppers' Pupils")).toBe(true);
    expect(gameResult(match(), "Melee Creeps")).toBe(false);
  });

  it("is unknown when the side or the winner is missing", () => {
    expect(gameResult(match({ event_team_a_ingame_side: null }), "Poppers' Pupils")).toBeNull();
    expect(gameResult(match({ winning_team: null }), "Poppers' Pupils")).toBeNull();
  });

  it("tolerates a null match", () => {
    expect(gameResult(null, "Poppers' Pupils")).toBeNull();
  });
});

describe("recordOf", () => {
  it("colours only the number that decided the record", () => {
    expect(recordOf(22, 12)).toMatchObject({
      winsTone: "text-success",
      lossesTone: "text-secondary",
      pct: "65%",
    });
    expect(recordOf(12, 22)).toMatchObject({
      winsTone: "text-secondary",
      lossesTone: "text-danger-text",
      pct: "35%",
    });
  });

  it("stays neutral on a level record", () => {
    const level = recordOf(9, 9);
    expect(level.winsTone).toBe("text-secondary");
    expect(level.lossesTone).toBe("text-secondary");
    expect(level.pct).toBe("50%");
    expect(level.barPct).toBe(50);
  });

  it("has no percentage before anything is decided", () => {
    expect(recordOf(0, 0)).toMatchObject({ played: false, pct: null, barPct: 0 });
    expect(recordOf(null, null)).toMatchObject({ wins: 0, losses: 0, played: false });
  });
});

describe("seriesGroups", () => {
  const team = "Poppers' Pupils";

  it("groups by matchup within a week and keeps weeks newest first", () => {
    const weeks = seriesGroups(
      [
        match({ match_id: 3, event_week: 57, start_time: "2026-09-13T12:00:00Z" }),
        match({ match_id: 2, event_week: 57, start_time: "2026-09-13T10:00:00Z" }),
        match({
          match_id: 1,
          event_week: 56,
          event_team_b: "Leviathan",
          start_time: "2026-09-06T10:00:00Z",
        }),
      ],
      team,
    );

    expect(weeks.map((w) => w.week)).toEqual([57, 56]);
    expect(weeks[0].items).toHaveLength(1);
    expect(weeks[0].items[0].games.map((g) => g.match_id)).toEqual([2, 3]);
    expect(weeks[1].items[0].opponent).toBe("Leviathan");
  });

  it("names the opponent from the other side of the fixture", () => {
    const [week] = seriesGroups([match()], "Melee Creeps");
    expect(week.items[0].opponent).toBe("Poppers' Pupils");
  });

  it("splits two matchups in the same week into two series", () => {
    const weeks = seriesGroups(
      [
        match({ match_id: 2, event_week: 57, start_time: "2026-09-13T13:00:00Z" }),
        match({
          match_id: 1,
          event_week: 57,
          event_team_b: "BKB",
          start_time: "2026-09-13T11:00:00Z",
        }),
      ],
      "Poppers' Pupils",
    );

    expect(weeks).toHaveLength(1);
    expect(weeks[0].items).toHaveLength(2);
    expect(weeks[0].items.map((s) => s.opponent)).toEqual(["Melee Creeps", "BKB"]);
  });

  it("averages only the games that have a duration", () => {
    const [week] = seriesGroups(
      [
        match({ match_id: 2, duration_s: 1200, start_time: "2026-09-13T11:00:00Z" }),
        match({ match_id: 1, duration_s: null, start_time: "2026-09-13T10:00:00Z" }),
      ],
      "Poppers' Pupils",
    );

    expect(week.items[0].avgSeconds).toBe(1200);
  });

  it("falls back to reversing the input order when start_time is missing", () => {
    // Input is newest first, so reversing it restores game 1 → game 2.
    const [week] = seriesGroups(
      [
        match({ match_id: 2, start_time: null }),
        match({ match_id: 1, start_time: null }),
      ],
      "Poppers' Pupils",
    );

    expect(week.items[0].games.map((g) => g.match_id)).toEqual([1, 2]);
  });

  it("counts the series record from the page team's point of view", () => {
    const [week] = seriesGroups(
      [
        match({ match_id: 2, winning_team: 1, start_time: "2026-09-13T11:00:00Z" }),
        match({ match_id: 1, winning_team: 0, start_time: "2026-09-13T10:00:00Z" }),
      ],
      "Poppers' Pupils",
    );

    expect(week.items[0]).toMatchObject({ wins: 1, losses: 1 });
  });

  it("returns nothing for an empty list", () => {
    expect(seriesGroups([], "Poppers' Pupils")).toEqual([]);
  });
});

describe("teamWeekRange", () => {
  it("spans the weeks the team actually played", () => {
    expect(
      teamWeekRange([match({ event_week: 51 }), match({ event_week: 44 }), match({})]),
    ).toEqual({ first: 44, last: 57 });
  });

  it("ignores matches with no week (pre-season)", () => {
    expect(teamWeekRange([match({ event_week: null })])).toEqual({ first: null, last: null });
    expect(teamWeekRange([])).toEqual({ first: null, last: null });
  });
});

describe("tenureCells", () => {
  it("marks every axis week as rostered or not", () => {
    expect(tenureCells([44, 46], [44, 45, 46])).toEqual([
      { week: 44, rostered: true },
      { week: 45, rostered: false },
      { week: 46, rostered: true },
    ]);
  });

  it("ignores weeks the player has but the axis does not", () => {
    expect(tenureCells([99], [44])).toEqual([{ week: 44, rostered: false }]);
  });
});

describe("axisLabels", () => {
  it("labels every third week plus the last one", () => {
    const labels = axisLabels([44, 45, 46, 47]);
    expect([...labels]).toEqual([44, 47]);
  });

  it("always states the end of the axis", () => {
    const labels = axisLabels([1, 2, 3, 4, 5, 6, 7]);
    expect(labels.has(7)).toBe(true);
  });

  it("copes with an empty axis", () => {
    expect(axisLabels([]).size).toBe(0);
  });
});

describe("tenureSummary", () => {
  it("reads as span, weeks rostered and games", () => {
    expect(tenureSummary({ first: 44, last: 58, weeks: 15, games: 34 })).toBe("NS 44–58 · 15 wk · 34 g");
  });

  it("collapses a single week", () => {
    expect(tenureSummary({ first: 52, last: 52, weeks: 1, games: 7 })).toBe("NS 52 · 1 wk · 7 g");
  });

  it("omits the parts it has no data for", () => {
    expect(tenureSummary({ first: 44, last: 58, weeks: 15, games: null })).toBe("NS 44–58 · 15 wk");
    expect(tenureSummary({ first: null, last: null })).toBeNull();
  });
});
