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
