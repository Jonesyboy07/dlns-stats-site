/**
 * Small formatters shared by the Heroes list and Hero detail pages.
 *
 * These are presentation-only helpers for the hero pages; the general number /
 * duration formatters live in `format.js`. Kept separate so the hero rebuild
 * does not change behaviour on pages that already ship.
 */

/** 1 -> "1st", 2 -> "2nd", 24 -> "24th". */
export function ordinal(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return "—";
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] || "th";
  return `${value}${suffix}`;
}

/** 0.548 -> "54.8%". `digits` controls the decimals. A null becomes "—". */
export function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

/** A signed point change: 2.3 -> "+2.3", -1.8 -> "−1.8". */
export function signedPoints(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(Number(value)).toFixed(digits)}`;
}

/** The arrow + magnitude a card pill or trending row shows: "▲ 2.3". */
export function trendGlyph(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const arrow = value >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(Number(value)).toFixed(digits)}`;
}

/** Seconds -> "31:13". */
export function clockDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "—";
  const total = Math.max(0, Math.round(Number(seconds)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The tone classes a win / loss / neutral value uses. Matches the player pages
 * so a "W" reads the same colour everywhere.
 */
export const WIN_TEXT = "text-success";
export const LOSS_TEXT = "text-danger-text";
