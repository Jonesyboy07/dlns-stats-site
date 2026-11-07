import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  heroRows,
  mostBanned,
  nextSort,
  parseSort,
  scatterPoints,
  signedDelta,
  sortHeroes,
  winColor,
} from "./heroMeta";

const HEROES = [
  { hero_id: 1, name: "Venator", picks: 16, wins: 8, bans: 2, contested: 18 },
  { hero_id: 2, name: "Mo & Krill", picks: 14, wins: 10, bans: 4, contested: 18 },
  { hero_id: 3, name: "Abrams", picks: 7, wins: 3, bans: 0, contested: 7 },
  { hero_id: 4, name: "Victor", picks: 2, wins: 0, bans: 0, contested: 2 },
];

describe("sort param", () => {
  it("parses known columns and falls back otherwise", () => {
    expect(parseSort("win-asc")).toEqual({ column: "win", dir: "asc" });
    expect(parseSort("WIN-DESC")).toEqual({ column: "win", dir: "desc" });
    expect(parseSort("nope-desc")).toEqual(DEFAULT_SORT);
    expect(parseSort("win")).toEqual(DEFAULT_SORT);
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
  });

  it("flips the active column and starts new ones descending, Hero A→Z", () => {
    expect(nextSort({ column: "contest", dir: "desc" }, "contest")).toEqual({ column: "contest", dir: "asc" });
    expect(nextSort({ column: "contest", dir: "asc" }, "win")).toEqual({ column: "win", dir: "desc" });
    expect(nextSort({ column: "win", dir: "desc" }, "hero")).toEqual({ column: "hero", dir: "asc" });
  });
});

describe("heroRows and sortHeroes", () => {
  const rows = heroRows(HEROES, 18);

  it("works out rates over games, win over picks", () => {
    expect(rows[0].pick).toBeCloseTo(88.89, 1);
    expect(rows[1].ban).toBeCloseTo(22.22, 1);
    expect(rows[0].contest).toBe(100);
    expect(rows[1].win).toBeCloseTo(71.43, 1);
  });

  it("breaks ties by picks", () => {
    expect(sortHeroes(rows, DEFAULT_SORT).map((h) => h.hero_id)).toEqual([1, 2, 3, 4]);
    // Same tie-break whichever way the column runs.
    expect(sortHeroes(rows, { column: "contest", dir: "asc" }).map((h) => h.hero_id)).toEqual([4, 3, 1, 2]);
  });

  it("sorts by name and by win rate", () => {
    expect(sortHeroes(rows, { column: "hero", dir: "asc" }).map((h) => h.name)[0]).toBe("Abrams");
    expect(sortHeroes(rows, { column: "win", dir: "desc" }).map((h) => h.hero_id)).toEqual([2, 1, 3, 4]);
  });

  it("is safe with no games", () => {
    expect(heroRows(HEROES, 0)[0].pick).toBe(0);
  });
});

describe("winColor", () => {
  it("colours by band and dims low samples", () => {
    expect(winColor(60, 10)).toBe("var(--color-success)");
    expect(winColor(40, 10)).toBe("var(--color-danger-text)");
    expect(winColor(50, 10)).toBe("var(--color-secondary)");
    expect(winColor(0, 2)).toBe("var(--color-dim)");
  });
});

describe("mostBanned", () => {
  it("ranks by bans and drops the unbanned", () => {
    expect(mostBanned(heroRows(HEROES, 18)).map((h) => h.hero_id)).toEqual([2, 1]);
  });
});

describe("signedDelta", () => {
  it("uses a plus and a true minus", () => {
    expect(signedDelta(28.6)).toBe("+28.6");
    expect(signedDelta(-19.8)).toBe("−19.8");
  });
});

describe("scatterPoints", () => {
  it("clamps y away from the edges and fans out duplicates", () => {
    const points = scatterPoints(
      [
        { hero_id: 1, name: "A", picks: 2, wins: 0 },
        { hero_id: 2, name: "B", picks: 2, wins: 0 },
        { hero_id: 3, name: "C", picks: 2, wins: 2 },
      ],
      18,
    );
    expect(points[0].y).toBe(6);
    expect(points[2].y).toBe(94);
    expect(points[0].win).toBe(0);
    expect(points[1].x - points[0].x).toBeCloseTo(3.2, 5);
  });
});
