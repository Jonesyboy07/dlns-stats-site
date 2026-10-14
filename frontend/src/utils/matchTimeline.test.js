import { describe, expect, it } from "vitest";
import {
  buildPurchaseRows,
  buildTimelineRows,
  clock,
  mergeTimelineRows,
  objectiveLabel,
} from "./matchTimeline";

const players = [
  { player_slot: 1, account_id: 42, persona_name: "Kaizen", hero_id: 11, team: 0 },
  { player_slot: 9, account_id: 99, persona_name: "Nemesis", hero_id: 22, team: 1 },
];

const events = [
  {
    type: "death",
    time_s: 355,
    team: 0,
    player_slot: 1,
    hero_id: 11,
    killer_player_slot: 9,
    time_to_kill_s: 4.5,
    position: { x: 8255.0625, y: 958.53125, z: 256.03125 },
  },
  { type: "objective", time_s: 481, team: 1, objective_id: 3, lane: 4, player_damage: 4575 },
  { type: "mid_boss", time_s: 1047, team: 1, boss_index: 0 },
  { type: "objective", time_s: 1790, team: 0, objective_id: 9, lane: null, player_damage: 10183 },
];

describe("clock", () => {
  it("formats a match second as m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59)).toBe("0:59");
    expect(clock(355)).toBe("5:55");
    expect(clock(1903)).toBe("31:43");
  });

  it("returns an empty string for a missing time", () => {
    expect(clock(null)).toBe("");
    expect(clock(undefined)).toBe("");
  });
});

describe("objectiveLabel", () => {
  it("names each tier in the order the board is taken", () => {
    // Lane objectives climb Guardian -> Walker -> Base Guardian.
    expect(objectiveLabel(3)).toBe("Guardian");
    expect(objectiveLabel(7)).toBe("Walker");
    expect(objectiveLabel(12)).toBe("Base Guardian");
    // Then the base: shrines, the Patron's own guardian, and the Patron.
    expect(objectiveLabel(10)).toBe("Shrine");
    expect(objectiveLabel(9)).toBe("Patron Guardian");
    expect(objectiveLabel(0)).toBe("Patron");
  });

  it("names every slot the API can report", () => {
    const named = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(objectiveLabel);
    expect(named.every((label) => !label.startsWith("Objective "))).toBe(true);
  });

  it("falls back for an id it does not know", () => {
    expect(objectiveLabel(77)).toBe("Objective 77");
  });
});

describe("buildTimelineRows", () => {
  const rows = buildTimelineRows(events, players);

  it("keeps the feed's time order and one row per event", () => {
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.time_s)).toEqual([355, 481, 1047, 1790]);
  });

  it("names the killer from the in-game slot", () => {
    expect(rows[0].label).toBe("Kill");
    expect(rows[0].text).toBe("Kaizen killed by Nemesis");
    expect(rows[0].heroId).toBe(11);        // the victim's hero
    expect(rows[0].killerHeroId).toBe(22);  // the killer's hero
  });

  it("keeps the world position so the map can plot the same rows", () => {
    expect(rows[0].position).toEqual({ x: 8255.0625, y: 958.53125, z: 256.03125 });
    // Objectives have no position; the map simply skips them.
    expect(rows[1].position).toBeNull();
  });

  it("labels a lane objective with its lane name and colour", () => {
    const objective = rows[1];
    expect(objective.text).toBe("Broadway Guardian destroyed by Sapphire");
    expect(objective.lane).toBe(4);
    expect(objective.laneName).toBe("Broadway");
    expect(objective.laneColor).toBe("#22d3ee");
    expect(objective.damage).toBe(4575);
  });

  it("has no lane for objectives that belong to none", () => {
    expect(rows[3].lane).toBeNull();  // the Patron Guardian
    expect(rows[3].text).toBe("Patron Guardian destroyed by Amber");
  });

  it("describes a mid boss with the team that claimed it", () => {
    expect(rows[2].label).toBe("Mid Boss");
    expect(rows[2].text).toBe("Mid Boss killed, claimed by Sapphire");
  });

  it("uses the event team names when given", () => {
    const named = buildTimelineRows(events, players, (team) =>
      team === 0 ? "Melee Creeps" : "Pulsar Esports",
    );
    expect(named[3].text).toBe("Patron Guardian destroyed by Melee Creeps");
    expect(named[2].text).toBe("Mid Boss killed, claimed by Pulsar Esports");
  });

  it("still shows a death when the killer is not in the scoreboard", () => {
    const orphan = buildTimelineRows(
      [{ type: "death", time_s: 100, player_slot: 1, killer_player_slot: 5 }],
      players,
    );
    expect(orphan[0].text).toBe("Kaizen died");
    expect(orphan[0].killerHeroId).toBeNull();
  });

  it("handles an empty or missing feed", () => {
    expect(buildTimelineRows([], players)).toEqual([]);
    expect(buildTimelineRows()).toEqual([]);
  });
});

