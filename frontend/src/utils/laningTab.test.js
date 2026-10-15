import { describe, expect, it } from "vitest";
import { LANING_END_S } from "./laning";
import { MAP_RADIUS, worldToPercent } from "./matchMap";
import {
  LANING_DOT_SIZE,
  LANING_DOT_SIZE_ACTIVE,
  LANING_ITEM_SLOTS,
  LANING_LANE_OPTIONS,
  LANING_PLAYBACK_RATE,
  abilityOrderRows,
  buildTableRows,
  itemSlots,
  laneGuardians,
  laneHeadToHead,
  laneHeadToHeadAll,
  laningDeathTally,
  laningDots,
  laningEnded,
  laningFeed,
  laningKillList,
  laningPercent,
  laningScrubTime,
  laningStartTime,
  laningStep,
  laningTicks,
  tierCost,
} from "./laningTab";

/** A player in the shape `/db/matches/<id>/players` returns. */
const player = (overrides = {}) => ({
  player_slot: 1,
  account_id: 101,
  team: 0,
  hero_id: 6,
  persona_name: "Amber",
  lane: 1,
  ...overrides,
});

/** A kill in the shape `matchTimelineModel.buildKills` produces. */
const kill = (overrides = {}) => ({
  id: 0,
  timeS: 100,
  victimSlot: 7,
  killerSlot: 1,
  victimAccountId: 107,
  killerAccountId: 101,
  team: 0,
  killedTeam: 1,
  victimName: "Victim",
  killerName: "Killer",
  victimHeroId: 3,
  killerHeroId: 6,
  position: { x: 0, y: 0, z: 0 },
  ...overrides,
});

/** Two sides of one lane, four players each, with the amber side in slots 1-2. */
const roster = [
  player({ player_slot: 1, account_id: 101, team: 0, lane: 1, persona_name: "Amber One", hero_id: 6 }),
  player({ player_slot: 2, account_id: 102, team: 0, lane: 1, persona_name: "Amber Two", hero_id: 7 }),
  player({ player_slot: 7, account_id: 107, team: 1, lane: 1, persona_name: "Sapphire Seven", hero_id: 3 }),
  player({ player_slot: 8, account_id: 108, team: 1, lane: 4, persona_name: "Sapphire Eight", hero_id: 4 }),
];

const purchase = (overrides = {}) => ({
  account_id: 101,
  time_s: 60,
  item_id: 1,
  item: "Item",
  image: "items/one.png",
  sold_time_s: null,
  ...overrides,
});

const ability = (overrides = {}) => ({
  ability_id: 1,
  slot: 1,
  name: "Ability",
  image: "abilities/one.png",
  upgrades: [],
  ...overrides,
});

describe("laningStep", () => {
  it("runs ten game-seconds per real second at 1x", () => {
    expect(LANING_PLAYBACK_RATE).toBe(10);
    expect(laningStep(0, 0.1, 1)).toBeCloseTo(1);
    expect(laningStep(100, 1, 1)).toBeCloseTo(110);
  });

  it("multiplies the rate by the speed", () => {
    expect(laningStep(0, 0.5, 0.5)).toBeCloseTo(2.5);
    expect(laningStep(0, 0.5, 4)).toBeCloseTo(20);
  });

  it("clamps at the end of the laning window", () => {
    expect(laningStep(590, 5, 1)).toBe(LANING_END_S);
  });

  it("honours a custom end", () => {
    expect(laningStep(90, 5, 1, 100)).toBe(100);
  });

  it("stalls rather than jumping on an unusable speed or delta", () => {
    expect(laningStep(120, 1, 0)).toBe(120);
    expect(laningStep(120, 1, -2)).toBe(120);
    expect(laningStep(120, 1, "fast")).toBe(120);
    expect(laningStep(120, -1, 1)).toBe(120);
    expect(laningStep(120, "soon", 1)).toBe(120);
  });

  it("treats a missing clock as the start", () => {
    expect(laningStep(null, 0.1, 1)).toBeCloseTo(1);
    expect(laningStep(undefined, 0.1, 2)).toBeCloseTo(2);
  });
});

