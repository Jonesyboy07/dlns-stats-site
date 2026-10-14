import { describe, expect, it } from "vitest";
import {
  LANE_AXIS_STEP_S,
  PLAYBACK_SPEEDS,
  axisTicks,
  buildLaneView,
  fightBands,
  killTicks,
  objectiveMarks,
  percentOf,
  playbackStep,
  playerLane,
  seekTime,
  spanPercent,
} from "./matchTimelineLanes";

const durationS = 1800;

describe("percentOf", () => {
  it("maps a match second onto the strip", () => {
    expect(percentOf(0, 1800)).toBe(0);
    expect(percentOf(900, 1800)).toBe(50);
    expect(percentOf(1800, 1800)).toBe(100);
  });

  it("clamps anything outside the match to an edge", () => {
    expect(percentOf(-10, 1800)).toBe(0);
    expect(percentOf(9999, 1800)).toBe(100);
  });

  it("returns null rather than NaN for a missing clock or duration", () => {
    // A NaN percentage would silently break the layout instead of dropping the mark.
    expect(percentOf(null, 1800)).toBeNull();
    expect(percentOf(100, null)).toBeNull();
    expect(percentOf(100, 0)).toBeNull();
    expect(percentOf(undefined, undefined)).toBeNull();
  });
});

describe("spanPercent", () => {
  it("gives a left edge and a width", () => {
    expect(spanPercent(180, 360, 1800)).toEqual({ left: 10, width: 10 });
  });

  it("never returns a negative width", () => {
    expect(spanPercent(900, 300, 1800).width).toBe(0);
  });

  it("returns null when either end is unknown", () => {
    expect(spanPercent(null, 300, 1800)).toBeNull();
  });
});

describe("axisTicks", () => {
  it("labels every five minutes up to the end of the match", () => {
    const ticks = axisTicks(1800);
    expect(ticks.map((tick) => tick.timeS)).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(LANE_AXIS_STEP_S).toBe(300);
  });

  it("positions each tick as a percentage", () => {
    expect(axisTicks(1800)[3]).toEqual({ timeS: 900, left: 50 });
  });

  it("stops before the end rather than drawing a tick on the edge", () => {
    // A 1700s match has no 30:00 tick, only the 25:00 one.
    expect(axisTicks(1700).map((tick) => tick.timeS)).toEqual([0, 300, 600, 900, 1200, 1500]);
  });

  it("handles a nonsense duration", () => {
    expect(axisTicks(0)).toEqual([]);
    expect(axisTicks(null)).toEqual([]);
  });
});

describe("seekTime", () => {
  it("turns a click position into a match second", () => {
    expect(seekTime(0, 1800)).toBe(0);
    expect(seekTime(0.5, 1800)).toBe(900);
    expect(seekTime(1, 1800)).toBe(1800);
  });

  it("clamps a click outside the lane", () => {
    expect(seekTime(-0.2, 1800)).toBe(0);
    expect(seekTime(1.4, 1800)).toBe(1800);
  });

  it("returns zero rather than NaN without a duration", () => {
    expect(seekTime(0.5, null)).toBe(0);
    expect(seekTime(Number.NaN, 1800)).toBe(0);
  });
});

describe("killTicks", () => {
  const kills = [
    { id: 0, timeS: 90, team: 0, victimAccountId: 7, killerAccountId: 1 },
    { id: 1, timeS: 900, team: 1, victimAccountId: 1, killerAccountId: 7 },
    { id: 2, timeS: 100, team: null, victimAccountId: 8, killerAccountId: null },
  ];

  it("puts each kill on the half its killer's team owns", () => {
    const ticks = killTicks(kills, durationS);
    expect(ticks[0]).toMatchObject({ left: 5, team: 0 });
    expect(ticks[1]).toMatchObject({ left: 50, team: 1 });
  });

  it("has no side for a death with no recorded killer", () => {
    expect(killTicks(kills, durationS)[2].team).toBeNull();
  });

  it("marks involvement only while somebody is highlighted", () => {
    const involves = (kill) => kill.killerAccountId === 1 || kill.victimAccountId === 1;
    expect(killTicks(kills, durationS).every((tick) => tick.involved === null)).toBe(true);

    const scoped = killTicks(kills, durationS, { selection: [1], involves });
    expect(scoped[0].involved).toBe(true);
    expect(scoped[1].involved).toBe(true);
    expect(scoped[2].involved).toBe(false);
  });

  it("drops a kill with no clock", () => {
    expect(killTicks([{ id: 0, timeS: null, team: 0 }], durationS)).toEqual([]);
  });
});

describe("objectiveMarks", () => {
  it("positions each objective and keeps its side and lane", () => {
    const marks = objectiveMarks(
      [{ timeS: 900, team: 1, label: "Walker", laneName: "York" }],
      durationS,
    );
    expect(marks[0]).toMatchObject({ left: 50, team: 1, label: "Walker", laneName: "York" });
  });

  it("drops an objective with no clock", () => {
    expect(objectiveMarks([{ timeS: null, team: 0 }], durationS)).toEqual([]);
  });
});

describe("fightBands", () => {
  const fights = [
    { index: 0, startS: 596, endS: 616, score: "3–1", winner: 0 },
    { index: 1, startS: 900, endS: 910, score: "0–4", winner: 1 },
    { index: 2, startS: 1200, endS: 1210, score: "2–2", winner: null },
  ];

  it("positions a band across its span", () => {
    const bands = fightBands(fights, durationS);
    expect(bands[0].left).toBeCloseTo((596 / 1800) * 100);
    expect(bands[0].width).toBeCloseTo(((616 - 596) / 1800) * 100);
  });

  it("carries the score and the winner", () => {
    const bands = fightBands(fights, durationS);
    expect(bands[0]).toMatchObject({ score: "3–1", winner: 0 });
    expect(bands[2].winner).toBeNull();
  });

  it("handles no fights", () => {
    expect(fightBands([], durationS)).toEqual([]);
  });
});

