import { describe, expect, it } from "vitest";
import { eventTimelines } from "./TeamPlayersTab";
import { leagueAxesByEvent } from "../player/TenureTimeline";

describe("eventTimelines", () => {
  const players = [
    { account_id: 1, persona_name: "Alpha", weeks: [30, 31] },
    { account_id: 2, persona_name: "Bravo", weeks: [] },
  ];

  it("builds one timeline per event with that event's weeks on each row", () => {
    const timelines = eventTimelines(
      [
        {
          event_title: "Night Shift",
          weeks: [30, 31],
          max_week: 31,
          players: [{ account_id: 1, weeks: [30, 31], first_week: 30, last_week: 31, appearances: 4 }],
        },
        {
          event_title: "Fight Night",
          weeks: [5],
          max_week: 5,
          players: [{ account_id: 2, weeks: [5], first_week: 5, last_week: 5, appearances: 1 }],
        },
      ],
      players,
    );

    expect(timelines.map((t) => [t.event, t.prefix, t.weeks, t.maxWeek])).toEqual([
      ["Night Shift", "NS", [30, 31], 31],
      ["Fight Night", "FN", [5], 5],
    ]);
    // Name comes from the roster record; weeks come from the event, not the page-level list.
    expect(timelines[1].players).toEqual([
      expect.objectContaining({ account_id: 2, persona_name: "Bravo", weeks: [5], last_week: 5 }),
    ]);
  });

  it("drops events with nothing to plot", () => {
    expect(eventTimelines([{ event_title: "Fight Night", weeks: [], players: [] }], players)).toEqual([]);
  });

  it("falls back to the page-level timeline for an older payload", () => {
    const [only] = eventTimelines(undefined, players, [30, 31], 31);
    expect(only).toMatchObject({ prefix: "NS", weeks: [30, 31], maxWeek: 31 });
    expect(eventTimelines(undefined, players, [], null)).toEqual([]);
  });
});

describe("leagueAxesByEvent", () => {
  it("keeps each event's league weeks separate and merges across teams", () => {
    const axes = leagueAxesByEvent([
      { events: [{ event_title: "Night Shift", league_weeks: [1, 2, 4] }] },
      null, // a failed lookup
      {
        events: [
          { event_title: "Night Shift", league_weeks: [2, 3] },
          { event_title: "Fight Night", league_weeks: [5, 1] },
        ],
      },
    ]);
    expect(axes).toEqual({ "Night Shift": [1, 2, 3, 4], "Fight Night": [1, 5] });
  });
});