describe("laningEnded", () => {
  it("is true only once the clock reaches the end", () => {
    expect(laningEnded(LANING_END_S)).toBe(true);
    expect(laningEnded(LANING_END_S + 1)).toBe(true);
    expect(laningEnded(LANING_END_S - 0.5)).toBe(false);
    expect(laningEnded(null)).toBe(false);
  });
});

describe("laningStartTime", () => {
  it("starts over when Play is pressed at the end", () => {
    expect(laningStartTime(LANING_END_S)).toBe(0);
    expect(laningStartTime(LANING_END_S + 30)).toBe(0);
  });

  it("carries on from anywhere else", () => {
    expect(laningStartTime(123)).toBe(123);
  });
});

describe("laningScrubTime", () => {
  it("maps the track ratio onto the window", () => {
    expect(laningScrubTime(0)).toBe(0);
    expect(laningScrubTime(0.5)).toBe(LANING_END_S / 2);
    expect(laningScrubTime(1)).toBe(LANING_END_S);
  });

  it("clamps anything outside the track", () => {
    expect(laningScrubTime(-1)).toBe(0);
    expect(laningScrubTime(4)).toBe(LANING_END_S);
    expect(laningScrubTime(null)).toBe(0);
  });
});

describe("laningPercent", () => {
  it("places a time along the window", () => {
    expect(laningPercent(300)).toBe(50);
    expect(laningPercent(0)).toBe(0);
    expect(laningPercent(900)).toBe(100);
  });

  it("is 0 when nothing can be placed", () => {
    expect(laningPercent(null)).toBe(0);
    expect(laningPercent(100, 0)).toBe(0);
  });
});

describe("laningKillList", () => {
  it("keeps only the kills inside the window", () => {
    const kills = [kill({ id: 0, timeS: 30 }), kill({ id: 1, timeS: 601 }), kill({ id: 2, timeS: null })];
    expect(laningKillList(kills, roster).map((row) => row.id)).toEqual([0]);
  });

  it("takes the lane from the victim", () => {
    const [row] = laningKillList([kill({ victimSlot: 8 })], roster);
    expect(row.lane).toBe(4);
    expect(row.laneName).toBe("Broadway");
  });

  it("resolves both players and their sides", () => {
    const [row] = laningKillList([kill()], roster);
    expect(row.team).toBe(0);
    expect(row.victimTeam).toBe(1);
    expect(row.killerAccountId).toBe(101);
    expect(row.victimAccountId).toBe(107);
  });

  it("prefers the model's own names and falls back to the players", () => {
    const [named] = laningKillList([kill({ killerName: "Model Killer", victimName: null })], roster);
    expect(named.killerName).toBe("Model Killer");
    expect(named.victimName).toBe("Sapphire Seven");
  });

  it("takes the hero of each side from the model, then the player", () => {
    const [row] = laningKillList([kill({ killerHeroId: null })], roster);
    expect(row.killerHeroId).toBe(6);
    expect(row.victimHeroId).toBe(3);
  });

  it("falls back to the account when the slot is missing", () => {
    const [row] = laningKillList([kill({ victimSlot: null, victimAccountId: 108 })], roster);
    expect(row.lane).toBe(4);
  });

  it("keeps a kill it cannot place", () => {
    const [row] = laningKillList([kill({ victimSlot: 99, victimAccountId: 999 })], roster);
    expect(row.lane).toBeNull();
    expect(row.laneName).toBeNull();
  });

  it("converts the death position to map percentages", () => {
    const [row] = laningKillList([kill({ position: { x: MAP_RADIUS / 2, y: 0 } })], roster);
    expect(row.point).toEqual(worldToPercent(MAP_RADIUS / 2, 0));
    expect(laningKillList([kill({ position: null })], roster)[0].point).toBeNull();
  });
});

