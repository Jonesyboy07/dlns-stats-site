import { describe, expect, it } from "vitest";
import { buildWeekGroups, formatWeekDate } from "./seriesGroups";

const match = (overrides = {}) => ({
  match_id: 1,
  winning_team: 0,
  event_team_a_ingame_side: 0,
  start_time: "2026-08-01T18:00:00+00:00",
  created_at: "2026-08-01T18:05:00+00:00",
  ...overrides,
});

const detail = (overrides = {}) => ({
  week: 61,
  series: "Night Shift",
  series_title: "FINALS",
  team_a: "Poppers' Pupils",
  team_b: "Bird With Clock",
  match_vod: "",
  ...overrides,
});

describe("formatWeekDate", () => {
  it("formats as day month year", () => {
    expect(formatWeekDate("2026-08-01T18:00:00+00:00")).toBe("1 Aug 2026");
  });

  it("returns null for missing or unparseable input", () => {
    expect(formatWeekDate(null)).toBeNull();
    expect(formatWeekDate(undefined)).toBeNull();
    expect(formatWeekDate("")).toBeNull();
    expect(formatWeekDate("not-a-date")).toBeNull();
  });

  it("resolves in UTC so a late game keeps its date", () => {
    // 23:30 UTC on the 1st is already the 2nd in UTC+1; the label must not drift.
    expect(formatWeekDate("2026-08-01T23:30:00+00:00")).toBe("1 Aug 2026");
  });
});

describe("buildWeekGroups", () => {
  it("merges the games of one fixture into a single series", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1 }), match({ match_id: 2 })],
      { 1: detail(), 2: detail() },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].week).toBe(61);
    expect(groups[0].totalSeries).toBe(1);
    expect(groups[0].entries[0].games).toEqual([
      { matchId: 1, game: 1 },
      { matchId: 2, game: 2 },
    ]);
  });

  it("counts wins for team A using the side team A played on", () => {
    const groups = buildWeekGroups(
      [
        match({ match_id: 1, event_team_a_ingame_side: 1, winning_team: 1 }),
        match({ match_id: 2, event_team_a_ingame_side: 1, winning_team: 1 }),
      ],
      { 1: detail(), 2: detail() },
    );

    expect(groups[0].entries[0].wins_a).toBe(2);
    expect(groups[0].entries[0].wins_b).toBe(0);
  });

  it("awards the win to team B when the other side wins", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1, event_team_a_ingame_side: 1, winning_team: 0 })],
      { 1: detail() },
    );

    expect(groups[0].entries[0].wins_a).toBe(0);
    expect(groups[0].entries[0].wins_b).toBe(1);
  });

  it("assumes side 0 when the in-game side is missing", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1, event_team_a_ingame_side: null, winning_team: 0 })],
      { 1: detail() },
    );

    expect(groups[0].entries[0].wins_a).toBe(1);
  });

  it("ignores matches that have no details entry or no week", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1 }), match({ match_id: 99 }), match({ match_id: 2 })],
      { 1: detail(), 2: detail({ week: null }) },
    );

    // Only match 1 is attributable to a week.
    expect(groups).toHaveLength(1);
    expect(groups[0].totalSeries).toBe(1);
  });

  it("orders weeks newest first", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 5 }), match({ match_id: 3 })],
      { 5: detail({ week: 61 }), 3: detail({ week: 60 }) },
    );

    expect(groups.map((group) => group.week)).toEqual([61, 60]);
  });

  it("numbers games in match-id order whatever the input order", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 9 }), match({ match_id: 4 }), match({ match_id: 7 })],
      { 9: detail(), 4: detail(), 7: detail() },
    );

    expect(groups[0].entries[0].games).toEqual([
      { matchId: 4, game: 1 },
      { matchId: 7, game: 2 },
      { matchId: 9, game: 3 },
    ]);
  });

  it("dates the week from its earliest game", () => {
    const groups = buildWeekGroups(
      [
        match({ match_id: 1, start_time: "2026-08-03T18:00:00+00:00" }),
        match({ match_id: 2, start_time: "2026-08-01T18:00:00+00:00" }),
      ],
      { 1: detail(), 2: detail() },
    );

    expect(groups[0].dateLabel).toBe("1 Aug 2026");
  });

  it("falls back to created_at when start_time is absent", () => {
    const groups = buildWeekGroups(
      [
        match({
          match_id: 1,
          start_time: null,
          created_at: "2026-08-02T10:00:00+00:00",
        }),
      ],
      { 1: detail() },
    );

    expect(groups[0].dateLabel).toBe("2 Aug 2026");
  });

  it("keeps fixtures apart when a week has two different pairings", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1 }), match({ match_id: 2 })],
      {
        1: detail({ team_a: "A", team_b: "B" }),
        2: detail({ team_a: "C", team_b: "D" }),
      },
    );

    expect(groups[0].totalSeries).toBe(2);
  });

  it("promotes a VOD link found on any game of the fixture", () => {
    const groups = buildWeekGroups(
      [match({ match_id: 1 }), match({ match_id: 2 })],
      {
        1: detail({ match_vod: "" }),
        2: detail({ match_vod: "https://youtu.be/abc" }),
      },
    );

    expect(groups[0].entries[0].vod_url).toBe("https://youtu.be/abc");
  });

  it("keeps one fixture together when it spans two fetched pages", () => {
    const pageOne = [match({ match_id: 1 })];
    const pageTwo = [match({ match_id: 2 })];

    const groups = buildWeekGroups([...pageOne, ...pageTwo], {
      1: detail(),
      2: detail(),
    });

    expect(groups[0].totalSeries).toBe(1);
    expect(groups[0].entries[0].games).toHaveLength(2);
  });

  it("returns an empty list for missing or empty input", () => {
    expect(buildWeekGroups([], {})).toEqual([]);
    expect(buildWeekGroups(undefined, undefined)).toEqual([]);
  });
});
