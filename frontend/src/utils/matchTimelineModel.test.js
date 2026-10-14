import { describe, expect, it } from "vitest";
import {
  FIGHT_GAP_S,
  KEY_ITEM_MIN_TIER,
  SHUTDOWN_STREAK,
  buildFights,
  buildKills,
  buildObjectives,
  buildTimelineModel,
  indexPlayers,
  keyPurchases,
} from "./matchTimelineModel";

// Two sides of six, matching a real scoreboard. Slots 1-6 are amber, 7-12 sapphire.
const players = [
  ...[1, 2, 3, 4, 5, 6].map((slot) => ({
    player_slot: slot, team: 0, account_id: 100 + slot, hero_id: slot, persona_name: `Amber${slot}`,
  })),
  ...[7, 8, 9, 10, 11, 12].map((slot) => ({
    player_slot: slot, team: 1, account_id: 100 + slot, hero_id: slot, persona_name: `Sapphire${slot}`,
  })),
];

/** A death event shaped like `/events` returns. */
const death = (timeS, victimSlot, killerSlot, extra = {}) => ({
  type: "death",
  time_s: timeS,
  player_slot: victimSlot,
  killer_player_slot: killerSlot,
  death_duration_s: 20,
  position: { x: 1, y: 2, z: 0 },
  killer_position: { x: 3, y: 4, z: 0 },
  ...extra,
});

describe("indexPlayers", () => {
  it("keys players by their in-game slot", () => {
    const bySlot = indexPlayers(players);
    expect(bySlot.size).toBe(12);
    expect(bySlot.get(7).persona_name).toBe("Sapphire7");
  });

  it("ignores rows with no slot", () => {
    expect(indexPlayers([{ team: 0 }, { player_slot: 3, team: 0 }]).size).toBe(1);
  });

  it("handles an empty or missing list", () => {
    expect(indexPlayers().size).toBe(0);
    expect(indexPlayers([]).size).toBe(0);
  });
});

describe("buildKills", () => {
  const events = [
    death(60, 7, 1),   // first blood, amber 1 kills sapphire 7
    death(120, 8, 1),  // amber 1 again, inside the multi-kill window
    death(300, 9, 2, { death_duration_s: null }),  // no recorded respawn
  ];
  const kills = buildKills(events, { players });

  it("reads the killer's side, not the victim's", () => {
    expect(kills).toHaveLength(3);
    expect(kills[0].victimSlot).toBe(7);
    expect(kills[0].killerSlot).toBe(1);
    expect(kills[0].team).toBe(0);        // amber made the kill
    expect(kills[0].killedTeam).toBe(1);  // sapphire died
    expect(kills[0].killerName).toBe("Amber1");
    expect(kills[0].victimName).toBe("Sapphire7");
  });

  it("keeps the feed's order for deaths on the same second", () => {
    const sameSecond = buildKills([death(100, 7, 1), death(100, 8, 2)], { players });
    expect(sameSecond.map((kill) => kill.victimSlot)).toEqual([7, 8]);
  });

  it("badges the first kill of the match", () => {
    expect(kills[0].badges.map((badge) => badge.label)).toContain("First Blood");
    expect(kills[1].badges.map((badge) => badge.label)).not.toContain("First Blood");
  });

  it("chains kills by one player into a multi-kill", () => {
    // Both kills are by slot 1, 60s apart, which is outside the window.
    const quick = buildKills([death(100, 7, 1), death(105, 8, 1)], { players });
    expect(quick[0].badges.map((b) => b.label)).not.toContain("Double Kill");
    expect(quick[1].badges.map((b) => b.label)).toContain("Double Kill");
  });

  it("does not chain kills that are too far apart", () => {
    const slow = buildKills([death(100, 7, 1), death(100 + FIGHT_GAP_S * 2, 8, 1)], { players });
    expect(slow[1].badges.map((b) => b.label)).not.toContain("Double Kill");
  });

  it("badges a shutdown when the victim was on a streak", () => {
    // Slot 7 kills three, so the kill that ends that run is a shutdown.
    const streak = buildKills(
      [death(10, 8, 7), death(20, 9, 7), death(30, 10, 7), death(40, 7, 1)],
      { players },
    );
    expect(streak[3].badges.map((b) => b.label)).toContain("Shutdown");
    expect(streak[1].badges.map((b) => b.label)).not.toContain("Shutdown");
  });

  it("needs a full streak before it is a shutdown", () => {
    const short = buildKills([death(10, 8, 7), death(SHUTDOWN_STREAK * 100, 7, 1)], { players });
    expect(short[1].badges.map((b) => b.label)).not.toContain("Shutdown");
  });

  it("badges a team wipe once the last player of a side is down", () => {
    // Sapphire's six all die while each is still respawning.
    const wipe = buildKills(
      [7, 8, 9, 10, 11, 12].map((slot, i) => death(100 + i, slot, 1)),
      { players },
    );
    expect(wipe[5].badges.map((b) => b.label)).toContain("Team Wipe");
    expect(wipe[4].badges.map((b) => b.label)).not.toContain("Team Wipe");
  });

  it("uses the recorded respawn and marks an estimated one", () => {
    expect(kills[0].respawnS).toBe(20);
    expect(kills[0].respawnEstimated).toBe(false);
    expect(kills[0].untilS).toBe(80);
    // No recorded duration, so the site's estimate stands in rather than a hole.
    expect(kills[2].respawnEstimated).toBe(true);
    expect(kills[2].respawnS).toBeGreaterThan(0);
  });

  it("credits nobody when the API recorded no killer", () => {
    const [envDeath] = buildKills([death(50, 7, null)], { players });
    expect(envDeath.killerSlot).toBeNull();
    expect(envDeath.team).toBeNull();
    expect(envDeath.badges.map((b) => b.label)).not.toContain("Shutdown");
  });

  it("treats a killer slot that matches the victim as unrecorded", () => {
    const [selfDeath] = buildKills([death(50, 7, 7)], { players });
    expect(selfDeath.killerSlot).toBeNull();
  });

  it("keeps both ends of the kill line", () => {
    expect(kills[0].position).toEqual({ x: 1, y: 2, z: 0 });
    expect(kills[0].killerPosition).toEqual({ x: 3, y: 4, z: 0 });
    const [noPos] = buildKills([death(50, 7, 1, { killer_position: null })], { players });
    expect(noPos.killerPosition).toBeNull();
  });

  it("ignores events that are not deaths", () => {
    expect(buildKills([{ type: "objective", time_s: 10 }, death(20, 7, 1)], { players })).toHaveLength(1);
  });

  it("handles an empty or missing feed", () => {
    expect(buildKills([], { players })).toEqual([]);
    expect(buildKills()).toEqual([]);
  });
});

