/**
 * The Items pages' rules, kept pure so the index and the detail page agree:
 * slot colours, the win-rate colour, the low-sample threshold, the index's
 * filters, sort and sections, and the URL params that hold them.
 *
 * `/db/items/stats` returns counts (`games`, `wins`, `sold`) and a median buy
 * time per item; every rate is worked out here, in percent.
 */

export const SLOTS = {
  weapon: { label: "Weapon", color: "#fb923c" },
  vitality: { label: "Vitality", color: "#4ade80" },
  spirit: { label: "Spirit", color: "#c084fc" },
};
export const SLOT_ORDER = ["weapon", "vitality", "spirit"];
export const TIERS = [1, 2, 3, 4];

export const DEFAULT_MIN_GAMES = 5;
export const MIN_GAMES_LIMITS = [1, 50];

/** A slot's colour with an alpha suffix: "33" for chip fills, "80" for borders. */
export function slotColor(slot, alpha = "") {
  const color = SLOTS[slot]?.color ?? "#9ca3af";
  return `${color}${alpha}`;
}

export function slotLabel(slot) {
  return SLOTS[slot]?.label ?? (slot ? slot[0].toUpperCase() + slot.slice(1) : "Other");
}

/** Win % colour: green at 52 and up, red under 48, neutral between, muted for a low sample. */
export function winRateColor(win, low = false) {
  if (low || win == null) return "var(--color-muted)";
  if (win >= 52) return "var(--color-success)";
  if (win < 48) return "var(--color-danger-text)";
  return "var(--color-secondary)";
}

export function isLowSample(games, minGames) {
  return (games ?? 0) < minGames;
}

const rate = (part, whole) => (whole ? (part / whole) * 100 : 0);

/** The endpoint's rows with pick, win and sell rates (percent). */
export function itemRows(items = [], playerGames = 0) {
  return items.map((item) => ({
    ...item,
    pick: rate(item.games, playerGames),
    win: rate(item.wins, item.games),
    sell: rate(item.sold, item.games),
  }));
}

/** Slot ("all" for every slot), tiers ([] for every tier) and a name search. */
export function filterItems(rows, { slot = "all", tiers = [], q = "" } = {}) {
  const query = q.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (slot === "all" || row.slot === slot) &&
      (!tiers.length || tiers.includes(row.tier)) &&
      (!query || String(row.name ?? "").toLowerCase().includes(query)),
  );
}

/* ── Sort ── */

export const SORT_KEYS = ["name", "slot", "tier", "cost", "pick", "win", "games", "buy", "sell"];
export const DEFAULT_ITEM_SORT = { key: "win", dir: "desc" };
/* Columns whose natural first click is ascending: A→Z, and earliest buy first. */
const ASC_FIRST = new Set(["name", "slot", "buy"]);

const SORT_VALUE = {
  slot: (row) => SLOT_ORDER.indexOf(row.slot),
  tier: (row) => row.tier ?? 0,
  cost: (row) => row.cost ?? 0,
  pick: (row) => row.pick,
  win: (row) => row.win,
  games: (row) => row.games,
  buy: (row) => row.median_buy_s ?? Infinity,
  sell: (row) => row.sell,
};

export function parseItemSort(value) {
  const [key, dir] = String(value ?? "").toLowerCase().split("-");
  if (!SORT_KEYS.includes(key) || (dir !== "asc" && dir !== "desc")) return DEFAULT_ITEM_SORT;
  return { key, dir };
}

export function formatItemSort({ key, dir }) {
  return `${key}-${dir}`;
}

export function isDefaultItemSort(sort) {
  return sort.key === DEFAULT_ITEM_SORT.key && sort.dir === DEFAULT_ITEM_SORT.dir;
}

/** The sort after clicking a header: the active column flips, a new one starts on its natural direction. */
export function nextItemSort(current, key) {
  if (current.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
  return { key, dir: ASC_FIRST.has(key) ? "asc" : "desc" };
}

const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""));

/** Sorted copy; ties go to more games, then the name. */
export function sortItems(rows, { key, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = key === "name" ? byName(a, b) : (SORT_VALUE[key] ?? SORT_VALUE.win)(a) - (SORT_VALUE[key] ?? SORT_VALUE.win)(b);
    return sign * primary || b.games - a.games || byName(a, b);
  });
}

/**
 * Rows in display order: items with enough games first, ranked 1..n, then the
 * low-sample ones, unranked. `firstLow` marks where the divider goes.
 */
export function rankItems(rows, sort, minGames) {
  const confident = sortItems(rows.filter((row) => !isLowSample(row.games, minGames)), sort);
  const low = sortItems(rows.filter((row) => isLowSample(row.games, minGames)), sort);
  return [
    ...confident.map((row, index) => ({ ...row, low: false, rank: index + 1, firstLow: false })),
    ...low.map((row, index) => ({ ...row, low: true, rank: null, firstLow: index === 0 && confident.length > 0 })),
  ];
}

/** One flat section, or one per slot (in shop order, empty slots dropped). */
export function itemSections(rows, { group = "flat", sort, minGames }) {
  if (group !== "slot") return [{ slot: null, rows: rankItems(rows, sort, minGames) }];
  return SLOT_ORDER.map((slot) => ({ slot, rows: rankItems(rows.filter((row) => row.slot === slot), sort, minGames) })).filter(
    (section) => section.rows.length,
  );
}

