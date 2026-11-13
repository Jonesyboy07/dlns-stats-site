import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_SORT,
  DEFAULT_MIN_GAMES,
  filterItems,
  itemRows,
  itemSections,
  nextItemSort,
  parseChoice,
  parseItemSort,
  parseMinGames,
  parseSlot,
  parseTiers,
  rankItems,
  sortItems,
  summaryPicks,
  winRateColor,
  ITEM_VIEWS,
  buyTimingBars,
  earlyLateSplit,
  heroBuildRows,
  isSignature,
  playerBuildRows,
} from "./items";

const ITEMS = [
  { id: 1, name: "Headshot Booster", slot: "weapon", tier: 1, cost: 800, games: 40, wins: 22, sold: 30, median_buy_s: 190 },
  { id: 2, name: "Toxic Bullets", slot: "weapon", tier: 3, cost: 3200, games: 20, wins: 12, sold: 1, median_buy_s: 860 },
  { id: 3, name: "Extra Health", slot: "vitality", tier: 1, cost: 800, games: 50, wins: 24, sold: 40, median_buy_s: 160 },
  { id: 4, name: "Lucky Shot", slot: "weapon", tier: 4, cost: 6400, games: 3, wins: 3, sold: 0, median_buy_s: 1670 },
];
const ROWS = itemRows(ITEMS, 100);

describe("rates", () => {
  it("works out pick, win and sell rates in percent", () => {
    const toxic = ROWS.find((row) => row.id === 2);
    expect(toxic.pick).toBe(20);
    expect(toxic.win).toBe(60);
    expect(toxic.sell).toBe(5);
  });

  it("does not divide by zero", () => {
    expect(itemRows([{ games: 0, wins: 0, sold: 0 }], 0)[0]).toMatchObject({ pick: 0, win: 0, sell: 0 });
  });
});

describe("win colour", () => {
  it("is green from 52, red under 48, neutral between, muted when low", () => {
    expect(winRateColor(52)).toBe("var(--color-success)");
    expect(winRateColor(47.9)).toBe("var(--color-danger-text)");
    expect(winRateColor(50)).toBe("var(--color-secondary)");
    expect(winRateColor(70, true)).toBe("var(--color-muted)");
  });
});

describe("filters", () => {
  it("filters by slot, tiers and name", () => {
    expect(filterItems(ROWS, { slot: "weapon" }).map((row) => row.id)).toEqual([1, 2, 4]);
    expect(filterItems(ROWS, { tiers: [1] }).map((row) => row.id)).toEqual([1, 3]);
    expect(filterItems(ROWS, { q: "  toxic " }).map((row) => row.id)).toEqual([2]);
    expect(filterItems(ROWS, { slot: "spirit" })).toEqual([]);
  });
});