describe("buildFights", () => {
  const events = [
    // Three kills inside the gap window: a fight, amber 2-1.
    death(600, 7, 1), death(610, 8, 2), death(618, 1, 7),
    // A lone kill far away: not a fight.
    death(900, 9, 3),
  ];
  const kills = buildKills(events, { players });

  it("groups kills that are close together", () => {
    const fights = buildFights(kills);
    expect(fights).toHaveLength(1);
    expect(fights[0].kills).toHaveLength(3);
    expect(fights[0].amberKills).toBe(2);
    expect(fights[0].sapphireKills).toBe(1);
    expect(fights[0].winner).toBe(0);
    expect(fights[0].score).toBe("2–1");
  });

  it("pads the span either side of the kills", () => {
    const [fight] = buildFights(kills);
    expect(fight.startS).toBe(600 - 4);
    expect(fight.endS).toBe(618 + 4);
  });

  it("leaves a group smaller than the minimum alone", () => {
    // Only two of the three kills, so the group never reaches the minimum.
    expect(buildFights(kills.slice(0, 2))).toEqual([]);
  });

  it("reports an even fight as no winner", () => {
    // Two kills each, so neither side can be called the winner.
    const even = buildKills(
      [death(100, 7, 1), death(105, 8, 2), death(108, 1, 7), death(112, 2, 8)],
      { players },
    );
    const [fight] = buildFights(even);
    expect(fight.amberKills).toBe(2);
    expect(fight.sapphireKills).toBe(2);
    expect(fight.winner).toBeNull();
  });

  it("counts deaths with no killer toward neither side", () => {
    const mixed = buildKills(
      [death(100, 7, 1), death(105, 8, 2), death(108, 9, null)],
      { players },
    );
    const [fight] = buildFights(mixed);
    expect(fight.amberKills + fight.sapphireKills).toBe(2);
    expect(fight.unresolvedKills).toBe(1);
  });

  it("attaches the first objective taken soon after the fight", () => {
    const objectives = [
      { timeS: 1000, label: "Guardian" },   // too late
      { timeS: 630, label: "Walker" },      // inside the window
      { timeS: 640, label: "Shrine" },
    ];
    const [fight] = buildFights(kills, { objectives });
    expect(fight.objective.label).toBe("Walker");
  });

  it("leaves the follow-up empty when nothing was taken", () => {
    const [fight] = buildFights(kills, { objectives: [{ timeS: 5000, label: "Patron" }] });
    expect(fight.objective).toBeNull();
  });

  it("exposes the fight for each of its kills", () => {
    const [fight] = buildFights(kills);
    expect([...fight.killIds].sort()).toEqual([0, 1, 2]);
  });

  it("handles a feed with no fights at all", () => {
    expect(buildFights(kills.slice(3))).toEqual([]);
    expect(buildFights([])).toEqual([]);
    expect(buildFights()).toEqual([]);
  });
});