describe("laningDots", () => {
  const list = [kill({ id: 0, timeS: 100 }), kill({ id: 1, timeS: 590, victimSlot: 8 })];

  it("hides the kills the clock has not reached", () => {
    const [past, future] = laningDots(laningKillList(list, roster), { time: 150 });
    expect(past.opacity).toBeGreaterThan(0);
    expect(past.past).toBe(true);
    expect(future.past).toBe(false);
    expect(future.opacity).toBe(0);
    expect(future.size).toBe(LANING_DOT_SIZE);
  });

  it("fades the kills outside the selected lane", () => {
    const [, broadway] = laningDots(laningKillList(list, roster), { lane: 1, time: 600 });
    expect(broadway.opacity).toBe(0.1);
    expect(broadway.inLane).toBe(false);
  });

  it("draws a recent kill large and opaque", () => {
    const [recent] = laningDots(laningKillList([kill({ id: 0, timeS: 590 })], roster), { time: 600 });
    expect(recent.recent).toBe(true);
    expect(recent.size).toBe(LANING_DOT_SIZE_ACTIVE);
    expect(recent.opacity).toBe(1);
  });

  it("leaves an older kill at its resting size", () => {
    const [older] = laningDots(laningKillList([kill({ id: 0, timeS: 100 })], roster), { time: 400 });
    expect(older.recent).toBe(false);
    expect(older.size).toBe(LANING_DOT_SIZE);
    expect(older.opacity).toBe(0.6);
  });

  it("fades the others while one is hovered", () => {
    const dots = laningDots(laningKillList([kill({ id: 0, timeS: 100 }), kill({ id: 1, timeS: 120 })], roster), {
      time: 400,
      hoverKillId: 1,
    });
    expect(dots[0].opacity).toBe(0.3);
    expect(dots[1].opacity).toBe(1);
    expect(dots[1].size).toBe(LANING_DOT_SIZE_ACTIVE);
  });

  it("does not fade anything when the hover is on the feed's own list", () => {
    const dots = laningDots(laningKillList([kill({ id: 0, timeS: 100 })], roster), { time: 400 });
    expect(dots[0].opacity).toBe(0.6);
  });
});

describe("laningFeed", () => {
  it("lists only the selected lane, in order", () => {
    const rows = laningFeed(
      laningKillList([kill({ id: 0, timeS: 100 }), kill({ id: 1, timeS: 200, victimSlot: 8 })], roster),
      { lane: 4 },
    );
    expect(rows.map((row) => row.id)).toEqual([1]);
  });

  it("marks the kills the clock has not reached instead of hiding them", () => {
    const rows = laningFeed(laningKillList([kill({ id: 0, timeS: 300 })], roster), { time: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0].past).toBe(false);
  });

  it("marks the hovered row", () => {
    const rows = laningFeed(laningKillList([kill({ id: 0, timeS: 100 })], roster), { time: 400, hoverKillId: 0 });
    expect(rows[0].hovered).toBe(true);
  });
});

describe("laningDeathTally", () => {
  it("counts the deaths of the victims' sides", () => {
    const kills = laningKillList(
      [kill({ id: 0, timeS: 100 }), kill({ id: 1, timeS: 120, killedTeam: 0 }), kill({ id: 2, timeS: 700 })],
      roster,
    );
    expect(laningDeathTally(kills, { time: 600 })).toMatchObject({
      total: 2,
      amber: 1,
      sapphire: 1,
    });
  });

  it("counts only the selected lane and only the past", () => {
    const kills = laningKillList(
      [kill({ id: 0, timeS: 100 }), kill({ id: 1, timeS: 200, victimSlot: 8 }), kill({ id: 2, timeS: 400 })],
      roster,
    );
    expect(laningDeathTally(kills, { lane: 4, time: 300 }).total).toBe(1);
    expect(laningDeathTally(kills, { lane: 4, time: 300 }).sapphire).toBe(1);
  });
});

