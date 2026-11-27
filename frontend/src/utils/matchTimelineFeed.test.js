import { describe, expect, it } from "vitest";
import { buildKills, buildFights, buildObjectives, keyPurchases } from "./matchTimelineModel";
import { FEED_FILTERS, buildFeedRows, feedCounts, fightAt, quietSummary } from "./matchTimelineFeed";

const players = [
  { player_slot: 1, team: 0, account_id: 101, hero_id: 11, persona_name: "ABL" },
  { player_slot: 2, team: 0, account_id: 102, hero_id: 12, persona_name: "sanya" },
  { player_slot: 3, team: 0, account_id: 103, hero_id: 13, persona_name: "overseas" },
  ...[7, 8, 9, 10, 11, 12].map((slot) => ({
    player_slot: slot, team: 1, account_id: 100 + slot, hero_id: slot, persona_name: `B${slot}`,
  })),
];

const death = (timeS, victimSlot, killerSlot) => ({
  type: "death",
  time_s: timeS,
  player_slot: victimSlot,
  // The real payload always carries the victim's account id; the feed matches a
  // selection on it, so a fixture without one is not representative.
  account_id: 100 + victimSlot,
  killer_player_slot: killerSlot,
  death_duration_s: 20,
  position: { x: 0, y: 0, z: 0 },
  killer_position: { x: 100, y: 100, z: 0 },
});

// Three kills inside the fight window (a fight), then a lone one well clear of it.
const events = [
  death(600, 7, 1),
  death(610, 8, 2),
  death(618, 9, 1),
  death(1200, 10, 3),
  { type: "objective", time_s: 630, team: 0, objective_id: 5, lane: 1, player_damage: 100 },
  { type: "objective", time_s: 1500, team: 1, objective_id: 9, lane: null, player_damage: 50 },
];

const purchases = [
  { time_s: 700, tier: 4, item: "Colossus", icon: "items/a.png", account_id: 101, player_slot: 1 },
  { time_s: 900, tier: 1, item: "Extra Regen", account_id: 101, player_slot: 1 },
  { time_s: 800, tier: 4, item: "Berserker", icon: "items/b.png", account_id: 107, player_slot: 7 },
];

const model = (overrides = {}) => ({
  kills: buildKills(events, { players }),
  objectives: buildObjectives(events, { labelOf: (id) => `Obj${id}`, laneOf: () => null }),
  keyPurchases: keyPurchases(purchases),
  fights: buildFights(buildKills(events, { players }), { objectives: [] }),
  playersBySlot: new Map(players.map((p) => [p.player_slot, p])),
  ...overrides,
});

