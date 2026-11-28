import { describe, expect, it } from "vitest";
import {
  demoSoulLeadSeries,
  demoValueAt,
  fightDemoStats,
  hasDemo,
  sampleIndex,
  withFightDemoStats,
} from "./matchTimelineDemo";

/** A `/demo` response: two players a side would do, one each keeps it readable. */
const demo = {
  available: true,
  step_s: 1,
  sample_count: 6,
  players: {
    11: { account_id: 11, hero_id: 1, team: 0, souls: [0, 100, 300, 600, 900, 1000], assists: [0, 0, 1, 1, 2, 2] },
    22: { account_id: 22, hero_id: 2, team: 1, souls: [0, 200, 250, 300, 800, 1500], assists: [0, 0, 0, 1, 1, 1] },
  },
  // [time_s, attacker, victim, damage]
  damage: [
    [1, 11, 22, 50],
    [2, 22, 11, 400],
    [3, 11, 22, 300],
    [3, 11, 22, 200],
    [5, 22, 11, 900],
  ],
};

describe("hasDemo", () => {
  it("needs a parsed demo with series", () => {
    expect(hasDemo(demo)).toBe(true);
    expect(hasDemo({ available: false })).toBe(false);
    expect(hasDemo({ available: true, players: {} })).toBe(false);
    expect(hasDemo(null)).toBe(false);
  });
});

describe("demoValueAt", () => {
  it("reads the sample for the second, not an interpolation", () => {
    expect(demoValueAt(demo, 11, "souls", 2.9)).toBe(300);
    expect(demoValueAt(demo, 11, "assists", 4)).toBe(2);
  });

  it("clamps to the series and is null for an unknown player or field", () => {
    expect(demoValueAt(demo, 11, "souls", 999)).toBe(1000);
    expect(demoValueAt(demo, 11, "souls", -5)).toBe(0);
    expect(demoValueAt(demo, 99, "souls", 1)).toBeNull();
    expect(demoValueAt(demo, 11, "level", 1)).toBeNull();
  });

  it("honours a coarser step", () => {
    expect(sampleIndex({ step_s: 5 }, 12, 10)).toBe(2);
  });
});

describe("demoSoulLeadSeries", () => {
  it("sums each side every second in soulLeadSeries' shape", () => {
    const series = demoSoulLeadSeries(demo);
    expect(series).toHaveLength(6);
    expect(series[1]).toEqual({ timeS: 1, lead: -100, souls: [100, 200] });
    expect(series[3]).toEqual({ timeS: 3, lead: 300, souls: [600, 300] });
  });

  it("is empty without a demo", () => {
    expect(demoSoulLeadSeries({ available: false })).toEqual([]);
  });
});

describe("fightDemoStats", () => {
  const players = new Map([
    [11, { account_id: 11, persona_name: "ABL", hero_id: 1, team: 0 }],
    [22, { account_id: 22, persona_name: "B22", hero_id: 2, team: 1 }],
  ]);

  it("gives each side's souls gained and the top damage dealer", () => {
    const stats = fightDemoStats({ startS: 1, endS: 4 }, demo, players);
    // Amber 100 -> 900, Sapphire 200 -> 800 between seconds 1 and 4.
    expect(stats.soulsGained).toEqual([800, 600]);
    // 11 dealt 50 + 300 + 200 inside the window; 22 dealt 400 (its 900 at 5s is after).
    expect(stats.topDamage).toMatchObject({ accountId: 11, damage: 550, name: "ABL", team: 0 });
  });

  it("falls back to the demo's hero and team for a player missing from the roster", () => {
    const stats = fightDemoStats({ startS: 5, endS: 5 }, demo, new Map());
    expect(stats.topDamage).toMatchObject({ accountId: 22, damage: 900, heroId: 2, team: 1, name: null });
  });

  it("has no top damage in a window without any", () => {
    expect(fightDemoStats({ startS: 0, endS: 0 }, demo, players).topDamage).toBeNull();
  });

  it("is null without a demo", () => {
    expect(fightDemoStats({ startS: 1, endS: 4 }, { available: false })).toBeNull();
  });
});

describe("withFightDemoStats", () => {
  it("attaches stats to every fight", () => {
    const [fight] = withFightDemoStats([{ index: 0, startS: 1, endS: 4 }], demo, []);
    expect(fight.demoStats.soulsGained).toEqual([800, 600]);
  });

  it("returns the very same fights without a demo", () => {
    const fights = [{ index: 0, startS: 1, endS: 4 }];
    expect(withFightDemoStats(fights, null)).toBe(fights);
  });
});