describe("laningTicks", () => {
  it("places each kill along the track", () => {
    const ticks = laningTicks(laningKillList([kill({ id: 0, timeS: 300 })], roster));
    expect(ticks[0].left).toBe(50);
    expect(ticks[0].team).toBe(0);
    expect(ticks[0].inLane).toBe(true);
  });

  it("marks the kills the filter is hiding", () => {
    const ticks = laningTicks(laningKillList([kill({ id: 0, timeS: 300, victimSlot: 8 })], roster), { lane: 1 });
    expect(ticks[0].inLane).toBe(false);
  });
});

describe("laneGuardians", () => {
  const objectives = [
    { objectiveId: 1, team: 0, timeS: 316 },
    { objectiveId: 1, team: 1, timeS: 365 },
    { objectiveId: 3, team: 0, timeS: 455 },
    { objectiveId: 5, team: 1, timeS: 1115 },
  ];

  it("reads each side's own guardian from the destroyer", () => {
    const lane = laneGuardians(objectives, 1);
    expect(lane.amber).toMatchObject({ timeS: 365, standing: false });
    expect(lane.sapphire).toMatchObject({ timeS: 316, standing: false });
  });

  it("reports a guardian that survived as standing", () => {
    const lane = laneGuardians(objectives, 4);
    expect(lane.amber.standing).toBe(true);
    expect(lane.amber.timeS).toBeNull();
    // The same list holds lane 4's Tier 1, destroyed by amber, so sapphire lost theirs.
    expect(lane.sapphire).toMatchObject({ timeS: 455, standing: false });
  });

  it("ignores the walkers", () => {
    expect(laneGuardians([{ objectiveId: 5, team: 1, timeS: 1115 }], 1).amber.standing).toBe(true);
  });

  it("flags a guardian that fell after the window", () => {
    const lane = laneGuardians([{ objectiveId: 1, team: 1, timeS: 700 }], 1);
    expect(lane.amber).toMatchObject({ timeS: 700, beyondWindow: true });
  });

  it("is standing for a lane it is not given", () => {
    const lane = laneGuardians(objectives, null);
    expect(lane.amber.standing).toBe(true);
    expect(lane.sapphire.standing).toBe(true);
  });
});

describe("laneHeadToHead", () => {
  const values = {
    101: { souls5: 1500, souls10: 6100, heroDamage: 1300, kills: 1, deaths: 0, assists: 1 },
    107: { souls5: 1900, souls10: 5800, heroDamage: 1300, kills: 0, deaths: 1, assists: 0 },
  };
  const players = [player({ account_id: 101 }), player({ account_id: 107, team: 1, player_slot: 7 })];
  const valuesOf = (p) => values[p.account_id];

  it("sums each side and marks the leader", () => {
    const { rows } = laneHeadToHead(players, valuesOf);
    const souls = rows.find((row) => row.key === "souls10");
    expect(souls.left.value).toBe(6100);
    expect(souls.right.value).toBe(5800);
    expect(souls.leader).toBe("left");
  });

  it("scales the bars against the larger side", () => {
    const { rows } = laneHeadToHead(players, valuesOf);
    const souls = rows.find((row) => row.key === "souls10");
    expect(souls.left.ratio).toBe(1);
    expect(souls.right.ratio).toBeCloseTo(5800 / 6100);
  });

  it("leaves both sides even on a tie", () => {
    const { rows } = laneHeadToHead(players, () => ({ souls10: 1000, souls5: 500, heroDamage: 0, kills: 0 }));
    const souls = rows.find((row) => row.key === "souls10");
    expect(souls.left.ratio).toBe(1);
    expect(souls.right.ratio).toBe(1);
    expect(souls.leader).toBe("tie");
  });

  it("reports the end-of-laning souls difference as the lead", () => {
    expect(laneHeadToHead(players, valuesOf).lead).toBe(300);
  });

  it("is unknown, not a loss, when the snapshots cannot answer", () => {
    const { rows, lead } = laneHeadToHead(players, () => null);
    const souls = rows.find((row) => row.key === "souls10");
    expect(souls.left.value).toBeNull();
    expect(souls.left.ratio).toBe(0);
    expect(souls.known).toBe(false);
    expect(souls.leader).toBeNull();
    expect(lead).toBeNull();
  });

  it("keeps the rows in the design's order", () => {
    const { rows } = laneHeadToHead(players, valuesOf);
    expect(rows.map((row) => row.key)).toEqual(["souls5", "souls10", "heroDamage", "kills"]);
  });

  it("separates the players by side", () => {
    const { players: sides } = laneHeadToHead(players, valuesOf);
    expect(sides.left.map((p) => p.account_id)).toEqual([101]);
    expect(sides.right.map((p) => p.account_id)).toEqual([107]);
  });
});