const top = (rows, value) => rows.reduce((best, row) => (best == null || value(row) > value(best) ? row : best), null);

/** The summary strip: most bought, best win rate and most often sold, among items with enough games. */
export function summaryPicks(rows, minGames) {
  const confident = rows.filter((row) => !isLowSample(row.games, minGames));
  if (!confident.length) return null;
  return {
    mostBought: top(confident, (row) => row.pick),
    bestWin: top(confident, (row) => row.win),
    mostSold: top(confident, (row) => row.sell),
  };
}

/* ── URL params ── */

export const ITEM_VIEWS = ["table", "grid"];
export const ITEM_GROUPS = ["flat", "slot"];

/** `"1,3"` -> [1, 3]; unknown tiers are dropped. */
export function parseTiers(value) {
  const tiers = String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((tier) => TIERS.includes(tier));
  return [...new Set(tiers)].sort((a, b) => a - b);
}

export function parseMinGames(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return DEFAULT_MIN_GAMES;
  return Math.min(MIN_GAMES_LIMITS[1], Math.max(MIN_GAMES_LIMITS[0], number));
}

export function parseSlot(value) {
  const slot = String(value ?? "").toLowerCase();
  return SLOTS[slot] ? slot : "all";
}

export function parseChoice(value, choices) {
  const choice = String(value ?? "").toLowerCase();
  return choices.includes(choice) ? choice : choices[0];
}

/* ── Item page ── */

const BUCKET_MINUTES = 5;
const CHART_WIN_RANGE = [20, 80]; // the buy-timing chart's fixed y axis, in win %
const EARLY_BEFORE_S = 15 * 60;
const LATE_FROM_S = 25 * 60;
export const SIGNATURE_SHARE = 0.5;

/** "0–5", "5–10" … and "30+" for the last, open-ended bucket. */
export function bucketLabel(startS, isLast) {
  const from = Math.round(startS / 60);
  return isLast ? `${from}+` : `${from}–${from + BUCKET_MINUTES}`;
}

/**
 * The buy-timing chart's bars and points. Bars scale so the busiest bucket is
 * 78% of the chart; points sit on a fixed 20–80% win axis. A bucket with some
 * purchases but fewer than `minGames` is `low` (hatched bar, hollow point).
 */
export function buyTimingBars(buckets = [], minGames = DEFAULT_MIN_GAMES) {
  const busiest = Math.max(1, ...buckets.map((b) => b.purchases));
  const total = buckets.reduce((sum, b) => sum + b.purchases, 0);
  const [floor, ceiling] = CHART_WIN_RANGE;
  return buckets.map((bucket, index) => {
    const { purchases, wins } = bucket;
    const win = purchases ? (wins / purchases) * 100 : null;
    return {
      label: bucketLabel(bucket.start_s, index === buckets.length - 1),
      purchases,
      wins,
      win,
      share: total ? (purchases / total) * 100 : 0,
      low: purchases > 0 && purchases < minGames,
      height: purchases ? Math.max(3, (purchases / busiest) * 78) : 0,
      y: win == null ? null : Math.min(100, Math.max(0, ((win - floor) / (ceiling - floor)) * 100)),
    };
  });
}

/** Win rate when first bought before 15:00 and from 25:00 on. */
export function earlyLateSplit(buckets = []) {
  const sum = (list) => list.reduce((acc, b) => ({ games: acc.games + b.purchases, wins: acc.wins + b.wins }), { games: 0, wins: 0 });
  const withWin = ({ games, wins }) => ({ games, wins, win: games ? (wins / games) * 100 : null });
  return {
    early: withWin(sum(buckets.filter((b) => b.start_s < EARLY_BEFORE_S))),
    late: withWin(sum(buckets.filter((b) => b.start_s >= LATE_FROM_S))),
  };
}

/** Built in at least half of the player's games, with at least `minGames` games on it. */
export function isSignature(player, minGames = DEFAULT_MIN_GAMES) {
  return player.games >= minGames && player.player_games > 0 && player.games / player.player_games >= SIGNATURE_SHARE;
}

export const HERO_SORTS = ["games", "pick", "win"];

/** Heroes who build it, with pick (share of the hero's games) and win %, low samples last. */
export function heroBuildRows(heroes = [], sortKey = "games", minGames = DEFAULT_MIN_GAMES) {
  const value = {
    games: (row) => row.games,
    pick: (row) => row.pick,
    win: (row) => row.win,
  }[sortKey] ?? ((row) => row.games);
  return heroes
    .map((hero) => ({
      ...hero,
      pick: rate(hero.games, hero.hero_games),
      win: rate(hero.wins, hero.games),
      low: isLowSample(hero.games, minGames),
    }))
    .sort((a, b) => a.low - b.low || value(b) - value(a) || b.games - a.games || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** Players who build it most, ranked; low samples last and unranked. */
export function playerBuildRows(players = [], minGames = DEFAULT_MIN_GAMES) {
  const rows = players
    .map((player) => ({
      ...player,
      win: rate(player.wins, player.games),
      low: isLowSample(player.games, minGames),
      signature: isSignature(player, minGames),
    }))
    .sort((a, b) => a.low - b.low || b.games - a.games || b.wins - a.wins);
  let rank = 0;
  return rows.map((row) => ({ ...row, rank: row.low ? null : ++rank }));
}
