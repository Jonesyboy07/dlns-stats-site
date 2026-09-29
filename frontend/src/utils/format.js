/** Formatting helpers shared by the team page. */

/** Clock-style duration: 1873 -> "31:13". Returns null when unknown. */
export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  const total = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Signed duration delta: 580 -> "+9:40", -125 -> "-2:05". */
export function formatDurationDelta(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  const value = Number(seconds);
  return `${value < 0 ? "-" : "+"}${formatDuration(Math.abs(value))}`;
}

/** Win/loss record: "15-4". */
export function formatRecord(wins, losses) {
  return `${wins ?? 0}-${losses ?? 0}`;
}

/** Percentage: 0.5 -> "50%" (or "78.3%" with digits). */
export function formatPercent(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `${Number(value).toFixed(digits)}%`;
}

/** KDA average, two decimals: 11.41. */
export function formatKda(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value).toFixed(2);
}

/** Compact thousands: 1187 -> "1.2k", 816 -> "816". */
export function formatCompact(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const number = Number(value);
  return Math.abs(number) >= 1000 ? `${(number / 1000).toFixed(1)}k` : `${Math.round(number)}`;
}

/** Grouped integer: 1240 -> "1,240". */
export function formatInteger(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value)).toLocaleString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Match date as the tables show it: "24 Sep 2026". Null when unusable.
 *
 * Built by hand rather than with `toLocaleDateString`: ICU renders en-GB
 * September as "Sept" (4 characters), which would widen the date column and
 * disagree with the design's fixed three-letter format.
 */
export function formatMatchDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Long form for the team page's series and game rows: "Sep 13, 2026".
 *
 * Same hand-built month list as `formatMatchDate`, for the same reason — and
 * because the team page puts the date in a fixed-width column, an ICU-only day
 * like "Sept" would break the alignment.
 */
export function formatLongDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