describe("laneHeadToHeadAll", () => {
  const laneRows = [
    {
      lane: 1,
      left: [player({ account_id: 101 })],
      right: [player({ account_id: 107, team: 1 })],
    },
    {
      lane: 4,
      left: [player({ account_id: 102 })],
      right: [player({ account_id: 108, team: 1, lane: 4 })],
    },
  ];
  const souls = { 101: 6100, 102: 2000, 107: 5800, 108: 3000 };
  const valuesOf = (p) => ({ souls10: souls[p.account_id] });

  it("lists a row per lane in reading order", () => {
    const { rows } = laneHeadToHeadAll(laneRows, valuesOf);
    expect(rows.map((row) => row.label)).toEqual(["YORK", "BROADWAY"]);
  });

  it("totals every lane for the headline lead", () => {
    expect(laneHeadToHeadAll(laneRows, valuesOf).lead).toBe(6100 + 2000 - (5800 + 3000));
  });

  it("has no lead when a side cannot be read", () => {
    const { lead } = laneHeadToHeadAll(laneRows, (p) => ({ souls10: p.team === 0 ? 100 : null }));
    expect(lead).toBeNull();
  });
});

describe("tierCost", () => {
  it("charges the unlock nothing and the tiers 1/2/5", () => {
    expect(tierCost(0)).toBe(0);
    expect(tierCost(1)).toBe(1);
    expect(tierCost(2)).toBe(2);
    expect(tierCost(3)).toBe(5);
  });

  it("caps anything beyond the known tiers at the top cost", () => {
    expect(tierCost(9)).toBe(5);
    expect(tierCost(null)).toBe(0);
  });
});