describe("playerLane", () => {
  const kills = [
    { id: 0, timeS: 300, team: 1, victimAccountId: 7, killerAccountId: 1, untilS: 330, respawnS: 30 },
    { id: 1, timeS: 600, team: 0, victimAccountId: 1, killerAccountId: 7, untilS: 640, respawnS: 40 },
    // Dies at the very end: the bar must not run past the match.
    { id: 2, timeS: 1795, team: 0, victimAccountId: 1, killerAccountId: 7, untilS: 1830, respawnS: 35 },
  ];
  const keyPurchases = [
    { itemId: 10, timeS: 200, item: "Colossus", icon: "items/a.png", accountId: 1 },
    { itemId: 11, timeS: 700, item: "Berserker", accountId: 7 },
  ];

  it("bars the time a player spent dead", () => {
    const { deadBars } = playerLane({ kills, keyPurchases, accountId: 1, durationS });
    expect(deadBars).toHaveLength(2);
    expect(deadBars[0].left).toBeCloseTo((600 / 1800) * 100);
    expect(deadBars[0].width).toBeCloseTo((40 / 1800) * 100);
    expect(deadBars[0]).toMatchObject({ respawnS: 40, killerName: null });
  });

  it("stops a death bar at the end of the match", () => {
    const { deadBars } = playerLane({ kills, keyPurchases, accountId: 1, durationS });
    const last = deadBars[1];
    // 1795 + 35 would end past 1800, so it is cut at the edge.
    expect(last.left + last.width).toBeCloseTo(100);
  });

  it("marks the kills the player made, not the ones they died in", () => {
    const { killMarks } = playerLane({ kills, keyPurchases, accountId: 7, durationS });
    expect(killMarks.map((mark) => mark.timeS)).toEqual([600, 1795]);
    expect(killMarks[0]).toMatchObject({ team: 0, victimName: null });
  });

  it("marks only that player's key items", () => {
    const { itemMarks } = playerLane({ kills, keyPurchases, accountId: 1, durationS });
    expect(itemMarks.map((mark) => mark.item)).toEqual(["Colossus"]);
    expect(itemMarks[0].left).toBeCloseTo((200 / 1800) * 100);
  });

  it("returns empty lanes without an account", () => {
    const empty = playerLane({ kills, keyPurchases, accountId: null, durationS });
    expect(empty).toEqual({ deadBars: [], killMarks: [], itemMarks: [] });
  });
});

describe("buildLaneView", () => {
  const kills = [
    { id: 0, timeS: 600, team: 0, victimAccountId: 7, killerAccountId: 1, untilS: 640, respawnS: 40 },
  ];
  const players = [
    { account_id: 1, persona_name: "ABL", hero_id: 11, team: 0 },
    { account_id: 7, persona_name: "Zerggy", hero_id: 22, team: 1 },
  ];

  it("builds the three tracks", () => {
    const view = buildLaneView({
      kills,
      durationS,
      objectives: [{ timeS: 300, team: 0, label: "Guardian" }],
      fights: [{ index: 0, startS: 596, endS: 616, score: "3–1", winner: 0 }],
      players,
    });
    expect(view.tracks.kills).toHaveLength(1);
    expect(view.tracks.objectives).toHaveLength(1);
    expect(view.tracks.fights).toHaveLength(1);
    expect(view.axis).toHaveLength(6);
  });

  it("adds a lane per highlighted player, named from the roster", () => {
    const view = buildLaneView({ kills, durationS, players, selection: [1, 7] });
    expect(view.players.map((lane) => lane.name)).toEqual(["ABL", "Zerggy"]);
    expect(view.players[1].deadBars).toHaveLength(1);
    expect(view.players[0].killMarks).toHaveLength(1);
  });

  it("still emits a lane for a player missing from the roster", () => {
    const view = buildLaneView({ kills, durationS, players, selection: [999] });
    expect(view.players[0].name).toBe("#999");
  });

  it("has no player lanes when nobody is highlighted", () => {
    expect(buildLaneView({ kills, durationS, players }).players).toEqual([]);
  });

  it("handles an empty call", () => {
    const view = buildLaneView();
    expect(view.tracks).toEqual({ fights: [], kills: [], objectives: [] });
    expect(view.players).toEqual([]);
    expect(view.axis).toEqual([]);
  });
});

describe("playback", () => {
  it("runs at real time at 1 x", () => {
    // A quarter-second tick at 1 x advances a quarter of a match second, so a match
    // second takes a real second.
    expect(playbackStep(1)).toBe(0.25);
    expect(playbackStep(1, 1000)).toBe(1);
  });

  it("multiplies the step by the speed", () => {
    expect(playbackStep(2, 1000)).toBe(2);
    expect(playbackStep(3, 1000)).toBe(3);
    expect(playbackStep(4, 1000)).toBe(4);
    expect(playbackStep(4)).toBe(1);
  });

  it("offers 1 x through 4 x", () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 3, 4]);
  });

  it("advances nothing on a speed or tick that cannot be used", () => {
    expect(playbackStep(0)).toBe(0);
    expect(playbackStep(-2)).toBe(0);
    expect(playbackStep("fast")).toBe(0);
    expect(playbackStep()).toBe(0.25);
    expect(playbackStep(1, 0)).toBe(0);
    expect(playbackStep(1, "slow")).toBe(0);
  });
});