describe("buildFeedRows", () => {
  const m = model();

  it("orders every kind of event by time", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000 });
    expect(rows.map((row) => row.kind)).toEqual([
      "fight",      // 596 (padded start)
      "kill", "kill", "kill",
      "objective",  // 630
      "kill",       // 1200
      "objective",  // 1500
    ]);
  });

  it("keeps key items out of the feed until a player is highlighted", () => {
    // A match logs hundreds of buys; showing them all by default would bury the kills.
    expect(buildFeedRows(m, { t: 2000, durationS: 2000 }).some((r) => r.kind === "item")).toBe(false);
    const withPlayer = buildFeedRows(m, { t: 2000, durationS: 2000, selection: [101] });
    expect(withPlayer.filter((r) => r.kind === "item").map((r) => r.purchase.item)).toEqual([
      "Colossus",
    ]);
  });

  it("shows every key item when the filter asks for them", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, filter: "items" });
    expect(rows.every((row) => row.kind === "item")).toBe(true);
    expect(rows).toHaveLength(2);  // the tier-1 buy is not a key item
  });

  it("narrows to the highlighted players' involvement", () => {
    // Player 101 killed the 600s and 618s deaths, so 102's kill (610s) drops out.
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, selection: [101] });
    const kills = rows.filter((row) => row.kind === "kill");
    expect(kills.map((row) => row.timeS)).toEqual([600, 618]);
    expect(kills.every((row) => row.killerSelected)).toBe(true);
  });

  it("marks the victim and killer names separately for highlighting", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, selection: [107] });
    const [kill] = rows.filter((row) => row.kind === "kill");
    expect(kill.victimName).toBe("B7");
    expect(kill.victimSelected).toBe(true);
    expect(kill.killerName).toBe("ABL");
    expect(kill.killerSelected).toBe(false);
  });

  it("indents a kill that belongs to a fight", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000 });
    const inFight = rows.filter((row) => row.kind === "kill" && row.fightIndex != null);
    expect(inFight.every((row) => row.indented)).toBe(true);
    const lone = rows.find((row) => row.kind === "kill" && row.fightIndex == null);
    expect(lone.indented).toBe(false);
  });

  it("stops indenting when the filter is kills only", () => {
    // With fights filtered out there is no header row to indent under.
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, filter: "kills" });
    expect(rows.every((row) => row.indented === false)).toBe(true);
  });

  it("filters to one kind at a time", () => {
    expect(buildFeedRows(m, { t: 2000, filter: "kills" }).every((r) => r.kind === "kill")).toBe(true);
    expect(buildFeedRows(m, { t: 2000, filter: "obj" }).every((r) => r.kind === "objective")).toBe(true);
    expect(
      buildFeedRows(m, { t: 2000, filter: "items" }).every((r) => r.kind === "item"),
    ).toBe(true);
    // "Team fights" keeps each fight's own kills, so they can be read under its header.
    const fights = buildFeedRows(m, { t: 2000, filter: "fights" });
    expect(fights.some((row) => row.kind === "fight")).toBe(true);
    expect(fights.every((row) => row.kind === "fight" || row.fightIndex != null)).toBe(true);
    expect(fights.some((row) => row.kind === "objective")).toBe(false);
  });

  it("leaves out fights that no highlighted player was in", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, filter: "fights", selection: [110] });
    expect(rows).toEqual([]);
  });

  it("lists only events the clock has reached", () => {
    const rows = buildFeedRows(m, { t: 700, durationS: 2000 });
    expect(rows.some((row) => row.timeS === 1200)).toBe(false);
    expect(rows.every((row) => row.timeS <= 700)).toBe(true);
    expect(rows.filter((row) => row.kind === "kill").map((row) => row.timeS)).toEqual([600, 610, 618]);
  });

  it("is empty at 0:00", () => {
    expect(buildFeedRows(m, { t: 0, durationS: 2000 })).toEqual([]);
  });

  it("reveals a fight's header at its start, still in progress", () => {
    const rows = buildFeedRows(m, { t: 612, durationS: 2000 });
    const fight = rows.find((row) => row.kind === "fight");
    expect(fight).toMatchObject({ inProgress: true, score: "2–0", winner: null, followUp: null });
    // Its third kill (618s) has not happened yet.
    expect(rows.filter((row) => row.kind === "kill")).toHaveLength(2);

    const done = buildFeedRows(m, { t: 700, durationS: 2000 }).find((row) => row.kind === "fight");
    expect(done).toMatchObject({ inProgress: false, score: "3–0", winner: 0 });
  });

  it("marks the hovered fight", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, hoveredFightIndex: 0 });
    expect(rows.find((row) => row.kind === "fight").hovered).toBe(true);
  });

  it("marks the latest past event as current", () => {
    const rows = buildFeedRows(m, { t: 700, durationS: 2000 });
    const current = rows.filter((row) => row.background === "current");
    expect(current).toHaveLength(1);
    expect(current[0].kind).toBe("objective");
    expect(current[0].timeS).toBe(630);
  });

  it("marks nothing as current once the match has ended", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000 });
    expect(rows.some((row) => row.background === "current")).toBe(false);
  });

  it("marks a hovered kill row for highlighting", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, hoveredKillId: 1 });
    const hovered = rows.filter((row) => row.background === "hover");
    expect(hovered).toHaveLength(1);
    expect(hovered[0].killId).toBe(1);
  });

  it("leaves a fight header highlighted over a hover", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, hoveredKillId: 1 });
    expect(rows.find((row) => row.kind === "fight").background).toBe("fight");
  });

  it("narrows to a focused fight and its follow-up objective", () => {
    const fight = m.fights[0];
    const focused = { ...fight, objective: m.objectives[0] };
    const rows = buildFeedRows(m, { t: 900, durationS: 2000, focusedFight: focused });

    expect(rows.every((row) => row.fightIndex === 0 || row.kind === "fight" || row.kind === "objective")).toBe(true);
    expect(rows.some((row) => row.kind === "objective" && row.timeS === 1500)).toBe(false);
    expect(rows.find((row) => row.kind === "fight").background).toBe("fightFocused");
  });

  it("shows a focused fight whole, even past the clock", () => {
    const rows = buildFeedRows(m, { t: 590, durationS: 2000, focusedFight: m.fights[0] });
    expect(rows.filter((row) => row.kind === "kill")).toHaveLength(3);
    expect(rows.find((row) => row.kind === "fight")).toMatchObject({ inProgress: false, score: "3–0" });
    expect(rows.some((row) => row.current)).toBe(false);
  });

  it("carries the badges a kill earned", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000 });
    const first = rows.find((row) => row.kind === "kill");
    expect(first.badges.map((badge) => badge.label)).toContain("First Blood");
  });

  it("names the player who bought an item", () => {
    const rows = buildFeedRows(m, { t: 2000, durationS: 2000, filter: "items" });
    const own = rows.find((row) => row.purchase.item === "Colossus");
    expect(own.playerName).toBe("ABL");
    expect(own.playerSelected).toBe(false);
  });

  it("handles an empty model and empty options", () => {
    expect(buildFeedRows(null)).toEqual([]);
    expect(buildFeedRows({})).toEqual([]);
    expect(buildFeedRows(model(), {})).toHaveLength(7);
  });
});