// Two purchases by the same player, one of them sold back later.
const purchases = [
  { item_id: 1, item: "Extra Spirit", icon: "items/spirit/extra_spirit_psd.png", image: null,
    time_s: 210, team: 0, account_id: 42, player_slot: 1, hero_id: 11,
    persona_name: "Kaizen", sold_time_s: 0 },
  { item_id: 2, item: "High-Velocity Rounds", icon: "items/weapon/high_velocity_rounds_psd.png",
    image: "https://cdn.example/items/hvr.png", time_s: 95, team: 0, account_id: 42,
    player_slot: 1, hero_id: 11, persona_name: "Kaizen", sold_time_s: 640 },
];

describe("buildPurchaseRows", () => {
  const rows = buildPurchaseRows(purchases);

  it("keeps the purchase time and the item it names", () => {
    expect(rows.map((row) => row.time_s)).toEqual([210, 95]);
    expect(rows[0].text).toBe("Extra Spirit");
    expect(rows[0].icon).toBe("items/spirit/extra_spirit_psd.png");
    expect(rows[0].accountId).toBe(42);
    expect(rows[0].heroId).toBe(11);
  });

  it("folds the sell into the same row instead of adding another", () => {
    // 0 is the API's "still owned", so only the sold one carries a time.
    expect(rows[0].soldTimeS).toBeNull();
    expect(rows[0].trailing).toBe("Kaizen");
    expect(rows[1].soldTimeS).toBe(640);
    expect(rows[1].trailing).toBe("Kaizen · sold 10:40");
  });

  it("carries no lane or position, so the map skips purchases", () => {
    expect(rows[0].position).toBeNull();
    expect(rows[0].lane).toBeNull();
    expect(rows[0].type).toBe("purchase");
  });

  it("survives a purchase with no catalogue entry", () => {
    const [row] = buildPurchaseRows([{ item_id: 7, time_s: 10 }]);
    expect(row.text).toBe("Unknown item");
    expect(row.icon).toBeNull();
    expect(row.trailing).toBe("");
  });

  it("handles an empty or missing list", () => {
    expect(buildPurchaseRows([])).toEqual([]);
    expect(buildPurchaseRows()).toEqual([]);
  });
});

describe("mergeTimelineRows", () => {
  const eventRows = buildTimelineRows(events, players);

  it("interleaves purchases with the events by time", () => {
    const merged = mergeTimelineRows(eventRows, buildPurchaseRows(purchases));

    expect(merged.map((row) => row.time_s)).toEqual([95, 210, 355, 481, 1047, 1790]);
    expect(merged.map((row) => row.type)).toEqual([
      "purchase", "purchase", "death", "objective", "mid_boss", "objective",
    ]);
  });

  it("puts an event above a purchase that shares its second", () => {
    const merged = mergeTimelineRows(
      [{ type: "death", time_s: 300 }],
      buildPurchaseRows([{ item_id: 1, item: "Extra Spirit", time_s: 300 }]),
    );

    expect(merged.map((row) => row.type)).toEqual(["death", "purchase"]);
  });

  it("sorts a purchase with no time to the end", () => {
    const merged = mergeTimelineRows(
      [{ type: "death", time_s: 355 }],
      buildPurchaseRows([{ item_id: 1, item: "Extra Spirit", time_s: null }]),
    );

    expect(merged.map((row) => row.type)).toEqual(["death", "purchase"]);
  });

  it("returns the events unchanged when no player is selected", () => {
    expect(mergeTimelineRows(eventRows, [])).toEqual(eventRows);
    expect(mergeTimelineRows()).toEqual([]);
  });
});
