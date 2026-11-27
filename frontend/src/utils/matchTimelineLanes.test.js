import { describe, expect, it } from "vitest";
import {
  LANE_AXIS_STEP_S,
  PLAYBACK_SPEEDS,
  axisTicks,
  buildLaneView,
  datedSouls,
  interpolateAt,
  fightBands,
  killTicks,
  objectiveMarks,
  percentOf,
  playbackStep,
  playerLane,
  seekTime,
  soulLeadAt,
  soulLeadPath,
  soulLeadSeries,
  spanPercent,
  spoilerMask,
  teamSoulsAt,
  turningPointBands,
} from "./matchTimelineLanes";

const durationS = 1800;

describe("turningPointBands", () => {
  it("places each swing window on the track with its beneficiary", () => {
    const bands = turningPointBands(
      [
        { startS: 360, endS: 480, team: 1, swingSouls: 6000 },
        { startS: 900, endS: 1020, team: 0, swingSouls: 4000 },
      ],
      durationS,
    );
    expect(bands).toEqual([
      { key: "tp-360", left: 20, width: expect.closeTo(6.667, 2), team: 1, startS: 360, endS: 480 },
      { key: "tp-900", left: 50, width: expect.closeTo(6.667, 2), team: 0, startS: 900, endS: 1020 },
    ]);
  });

  it("skips what cannot be placed", () => {
    expect(turningPointBands([{ startS: 10, endS: 20, team: 0 }], null)).toEqual([]);
    expect(turningPointBands(null, durationS)).toEqual([]);
  });
});

describe("spoilerMask", () => {
  it("covers everything after the playhead", () => {
    expect(spoilerMask(450, durationS)).toEqual({ left: 25, width: 75 });
    expect(spoilerMask(0, durationS)).toEqual({ left: 0, width: 100 });
  });

  it("hides nothing at the end of the match or without a clock", () => {
    expect(spoilerMask(durationS, durationS)).toBeNull();
    expect(spoilerMask(null, durationS)).toBeNull();
  });
});

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
    // The kill id lets hovering the mark light the same kill everywhere else.
    expect(killMarks.every((mark) => mark.killId != null)).toBe(true);
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
    expect(view.tracks).toEqual({ fights: [], kills: [], objectives: [], souls: null, turningPoints: [] });
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

  it("offers the handoff's 1 x, 2 x and 4 x", () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 4]);
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

const snap = (time_stamp_s, net_worth) => ({ time_stamp_s, net_worth });

describe("soulLeadSeries", () => {
  it("is Amber minus Sapphire at every snapshot second", () => {
    const players = {
      1: { team: 0, snapshots: [snap(60, 500), snap(120, 1200)] },
      2: { team: 0, snapshots: [snap(60, 400), snap(120, 900)] },
      3: { team: 1, snapshots: [snap(60, 600), snap(120, 1000)] },
    };
    expect(soulLeadSeries(players, 1800)).toEqual([
      { timeS: 60, lead: 300, souls: [900, 600] },
      { timeS: 120, lead: 1100, souls: [2100, 1000] },
    ]);
  });

  it("holds a player's last value when their snapshot lands at a different second", () => {
    const players = {
      1: { team: 0, snapshots: [snap(60, 1000)] },
      2: { team: 1, snapshots: [snap(61, 800)] },
    };
    expect(soulLeadSeries(players, 1800)).toEqual([
      { timeS: 60, lead: 1000, souls: [1000, 0] },
      { timeS: 61, lead: 200, souls: [1000, 800] },
    ]);
  });

  it("spreads undated snapshots evenly across the match", () => {
    const players = {
      1: { team: 0, snapshots: [{ net_worth: 0 }, { net_worth: 100 }, { net_worth: 300 }] },
    };
    expect(soulLeadSeries(players, 600).map((p) => p.timeS)).toEqual([0, 300, 600]);
  });

  it("returns nothing when there is nothing to plot", () => {
    expect(soulLeadSeries(null, 1800)).toEqual([]);
    expect(soulLeadSeries({}, 1800)).toEqual([]);
    expect(soulLeadSeries({ 1: { team: 0, snapshots: [{ net_worth: 5 }] } }, null)).toEqual([]);
  });

  it("ignores players with no team", () => {
    const players = {
      1: { team: 0, snapshots: [snap(60, 500)] },
      2: { team: null, snapshots: [snap(60, 9999)] },
    };
    expect(soulLeadSeries(players, 1800)).toEqual([{ timeS: 60, lead: 500, souls: [500, 0] }]);
  });
});

describe("soulLeadAt", () => {
  const series = [
    { timeS: 60, lead: 0 },
    { timeS: 120, lead: 1000 },
  ];

  it("interpolates between snapshots", () => {
    expect(soulLeadAt(series, 90)).toBe(500);
  });

  it("is even before the first snapshot and holds after the last", () => {
    expect(soulLeadAt(series, 10)).toBe(0);
    expect(soulLeadAt([{ timeS: 100, lead: 1000 }], 50)).toBe(500);
    expect(soulLeadAt(series, 999)).toBe(1000);
  });

  it("is null without a series", () => {
    expect(soulLeadAt([], 60)).toBeNull();
  });
});

