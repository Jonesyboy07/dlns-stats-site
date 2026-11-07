/**
 * Shapes and sorts the stats page's Heroes tab data (`/db/stats/heroes`).
 *
 * Rates are 0-100 percentages. Pick, ban and contest rates are over the games
 * in range; win rate is over the hero's own picks.
 */

/** Below this many picks a win rate is shown but not coloured. */
export const LOW_SAMPLE_PICKS = 3;

export const SORT_COLUMNS = ["hero", "picks", "pick", "bans", "ban", "contest", "win"];
export const DEFAULT_SORT = { column: "contest", dir: "desc" };

/** `contest-desc` -> { column, dir }; anything unknown falls back to the default. */
export function parseSort(value) {
  const [column, dir] = String(value ?? "").toLowerCase().split("-");
  if (!SORT_COLUMNS.includes(column) || (dir !== "asc" && dir !== "desc")) return DEFAULT_SORT;
  return { column, dir };
}

export function formatSort({ column, dir }) {
  return `${column}-${dir}`;
}

export function isDefaultSort(sort) {
  return sort.column === DEFAULT_SORT.column && sort.dir === DEFAULT_SORT.dir;
}

/**
 * The sort after clicking a column header: the active column flips, a new one
 * starts descending, except Hero, which starts A→Z.
 */
export function nextSort(current, column) {
  if (current.column === column) return { column, dir: current.dir === "desc" ? "asc" : "desc" };
  return { column, dir: column === "hero" ? "asc" : "desc" };
}

/** Win % colour: success above 52.5, danger below 47.5, dim for a low sample. */
export function winColor(win, picks = LOW_SAMPLE_PICKS) {
  if (picks < LOW_SAMPLE_PICKS) return "var(--color-dim)";
  if (win > 52.5) return "var(--color-success)";
  if (win < 47.5) return "var(--color-danger-text)";
  return "var(--color-secondary)";
}

/** One table row per hero with its rates worked out. */
export function heroRows(heroes = [], games = 0) {
  const rate = (n) => (games ? (n / games) * 100 : 0);
  return heroes.map((hero) => ({
    ...hero,
    pick: rate(hero.picks),
    ban: rate(hero.bans),
    contest: Math.min(100, rate(hero.contested)),
    win: hero.picks ? (hero.wins / hero.picks) * 100 : 0,
  }));
}

const SORT_VALUE = {
  picks: (h) => h.picks,
  pick: (h) => h.pick,
  bans: (h) => h.bans,
  ban: (h) => h.ban,
  contest: (h) => h.contest,
  win: (h) => h.win,
};

/** Rows sorted by a column; ties go to more picks, then name. */
export function sortHeroes(rows, { column, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
  return [...rows].sort((a, b) => {
    if (column === "hero") return sign * byName(a, b) || b.picks - a.picks;
    const value = SORT_VALUE[column] ?? SORT_VALUE.contest;
    return sign * (value(a) - value(b)) || b.picks - a.picks || byName(a, b);
  });
}

/** Top `limit` heroes by bans, skipping the unbanned; ties go to more picks. */
export function mostBanned(rows, limit = 5) {
  return rows
    .filter((h) => h.bans > 0)
    .sort((a, b) => b.bans - a.bans || b.picks - a.picks || a.hero_id - b.hero_id)
    .slice(0, limit);
}

/** A percentage-point change with a true minus sign: "+28.6", "−19.8". */
export function signedDelta(delta) {
  const value = Math.abs(Number(delta)).toFixed(1);
  return delta < 0 ? `−${value}` : `+${value}`;
}

/**
 * Scatter points from `{ hero_id, name, picks, wins }` and the game count.
 * Heroes on the same spot fan out to the right, and y is clamped to 6–94% so a
 * 0% or 100% winner does not sit on a quadrant label.
 */
export function scatterPoints(heroes = [], games = 0) {
  const seen = {};
  return heroes.map((hero) => {
    const pick = games ? (hero.picks / games) * 100 : 0;
    const win = hero.picks ? (hero.wins / hero.picks) * 100 : 0;
    const key = `${pick.toFixed(1)}|${win.toFixed(1)}`;
    const offset = (seen[key] = (seen[key] || 0) + 1) - 1;
    return { ...hero, pick, win, x: Math.min(100, pick + offset * 3.2), y: Math.min(94, Math.max(6, win)) };
  });
}
