import { describe, expect, it } from "vitest";
import { MAP_RADIUS } from "./matchMap";
import {
  DOT_SIZE,
  HEAT_COLORS,
  MAP_MODE_LABELS,
  MAP_MODES,
  MAP_SIZE,
  RECENT_WINDOW_S,
  buildMapView,
  dotFor,
  heatDeaths,
  heatGroups,
  killInvolves,
  killLine,
  lineDeaths,
  mapCaption,
  mapPoint,
  plottableDeaths,
  trailCaption,
  trailMarkers,
} from "./matchTimelineMap";

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
  position: { x: 0, y: 0, z: 0 },
  killerPosition: { x: MAP_RADIUS / 2, y: MAP_RADIUS / 2, z: 0 },
  ...overrides,
});

describe("mapPoint", () => {
  it("maps the world origin to the centre of the map", () => {
    expect(mapPoint({ x: 0, y: 0 })).toEqual({ x: MAP_SIZE / 2, y: MAP_SIZE / 2 });
  });

  it("maps the playfield's top-left corner to the image's origin", () => {
    const point = mapPoint({ x: -MAP_RADIUS, y: MAP_RADIUS });
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it("scales with the requested size", () => {
    expect(mapPoint({ x: 0, y: 0 }, 100)).toEqual({ x: 50, y: 50 });
  });

  it("returns null for an incomplete position", () => {
    expect(mapPoint(null)).toBeNull();
    expect(mapPoint({ x: 1 })).toBeNull();
    expect(mapPoint({ x: 1, y: "nope" })).toBeNull();
  });
});

describe("killInvolves", () => {
  it("is true when either end is highlighted", () => {
    expect(killInvolves(kill(), [101])).toBe(true);  // the killer
    expect(killInvolves(kill(), [107])).toBe(true);  // the victim
  });

  it("is false for an unrelated player, and for no selection at all", () => {
    expect(killInvolves(kill(), [999])).toBe(false);
    expect(killInvolves(kill(), [])).toBe(false);
  });
});

describe("plottableDeaths", () => {
  const kills = [
    kill({ id: 0, timeS: 100 }),
    kill({ id: 1, timeS: 200 }),
    kill({ id: 2, timeS: 300 }),
    kill({ id: 3, timeS: 400, position: null }),
  ];

  it("keeps only deaths that have happened by the clock", () => {
    expect(plottableDeaths(kills, { t: 250 }).map((k) => k.id)).toEqual([0, 1]);
  });

  it("drops deaths with no position, since there is nothing to plot", () => {
    expect(plottableDeaths(kills, { t: 500 }).map((k) => k.id)).toEqual([0, 1, 2]);
  });

  it("narrows to the last three minutes on the recent window", () => {
    // At t=400 the window opens at 220, so only the 300s death is inside it...
    expect(plottableDeaths(kills, { t: 400, range: "recent" }).map((k) => k.id)).toEqual([2]);
    expect(RECENT_WINDOW_S).toBe(180);
    // ...and at t=380 it opens at the 200s death, which comes back into view.
    expect(plottableDeaths(kills, { t: 380, range: "recent" }).map((k) => k.id)).toEqual([1, 2]);
  });

  it("shows the whole match when no clock is given", () => {
    expect(plottableDeaths(kills).map((k) => k.id)).toEqual([0, 1, 2]);
  });

  it("ignores the clock and the window while a fight is focused", () => {
    const focused = {
      kills: [kill({ id: 3, timeS: 900 }), kill({ id: 2, timeS: 500, position: null })],
    };
    const shown = plottableDeaths(kills, { t: 100, range: "recent", focusedFight: focused });
    // t=100 and a 180s window would exclude both, but focusing a fight overrides
    // them; the positionless kill still drops out.
    expect(shown.map((k) => k.id)).toEqual([3]);
  });

  it("handles an empty or missing list", () => {
    expect(plottableDeaths([])).toEqual([]);
    expect(plottableDeaths()).toEqual([]);
  });
});

describe("heatGroups", () => {
  const deaths = [
    kill({ id: 0, killedTeam: 1, victimAccountId: 107 }),
    kill({ id: 1, killedTeam: 1, victimAccountId: 108 }),
    kill({ id: 2, killedTeam: 0, victimAccountId: 101 }),
  ];

  it("splits by the side that died", () => {
    const groups = heatGroups(deaths, { color: "team" });
    expect(groups).toHaveLength(2);
    expect(groups[0].color).toBe(HEAT_COLORS.amber);
    expect(groups[0].deaths.map((d) => d.id)).toEqual([2]);  // team 0 died
    expect(groups[1].color).toBe(HEAT_COLORS.sapphire);
    expect(groups[1].deaths.map((d) => d.id)).toEqual([0, 1]);
  });

  it("uses one colour when asked for single", () => {
    const groups = heatGroups(deaths, { color: "single" });
    expect(groups).toHaveLength(1);
    expect(groups[0].color).toBe(HEAT_COLORS.single);
    expect(groups[0].deaths).toHaveLength(3);
  });

  it("keeps only a highlighted player's own deaths", () => {
    // Slot 108 dies twice; being the killer elsewhere should not add heat.
    const withKills = [
      kill({ id: 0, killedTeam: 1, victimAccountId: 108 }),
      kill({ id: 1, killedTeam: 1, victimAccountId: 109, killerAccountId: 108 }),
      kill({ id: 2, killedTeam: 0, victimAccountId: 108 }),
    ];
    expect(heatDeaths(withKills, { selection: [108] }).map((d) => d.id)).toEqual([0, 2]);
  });

  it("drops a group with no deaths in it", () => {
    const onlyAmber = heatGroups([kill({ killedTeam: 0 })], { color: "team" });
    expect(onlyAmber).toHaveLength(1);
  });
});

describe("killLine", () => {
  it("runs from the killer to the victim", () => {
    // Killer at (R/2, R/2): left = (R/2 + R) / 2R = 0.75, top = (R - R/2) / 2R = 0.25.
    // Victim at the origin is the centre.
    const line = killLine(kill());
    expect(line.x1).toBeCloseTo(MAP_SIZE * 0.75);
    expect(line.y1).toBeCloseTo(MAP_SIZE * 0.25);
    expect(line.x2).toBeCloseTo(MAP_SIZE / 2);
    expect(line.y2).toBeCloseTo(MAP_SIZE / 2);
  });

  it("scales with the requested map size", () => {
    const line = killLine(kill(), 100);
    expect(line.x1).toBeCloseTo(75);
    expect(line.y1).toBeCloseTo(25);
  });

  it("has no line when the killer's position was never recorded", () => {
    expect(killLine(kill({ killerPosition: null }))).toBeNull();
  });

  it("has no line when the victim's position is missing", () => {
    expect(killLine(kill({ position: null }))).toBeNull();
  });
});

describe("lineDeaths", () => {
  const deaths = [kill({ id: 0, killerAccountId: 101 }), kill({ id: 1, killerAccountId: 999 })];

  it("draws nothing when lines are off", () => {
    expect(lineDeaths(deaths, { lines: "off", hoveredKillId: 0 })).toEqual([]);
  });

  it("draws only the hovered kill", () => {
    expect(lineDeaths(deaths, { lines: "hover", hoveredKillId: 1 })).toEqual([deaths[1]]);
  });

  it("draws nothing while hovering nothing", () => {
    expect(lineDeaths(deaths, { lines: "hover", hoveredKillId: null })).toEqual([]);
  });

  it("draws every visible kill when asked for all", () => {
    expect(lineDeaths(deaths, { lines: "all" })).toHaveLength(2);
  });

  it("narrows 'all' to the highlighted players", () => {
    const scoped = lineDeaths(deaths, { lines: "all", selection: [101] });
    expect(scoped.map((k) => k.id)).toEqual([0]);
  });
});

describe("dotFor", () => {
  it("rests at the base size", () => {
    const dot = dotFor(kill(), { t: 1000, durationS: 1000 });
    expect(dot.size).toBe(DOT_SIZE.base);
    expect(dot.opacity).toBe(1);
    expect(dot.hollow).toBe(false);
  });

  it("sits smaller over the heat on the both mode", () => {
    expect(dotFor(kill(), { mode: "both" }).size).toBe(DOT_SIZE.both);
  });

  it("grows the kills a highlighted player was in, shrinking the rest", () => {
    const involved = dotFor(kill({ killerAccountId: 101 }), { selection: [101] });
    const other = dotFor(kill({ killerAccountId: 999, victimAccountId: 998 }), { selection: [101] });
    expect(involved.size).toBe(DOT_SIZE.highlighted);
    expect(involved.opacity).toBe(1);
    expect(other.size).toBe(DOT_SIZE.faded);
    expect(other.opacity).toBe(0.15);
  });

  it("draws a highlighted player's own death hollow", () => {
    const own = dotFor(kill({ victimAccountId: 107, killerAccountId: 999 }), { selection: [107] });
    expect(own.hollow).toBe(true);
  });

  it("does not hollow a death between two highlighted players", () => {
    const both = dotFor(kill({ victimAccountId: 107, killerAccountId: 101 }), { selection: [107, 101] });
    expect(both.hollow).toBe(false);
  });

  it("grows and rings a death in the last forty seconds", () => {
    const fresh = dotFor(kill({ timeS: 970 }), { t: 1000, durationS: 2000 });
    expect(fresh.fresh).toBe(true);
    expect(fresh.size).toBe(DOT_SIZE.base + DOT_SIZE.freshBonus);

    const old = dotFor(kill({ timeS: 900 }), { t: 1000, durationS: 2000 });
    expect(old.fresh).toBe(false);
    expect(old.size).toBe(DOT_SIZE.base);
  });

  it("does not ring a fresh death once the match has ended", () => {
    // At the end of the match every death is "recent", which would ring them all.
    const atEnd = dotFor(kill({ timeS: 1970 }), { t: 2000, durationS: 2000 });
    expect(atEnd.fresh).toBe(false);
  });

  it("does not ring a fresh death while a fight is focused", () => {
    const inFight = dotFor(kill({ timeS: 970 }), {
      t: 1000, durationS: 2000, focusedFight: { index: 0 },
    });
    expect(inFight.fresh).toBe(false);
  });

  it("returns null when the death has no position", () => {
    expect(dotFor(kill({ position: null }))).toBeNull();
  });
});

describe("mapCaption", () => {
  it("leads with how many deaths are shown", () => {
    expect(mapCaption({ shown: 23, lines: "off" })).toBe("23 deaths shown");
  });

  it("names the fight it is focused on", () => {
    const caption = mapCaption({ shown: 5, lines: "off", focusedFight: { index: 2 } });
    expect(caption).toContain("Fight 3: 5 deaths");
  });

  it("notes the killer ring whenever lines are drawable", () => {
    expect(mapCaption({ shown: 5, lines: "off" })).not.toContain("ring");
    expect(mapCaption({ shown: 5, lines: "off", focusedFight: { index: 0 } })).toContain(
      "ring = killer position",
    );
  });

  it("describes the highlighted players", () => {
    const caption = mapCaption({ shown: 3, selection: [1, 2], names: ["ABL", "sanya"] });
    expect(caption).toContain("ABL, sanya highlighted (hollow = their deaths)");
  });

  it("explains the heat colours by team", () => {
    const caption = mapCaption({
      shown: 3, mode: "heat", heatColor: "team", teamNames: ["Hidden King", "Archmother"],
    });
    expect(caption).toContain("heat: amber = Hidden King deaths, blue = Archmother deaths");
  });

  it("says nothing about heat while the mode is dots", () => {
    expect(mapCaption({ shown: 3, mode: "deaths" })).not.toContain("heat");
  });

  it("mentions the ring only when lines are drawn", () => {
    expect(mapCaption({ shown: 3, lines: "all" })).toContain("ring = killer position");
    expect(mapCaption({ shown: 3, lines: "off" })).not.toContain("ring");
  });
});

describe("trailCaption", () => {
  it("counts the tracked players and names what the ring means", () => {
    expect(trailCaption(12)).toBe("12 players tracked · ring = their side");
  });

  it("stays singular for a lone player", () => {
    expect(trailCaption(1)).toBe("1 player tracked · ring = their side");
  });

  it("says the trails are missing rather than reporting zero players", () => {
    // "0 players tracked" on an empty map reads like a bug, when the truth is that the
    // match has no recorded trails at all.
    expect(trailCaption(0)).toBe("No position trails recorded for this match");
    expect(trailCaption()).toBe("No position trails recorded for this match");
  });
});

describe("trailMarkers", () => {
  // A trail with one sample per second, at world positions the playfield accepts.
  // Long enough that a clock well into a match still has a position to report.
  const trail = (slot, accountId, team, heroId) => {
    const count = 120;
    const samples = new Int16Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      samples[index * 2] = index * 50;  // x, well inside the ±10752 playfield
      samples[index * 2 + 1] = 0;       // y
    }
    return {
      player: { player_slot: slot, account_id: accountId, team, hero_id: heroId, persona_name: `P${slot}` },
      samples,
      count,
    };
  };

  const trails = [trail(1, 101, 0, 11), trail(7, 107, 1, 22)];

  it("places a living player by their trail", () => {
    const markers = trailMarkers(trails, [], 1);
    expect(markers).toHaveLength(2);
    // The sample at t=1 is x=50 -> left = (50 + radius) / 2 * radius.
    expect(markers[0].left).toBeCloseTo(((50 + MAP_RADIUS) / (2 * MAP_RADIUS)) * 100, 4);
    expect(markers[0].dead).toBe(false);
    expect(markers[0].name).toBe("P1");
  });

  it("pins a dead player where they fell, with the recorded countdown", () => {
    const kills = [
      {
        id: 0, victimAccountId: 101, timeS: 1, untilS: 61,
        respawnS: 60, respawnEstimated: false,
        position: { x: 2000, y: 0, z: 0 }, team: 1, killerName: "P7",
      },
    ];
    const [marker] = trailMarkers(trails, kills, 31);
    expect(marker.dead).toBe(true);
    expect(marker.respawnIn).toBe(30);
    // The death position, not the trail position: a marker must not slide off its corpse.
    expect(marker.left).toBeCloseTo(((2000 + MAP_RADIUS) / (2 * MAP_RADIUS)) * 100, 4);
  });

  it("uses the recorded respawn, not the site's estimate", () => {
    // The estimate for t=1 would be ~6s; the recorded duration is 60s.
    const kills = [{ id: 0, victimAccountId: 101, timeS: 1, untilS: 61, respawnS: 60, position: { x: 0, y: 0 } }];
    expect(trailMarkers(trails, kills, 10)[0].dead).toBe(true);
    expect(trailMarkers(trails, kills, 62)[0].dead).toBe(false);
  });

  it("brings a player back once the respawn ends", () => {
    const kills = [{ id: 0, victimAccountId: 101, timeS: 1, untilS: 61, respawnS: 60, position: { x: 0, y: 0 } }];
    expect(trailMarkers(trails, kills, 61)[0].dead).toBe(false);
  });

  it("skips a player the trail cannot place", () => {
    // Past the end of a 120-sample trail.
    expect(trailMarkers(trails, [], 500)).toEqual([]);
  });

  it("returns nothing without a usable clock", () => {
    // A null clock once read as second 0 and stacked every player on the spawn.
    expect(trailMarkers(trails, [], null)).toEqual([]);
    expect(trailMarkers(trails, [], Number.NaN)).toEqual([]);
  });

  it("handles no trails", () => {
    expect(trailMarkers([], [], 10)).toEqual([]);
    expect(trailMarkers()).toEqual([]);
  });
});

describe("buildMapView", () => {
  const kills = [
    kill({ id: 0, timeS: 100, killerAccountId: 101, victimAccountId: 107 }),
    kill({ id: 1, timeS: 200, killerAccountId: 102, victimAccountId: 108, killedTeam: 1 }),
    kill({ id: 2, timeS: 300, killerAccountId: 103, victimAccountId: 109, team: 1, killedTeam: 0 }),
  ];

  it("plots the deaths that have happened, with their dots", () => {
    const view = buildMapView({ kills, t: 250 });
    expect(view.dots.map((entry) => entry.kill.id)).toEqual([0, 1]);
    expect(view.deaths).toHaveLength(2);
  });

  it("leaves the heat empty on the deaths mode", () => {
    expect(buildMapView({ kills, t: 400, mode: "deaths" }).heat).toEqual([]);
  });

  it("names its modes as the tabs are labelled", () => {
    expect(MAP_MODES).toEqual(["deaths", "heat", "both", "realtime"]);
    expect(MAP_MODES.map((mode) => MAP_MODE_LABELS[mode])).toEqual([
      "Deaths",
      "Heatmap",
      "Both",
      "Realtime",
    ]);
  });

  it("keeps only the last three minutes of deaths on the realtime mode", () => {
    // A cross that lingered for a whole match would be a plot, not a position view.
    const realtime = buildMapView({ kills, t: 400, mode: "realtime" });
    expect(realtime.deaths.map((kill) => kill.id)).toEqual([2]);
    expect(realtime.dots.map((entry) => entry.kill.id)).toEqual([2]);
  });

  it("shows deaths alongside the player positions on the realtime mode", () => {
    // The crosses sit on top of the positions now, rather than being swapped out.
    expect(buildMapView({ kills, t: 400, mode: "realtime" }).dots).not.toEqual([]);
  });

  it("still shows the whole match's deaths on the deaths mode", () => {
    expect(buildMapView({ kills, t: 400, mode: "deaths" }).deaths).toHaveLength(3);
  });

  it("leaves the heat empty on the realtime mode too", () => {
    // The heat layer plots deaths as a density, which realtime does not claim to be.
    expect(buildMapView({ kills, t: 400, mode: "realtime" }).heat).toEqual([]);
  });

  it("builds heat groups on the heat and both modes", () => {
    const heat = buildMapView({ kills, t: 400, mode: "heat" });
    expect(heat.heat).toHaveLength(2);
    // Heat hides the dots so the two do not fight for the same pixels.
    expect(heat.dots).toEqual([]);

    const both = buildMapView({ kills, t: 400, mode: "both" });
    expect(both.heat).toHaveLength(2);
    expect(both.dots).toHaveLength(3);
  });

  it("draws no lines until one is hovered", () => {
    expect(buildMapView({ kills, t: 400, lines: "hover" }).lines).toEqual([]);
    const hovered = buildMapView({ kills, t: 400, lines: "hover", hoveredKillId: 1 });
    expect(hovered.lines.map((line) => line.killId)).toEqual([1]);
  });

  it("dims the other lines while one is hovered", () => {
    const view = buildMapView({ kills, t: 400, lines: "all", hoveredKillId: 1 });
    const dimmed = view.lines.filter((line) => line.killId !== 1);
    expect(dimmed).toHaveLength(2);
    expect(dimmed.every((line) => line.opacity < 1)).toBe(true);
  });

  it("colours a line by the killer's side", () => {
    const view = buildMapView({ kills, t: 400, lines: "all" });
    expect(view.lines[0].color).toBe("var(--color-team-amber)");
    expect(view.lines[2].color).toBe("var(--color-team-sapphire)");
  });

  it("skips a line whose killer position is missing", () => {
    const view = buildMapView({ kills: [kill({ killerPosition: null })], t: 400, lines: "all" });
    expect(view.lines).toEqual([]);
  });

  it("falls back to the visible deaths when the options are empty", () => {
    const view = buildMapView({});
    expect(view.dots).toEqual([]);
    expect(view.heat).toEqual([]);
    expect(view.lines).toEqual([]);
    expect(view.size).toBe(MAP_SIZE);
  });
});