describe("soulLeadPath", () => {
  it("starts at 0:00 on the zero line and uses a symmetric scale with headroom", () => {
    const path = soulLeadPath(
      [
        { timeS: 900, lead: 2000 },
        { timeS: 1800, lead: -1000 },
      ],
      1800,
      { width: 100, height: 20 },
    );
    expect(path.mid).toBe(10);
    expect(path.maxAbs).toBe(2000);
    // The scale is the biggest lead x 1.1, so the peak stops short of the edge.
    expect(path.scaleSouls).toBeCloseTo(2200);
    const points = path.line.split(" ").map((pair) => pair.split(",").map(Number));
    expect(points[0]).toEqual([0, 10]);
    expect(points[1]).toEqual([50, 0.91]);
    expect(points[2]).toEqual([100, 14.55]);
    expect(path.area.startsWith("M0,10")).toBe(true);
    expect(path.area.endsWith("L100,10 Z")).toBe(true);
    expect(path.peak.amber).toEqual({ timeS: 900, lead: 2000 });
    expect(path.peak.sapphire).toEqual({ timeS: 1800, lead: -1000 });
  });

  it("is null when it cannot be placed", () => {
    expect(soulLeadPath([], 1800)).toBeNull();
    expect(soulLeadPath([{ timeS: 1, lead: 1 }], null)).toBeNull();
  });
});

describe("buildLaneView soul lead", () => {
  it("adds the souls track only when there is a series", () => {
    expect(buildLaneView({ durationS }).tracks.souls).toBeNull();
    const view = buildLaneView({ durationS, soulLead: [{ timeS: 60, lead: 100 }] });
    expect(view.tracks.souls.line).toBeTruthy();
    expect(view.soulLead).toHaveLength(1);
  });
});

describe("teamSoulsAt", () => {
  const series = [
    { timeS: 60, lead: 0, souls: [1000, 1000] },
    { timeS: 120, lead: 1000, souls: [3000, 2000] },
  ];

  it("interpolates both sides between snapshots", () => {
    expect(teamSoulsAt(series, 90)).toEqual([2000, 1500]);
  });

  it("agrees with soulLeadAt", () => {
    const [amber, sapphire] = teamSoulsAt(series, 100);
    expect(amber - sapphire).toBe(soulLeadAt(series, 100));
  });

  it("rises from zero before the first snapshot and holds after the last", () => {
    expect(teamSoulsAt(series, 0)).toEqual([0, 0]);
    expect(teamSoulsAt(series, 30)).toEqual([500, 500]);
    expect(teamSoulsAt(series, 9999)).toEqual([3000, 2000]);
  });

  it("is null without a series", () => {
    expect(teamSoulsAt([], 60)).toBeNull();
  });
});

describe("datedSouls", () => {
  it("orders dated snapshots and drops ones without souls", () => {
    expect(
      datedSouls([snap(360, 900), snap(180, 400), { time_stamp_s: 540, net_worth: null }], 1800),
    ).toEqual([
      { timeS: 180, souls: 400, assists: null },
      { timeS: 360, souls: 900, assists: null },
    ]);
  });

  it("carries the snapshot's assists alongside its souls", () => {
    expect(
      datedSouls([{ time_stamp_s: 120, net_worth: 900, assists: 3 }], 600),
    ).toEqual([{ timeS: 120, souls: 900, assists: 3 }]);
  });

  it("spreads undated snapshots across the match, or gives up without a duration", () => {
    const undated = [{ net_worth: 1 }, { net_worth: 2 }];
    expect(datedSouls(undated, 600).map((p) => p.timeS)).toEqual([0, 600]);
    expect(datedSouls(undated, null)).toEqual([]);
    expect(datedSouls(null, 600)).toEqual([]);
  });
});

describe("interpolateAt", () => {
  const points = [
    { timeS: 100, value: 1000 },
    { timeS: 200, value: 3000 },
  ];

  it("rises from zero at 0:00 to the first point", () => {
    expect(interpolateAt(points, 0)).toBe(0);
    expect(interpolateAt(points, 50)).toBe(500);
  });

  it("is linear between points and holds after the last", () => {
    expect(interpolateAt(points, 150)).toBe(2000);
    expect(interpolateAt(points, 999)).toBe(3000);
  });

  it("interpolates pairs", () => {
    const pairs = [{ timeS: 100, v: [100, 300] }];
    expect(interpolateAt(pairs, 50, { read: (p) => p.v, zero: [0, 0] })).toEqual([50, 150]);
  });

  it("is null without points", () => {
    expect(interpolateAt([], 10)).toBeNull();
  });
});