describe("sort", () => {
  it("parses the param and falls back to win rate, highest first", () => {
    expect(parseItemSort("buy-asc")).toEqual({ key: "buy", dir: "asc" });
    expect(parseItemSort("nope-desc")).toEqual(DEFAULT_ITEM_SORT);
    expect(parseItemSort(null)).toEqual(DEFAULT_ITEM_SORT);
  });

  it("flips the active column; name and buy time start ascending", () => {
    expect(nextItemSort({ key: "win", dir: "desc" }, "win")).toEqual({ key: "win", dir: "asc" });
    expect(nextItemSort({ key: "win", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextItemSort({ key: "win", dir: "desc" }, "buy")).toEqual({ key: "buy", dir: "asc" });
    expect(nextItemSort({ key: "win", dir: "desc" }, "games")).toEqual({ key: "games", dir: "desc" });
  });

  it("sorts with ties going to more games", () => {
    expect(sortItems(ROWS, { key: "cost", dir: "asc" }).map((row) => row.id)).toEqual([3, 1, 2, 4]);
    expect(sortItems(ROWS, { key: "name", dir: "asc" }).map((row) => row.id)).toEqual([3, 1, 4, 2]);
  });
});

describe("ranking", () => {
  it("ranks items with enough games and sinks low samples, unranked", () => {
    const ranked = rankItems(ROWS, DEFAULT_ITEM_SORT, DEFAULT_MIN_GAMES);
    expect(ranked.map((row) => [row.id, row.rank, row.low, row.firstLow])).toEqual([
      [2, 1, false, false],
      [1, 2, false, false],
      [3, 3, false, false],
      [4, null, true, true],
    ]);
  });

  it("groups by slot in shop order", () => {
    const sections = itemSections(ROWS, { group: "slot", sort: DEFAULT_ITEM_SORT, minGames: 5 });
    expect(sections.map((section) => [section.slot, section.rows.length])).toEqual([
      ["weapon", 3],
      ["vitality", 1],
    ]);
  });

  it("keeps low samples out of the summary", () => {
    const picks = summaryPicks(ROWS, 5);
    expect([picks.mostBought.id, picks.bestWin.id, picks.mostSold.id]).toEqual([3, 2, 3]);
    expect(summaryPicks(ROWS, 100)).toBeNull();
  });
});

describe("URL params", () => {
  it("parses tiers, min games, slot and choices", () => {
    expect(parseTiers("3,1,9,1")).toEqual([1, 3]);
    expect(parseTiers(null)).toEqual([]);
    expect(parseMinGames("0")).toBe(1);
    expect(parseMinGames("80")).toBe(50);
    expect(parseMinGames("x")).toBe(DEFAULT_MIN_GAMES);
    expect(parseSlot("Spirit")).toBe("spirit");
    expect(parseSlot("nope")).toBe("all");
    expect(parseChoice("GRID", ITEM_VIEWS)).toBe("grid");
    expect(parseChoice(undefined, ITEM_VIEWS)).toBe("table");
  });
});

describe("item page", () => {
  const BUCKETS = [0, 300, 600, 900, 1200, 1500, 1800].map((start_s, i) => ({
    start_s,
    purchases: [0, 2, 10, 20, 8, 4, 1][i],
    wins: [0, 2, 6, 12, 4, 1, 1][i],
  }));

  it("labels buckets, scales bars and flags thin ones", () => {
    const bars = buyTimingBars(BUCKETS, 5);
    expect(bars.map((b) => b.label)).toEqual(["0–5", "5–10", "10–15", "15–20", "20–25", "25–30", "30+"]);
    expect(bars[0]).toMatchObject({ height: 0, win: null, y: null, low: false });
    expect(bars[3]).toMatchObject({ height: 78, win: 60, low: false });
    expect(bars[3].y).toBeCloseTo(66.67, 1);
    expect(bars[1]).toMatchObject({ low: true, win: 100, y: 100 });
    expect(bars[3].share).toBeCloseTo((20 / 45) * 100);
  });

  it("splits early and late buys", () => {
    const { early, late } = earlyLateSplit(BUCKETS);
    expect(early).toEqual({ games: 12, wins: 8, win: (8 / 12) * 100 });
    expect(late).toEqual({ games: 5, wins: 2, win: 40 });
    expect(earlyLateSplit([]).early.win).toBeNull();
  });

  it("marks signature players: half their games and enough of them", () => {
    expect(isSignature({ games: 6, player_games: 12 }, 5)).toBe(true);
    expect(isSignature({ games: 6, player_games: 13 }, 5)).toBe(false);
    expect(isSignature({ games: 4, player_games: 4 }, 5)).toBe(false);
  });

  it("sorts heroes by the chosen column with low samples last", () => {
    const heroes = [
      { hero_id: 1, name: "A", games: 10, wins: 4, hero_games: 40 },
      { hero_id: 2, name: "B", games: 6, wins: 5, hero_games: 6 },
      { hero_id: 3, name: "C", games: 2, wins: 2, hero_games: 2 },
    ];
    expect(heroBuildRows(heroes, "games", 5).map((h) => h.hero_id)).toEqual([1, 2, 3]);
    expect(heroBuildRows(heroes, "pick", 5).map((h) => h.hero_id)).toEqual([2, 1, 3]);
    expect(heroBuildRows(heroes, "win", 5)[0]).toMatchObject({ hero_id: 2, pick: 100 });
  });

  it("ranks players, leaving low samples unranked", () => {
    const rows = playerBuildRows(
      [
        { account_id: 1, games: 3, wins: 1, player_games: 3 },
        { account_id: 2, games: 8, wins: 5, player_games: 10 },
      ],
      5,
    );
    expect(rows.map((r) => [r.account_id, r.rank, r.signature])).toEqual([
      [2, 1, true],
      [1, null, false],
    ]);
  });
});