describe("buildObjectives", () => {
  const events = [
    { type: "objective", time_s: 481, team: 1, objective_id: 3, lane: 4, player_damage: 4575 },
    { type: "death", time_s: 500, player_slot: 1 },
  ];

  it("keeps only objective destructions", () => {
    const objectives = buildObjectives(events);
    expect(objectives).toHaveLength(1);
    expect(objectives[0].timeS).toBe(481);
    expect(objectives[0].objectiveId).toBe(3);
    expect(objectives[0].laneId).toBe(4);
    expect(objectives[0].damage).toBe(4575);
  });

  it("uses the supplied namers when given", () => {
    const [objective] = buildObjectives(events, {
      labelOf: (id) => `Objective ${id}`,
      laneOf: (id) => ({ name: `Lane ${id}`, color: "#fff" }),
    });
    expect(objective.label).toBe("Objective 3");
    expect(objective.laneName).toBe("Lane 4");
    expect(objective.laneColor).toBe("#fff");
  });

  it("leaves the lane empty for an objective that has none", () => {
    const [objective] = buildObjectives([
      { type: "objective", time_s: 10, team: 0, objective_id: 9, lane: null },
    ], { laneOf: () => null });
    expect(objective.laneId).toBeNull();
    expect(objective.laneName).toBeNull();
  });
});

describe("keyPurchases", () => {
  const purchases = [
    { time_s: 100, tier: 1, item: "Extra Regen", account_id: 1, player_slot: 1 },
    { time_s: 200, tier: KEY_ITEM_MIN_TIER, item: "Berserker", account_id: 1, player_slot: 1, sold_time_s: 900 },
    { time_s: 300, tier: 4, item: "Colossus", account_id: 2, player_slot: 2 },
  ];

  it("keeps only the items that are a power spike", () => {
    const key = keyPurchases(purchases);
    expect(key.map((purchase) => purchase.item)).toEqual(["Berserker", "Colossus"]);
  });

  it("carries the time, owner and sell time through", () => {
    const [first] = keyPurchases(purchases);
    expect(first.timeS).toBe(200);
    expect(first.accountId).toBe(1);
    expect(first.playerSlot).toBe(1);
    expect(first.soldTimeS).toBe(900);
  });

  it("drops a purchase with no tier", () => {
    expect(keyPurchases([{ time_s: 10, item: "Unknown" }])).toEqual([]);
  });

  it("handles an empty or missing list", () => {
    expect(keyPurchases([])).toEqual([]);
    expect(keyPurchases()).toEqual([]);
  });
});

describe("buildTimelineModel", () => {
  const events = [
    death(600, 7, 1),
    death(610, 8, 2),
    death(618, 1, 7),
    { type: "objective", time_s: 630, team: 0, objective_id: 5, lane: 1, player_damage: 100 },
    { type: "mid_boss", time_s: 1047, team: 1 },
  ];

  it("derives the whole timeline in one call", () => {
    const model = buildTimelineModel({
      events,
      players,
      durationS: 1903,
      purchases: [{ time_s: 300, tier: 4, item: "Colossus", account_id: 101, player_slot: 1 }],
    });

    expect(model.durationS).toBe(1903);
    expect(model.kills).toHaveLength(3);
    expect(model.objectives).toHaveLength(1);
    expect(model.fights).toHaveLength(1);
    expect(model.keyPurchases).toHaveLength(1);
    expect(model.playersBySlot.get(1).persona_name).toBe("Amber1");
  });

  it("resolves the fight a kill belongs to", () => {
    const model = buildTimelineModel({ events, players });
    expect(model.fightForKill(0).score).toBe("2–1");
    expect(model.fightForKill(99)).toBeUndefined();
  });

  it("keeps mid boss kills out of the objective list", () => {
    const model = buildTimelineModel({ events, players });
    expect(model.objectives.map((objective) => objective.objectiveId)).toEqual([5]);
  });

  it("handles an empty match", () => {
    const model = buildTimelineModel({});
    expect(model.kills).toEqual([]);
    expect(model.fights).toEqual([]);
    expect(model.objectives).toEqual([]);
    expect(model.keyPurchases).toEqual([]);
    expect(model.durationS).toBeNull();
  });
});