describe("abilityOrderRows", () => {
  const abilities = [
    ability({ ability_id: 10, slot: 2, name: "Two", upgrades: [{ tier: 0, game_time_s: 10 }] }),
    ability({
      ability_id: 11,
      slot: 1,
      name: "One",
      upgrades: [
        { tier: 1, game_time_s: 20 },
        { tier: 2, game_time_s: 30 },
        { tier: 3, game_time_s: 40 },
      ],
    }),
    ability({ ability_id: 12, slot: 3, name: "Three", upgrades: [{ tier: 0, game_time_s: 50 }] }),
    ability({ ability_id: 13, slot: 4, name: "Four", upgrades: [{ tier: 0, game_time_s: 60 }] }),
  ];

  it("orders the rows by slot, not by when points were spent", () => {
    const rows = abilityOrderRows(abilities, 600);
    expect(rows.map((row) => row.name)).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("gives every row ten cells", () => {
    const rows = abilityOrderRows(abilities, 600);
    expect(rows.every((row) => row.cells.length === 10)).toBe(true);
  });

  it("puts each point in the column it was spent in, on its own row", () => {
    const rows = abilityOrderRows(abilities, 600);
    const one = rows.find((row) => row.name === "One");
    const two = rows.find((row) => row.name === "Two");
    // The first point of the game unlocked Two, so column 0 is Two's and One's is empty.
    expect(one.cells[0]).toBeNull();
    expect(two.cells[0]).toMatchObject({ kind: "unlock" });
    expect(one.cells[1]).toMatchObject({ kind: "upgrade", cost: 1 });
    expect(one.cells[2]).toMatchObject({ kind: "upgrade", cost: 2 });
    expect(one.cells[3]).toMatchObject({ kind: "upgrade", cost: 5 });
  });

  it("hides the points the clock has not reached", () => {
    const rows = abilityOrderRows(abilities, 35);
    const one = rows.find((row) => row.name === "One");
    const three = rows.find((row) => row.name === "Three");
    expect(one.cells[1]).toMatchObject({ cost: 1 });
    expect(one.cells[2]).toMatchObject({ cost: 2 });
    expect(one.cells[3]).toBeNull();
    expect(three.cells[4]).toBeNull();
  });

  it("never draws a point with no recorded time", () => {
    const rows = abilityOrderRows(
      [
        ability({
          ability_id: 10,
          slot: 1,
          upgrades: [{ tier: 0, game_time_s: null }, { tier: 1, game_time_s: 30 }],
        }),
      ],
      600,
    );
    expect(rows[0].cells[0]).toMatchObject({ cost: 1, timeS: 30 });
    expect(rows[0].cells[1]).toBeNull();
  });

  it("draws only the ten steps the design has room for", () => {
    const upgrades = Array.from({ length: 14 }, (_, index) => ({ tier: 0, game_time_s: index + 1 }));
    const rows = abilityOrderRows([ability({ ability_id: 10, slot: 1, upgrades })], 600);
    expect(rows[0].cells.filter(Boolean)).toHaveLength(10);
  });

  it("keeps the payload's order when nothing carries a slot", () => {
    const rows = abilityOrderRows(
      [ability({ ability_id: 10, name: "First" }), ability({ ability_id: 11, name: "Second" })],
      600,
    );
    expect(rows.map((row) => row.name)).toEqual(["First", "Second"]);
  });

  it("still lists an ability with no points at all", () => {
    const rows = abilityOrderRows([ability({ ability_id: 10, name: "Idle" })], 600);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.every((cell) => cell === null)).toBe(true);
  });

  it("breaks same-second ties by slot", () => {
    const rows = abilityOrderRows(
      [
        ability({ ability_id: 10, slot: 2, name: "Two", upgrades: [{ tier: 0, game_time_s: 20 }] }),
        ability({ ability_id: 11, slot: 1, name: "One", upgrades: [{ tier: 0, game_time_s: 20 }] }),
      ],
      600,
    );
    expect(rows.find((row) => row.name === "One").cells[0]).toMatchObject({ kind: "unlock" });
    expect(rows.find((row) => row.name === "Two").cells[1]).toMatchObject({ kind: "unlock" });
  });

  it("survives a payload with no abilities", () => {
    expect(abilityOrderRows(null, 600)).toEqual([]);
  });
});

describe("itemSlots", () => {
  const purchases = [
    purchase({ time_s: 60, item_id: 1, item: "First" }),
    purchase({ time_s: 120, item_id: 2, item: "Sold later", sold_time_s: 200 }),
    purchase({ time_s: 180, item_id: 3, item: "Third" }),
    purchase({ account_id: 999, time_s: 60, item_id: 4, item: "Someone else" }),
  ];

  it("draws six slots", () => {
    expect(itemSlots(purchases, 101, 600)).toHaveLength(LANING_ITEM_SLOTS);
  });

  it("shows only what has been bought by the clock", () => {
    const slots = itemSlots(purchases, 101, 100);
    expect(slots[0].name).toBe("First");
    expect(slots[1].empty).toBe(true);
  });

  it("ignores another player's purchases", () => {
    const slots = itemSlots(purchases, 101, 600);
    expect(slots.map((slot) => slot.name)).not.toContain("Someone else");
  });

  it("empties a slot once the item is sold, moving the rest up", () => {
    const slots = itemSlots(purchases, 101, 600);
    expect(slots.slice(0, 2).map((slot) => slot.name)).toEqual(["First", "Third"]);
    expect(slots[2].empty).toBe(true);
  });

  it("keeps an item that is sold after the clock", () => {
    const slots = itemSlots(purchases, 101, 150);
    expect(slots.map((slot) => slot.name).slice(0, 2)).toEqual(["First", "Sold later"]);
  });

  it("is all empty for a player with no purchases", () => {
    expect(itemSlots(purchases, 555, 600).every((slot) => slot.empty)).toBe(true);
  });
});

describe("buildTableRows", () => {
  const laneRows = [
    {
      lane: 1,
      left: [player({ account_id: 101, player_slot: 1 }), player({ account_id: 102, player_slot: 2 })],
      right: [player({ account_id: 107, team: 1, player_slot: 7 })],
    },
    {
      lane: 4,
      left: [player({ account_id: 103, lane: 4 })],
      right: [player({ account_id: 108, team: 1, lane: 4, player_slot: 8 })],
    },
  ];
  const values = { 101: { kills: 2, deaths: 1, assists: 3 }, 102: { kills: 0, deaths: 2, assists: 1 }, 107: { kills: 1, deaths: 1, assists: 0 }, 103: {}, 108: {} };
  const valuesOf = (p) => values[p.account_id];
  const buildsFor = (p) => ({ abilities: [ability({ ability_id: p.account_id, upgrades: [{ tier: 0, game_time_s: 10 }] })] });
  const purchases = [purchase({ account_id: 101, time_s: 60, item: "Boots" })];

  const rows = buildTableRows({ laneRows, valuesOf, buildsFor, purchases, time: 300 });

  it("lists a row per pair, every lane in reading order", () => {
    expect(rows.map((row) => `${row.lane}-${row.key.split("-")[1]}`)).toEqual(["1-0", "1-1", "4-0"]);
  });

  it("pairs the two sides by position within the lane", () => {
    expect(rows[0].left.accountId).toBe(101);
    expect(rows[0].right.accountId).toBe(107);
  });

  it("leaves the missing side empty rather than shifting the pair", () => {
    expect(rows[1].left.accountId).toBe(102);
    expect(rows[1].right).toBeNull();
  });

  it("flags the start of each lane group and alternating fills", () => {
    expect(rows.map((row) => row.groupStart)).toEqual([false, false, true]);
    expect(rows.map((row) => row.alternate)).toEqual([false, true, false]);
  });

  it("carries the lane's name and colour for the middle cell", () => {
    expect(rows[0].laneName).toBe("York");
    expect(rows[0].laneColor).toBe("#facc15");
  });

  it("gives each side its laning K/D/A", () => {
    expect(rows[0].left.kda).toEqual({ kills: 2, deaths: 1, assists: 3 });
    expect(rows[0].right.kda).toEqual({ kills: 1, deaths: 1, assists: 0 });
  });

  it("gives each side its ability grid and items at the clock", () => {
    expect(rows[0].left.abilities[0].cells[0]).toMatchObject({ kind: "unlock" });
    expect(rows[0].left.items[0].name).toBe("Boots");
    expect(rows[0].right.items[0].empty).toBe(true);
  });

  it("narrows to one lane when asked", () => {
    const only = buildTableRows({ laneRows, valuesOf, buildsFor, purchases, time: 300, lane: 4 });
    expect(only).toHaveLength(1);
    expect(only[0].lane).toBe(4);
  });

  it("has no rows for a lane nobody played", () => {
    expect(buildTableRows({ laneRows, valuesOf, buildsFor, purchases, time: 300, lane: 6 })).toEqual([]);
  });
});

describe("LANING_LANE_OPTIONS", () => {
  it("offers All first, then the lanes in reading order", () => {
    expect(LANING_LANE_OPTIONS).toEqual([
      { id: null, name: "All" },
      { id: 1, name: "York" },
      { id: 4, name: "Broadway" },
      { id: 6, name: "Greenwich" },
    ]);
  });
});