describe("fightAt", () => {
  // The objective at 630s falls 8s after the fight ends (622s), inside the follow-up window.
  const kills = buildKills(events, { players });
  const objectives = buildObjectives(events, { labelOf: (id) => `Obj${id}`, laneOf: () => null });
  const [fight] = buildFights(kills, { objectives });

  it("names the follow-up only once it has fallen", () => {
    expect(fight.objective.timeS).toBe(630);
    expect(fightAt(fight, 625)).toMatchObject({ inProgress: false, followUp: null });
    expect(fightAt(fight, 640).followUp).toBe(fight.objective);
    expect(fightAt(fight).followUp).toBe(fight.objective);
  });

  it("counts only the kills so far while the fight runs", () => {
    expect(fightAt(fight, 600)).toMatchObject({ inProgress: true, score: "1–0", winner: null });
  });
});

describe("quiet stretches", () => {
  // A first blood (badged, so it stays), three unremarkable pick-offs far apart, then an
  // objective that ends the run.
  const quietEvents = [
    death(100, 7, 1),
    death(300, 8, 2),
    death(400, 9, 3),
    death(500, 10, 1),
    { type: "objective", time_s: 600, team: 0, objective_id: 5, lane: 1, player_damage: 100 },
  ];
  const quietKills = buildKills(quietEvents, { players });
  const quiet = model({
    kills: quietKills,
    objectives: buildObjectives(quietEvents, { labelOf: (id) => `Obj${id}`, laneOf: () => null }),
    fights: buildFights(quietKills, { objectives: [] }),
  });

  it("folds 3+ unremarkable rows into one stretch", () => {
    const rows = buildFeedRows(quiet, { t: 2000, durationS: 2000 });
    expect(rows.map((row) => row.kind)).toEqual(["kill", "quiet", "objective"]);
    const stretch = rows[1];
    expect(stretch).toMatchObject({ key: "quiet-300", startS: 300, endS: 500, picks: 3, items: 0, expanded: false });
  });

  it("keeps an expanded stretch's header followed by its rows", () => {
    const rows = buildFeedRows(quiet, { t: 2000, durationS: 2000, expandedQuiet: new Set(["quiet-300"]) });
    expect(rows.map((row) => row.kind)).toEqual(["kill", "quiet", "kill", "kill", "kill", "objective"]);
    expect(rows[1].expanded).toBe(true);
    expect(rows.slice(2, 5).every((row) => row.inStretch === "quiet-300")).toBe(true);
  });

  it("stands in for the current row while folded", () => {
    const rows = buildFeedRows(quiet, { t: 550, durationS: 2000 });
    expect(rows.find((row) => row.kind === "quiet")).toMatchObject({ current: true, background: "current" });
  });

  it("only folds in All events", () => {
    const rows = buildFeedRows(quiet, { t: 2000, durationS: 2000, filter: "kills" });
    expect(rows.some((row) => row.kind === "quiet")).toBe(false);
  });

  it("does not fold a run that is too short", () => {
    const rows = buildFeedRows(quiet, { t: 450, durationS: 2000 });
    expect(rows.some((row) => row.kind === "quiet")).toBe(false);
  });

  it("summarises what a stretch holds", () => {
    expect(quietSummary({ picks: 3, items: 1 })).toBe("3 picks · 1 item");
    expect(quietSummary({ picks: 1 })).toBe("1 pick");
    expect(quietSummary({ items: 2 })).toBe("2 items");
  });
});

describe("feedCounts", () => {
  const m = model();

  it("counts each tab's events up to the clock", () => {
    // At 700s: the fight (596) and its 3 kills, the 630 objective; Colossus (700) is a
    // key item but only enters All events with a player selected.
    expect(feedCounts(m, { t: 700 })).toEqual({ all: 5, kills: 3, obj: 1, fights: 1, items: 1 });
  });

  it("follows the selection like the rows do", () => {
    expect(feedCounts(m, { t: 700, selection: [101] })).toMatchObject({ all: 5, kills: 2, items: 1 });
  });

  it("is all zeros at 0:00 or without a model", () => {
    expect(Object.values(feedCounts(m, { t: 0 })).every((count) => count === 0)).toBe(true);
    expect(feedCounts(null).all).toBe(0);
  });
});

describe("FEED_FILTERS", () => {
  it("lists the five filters the design specifies", () => {
    expect(FEED_FILTERS.map((filter) => filter.label)).toEqual([
      "All events", "Kills", "Objectives", "Team fights", "Key items",
    ]);
  });
});
