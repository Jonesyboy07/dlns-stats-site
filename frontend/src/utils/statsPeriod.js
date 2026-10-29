/**
 * The stats page's Period filter: a Night Shift week range, with the patch it
 * covers derived from it rather than stored. Pure helpers, so the trigger label,
 * the picker's footer and the page subtitle all describe a range the same way.
 *
 * `weeks` is `/db/stats/periods`' list of `{ week, matches, regions }`, every week
 * from the first to the last, oldest first. `patches` is its list of
 * `{ name, start_week, end_week }`, which tile the same weeks without gaps.
 */

/** Minus sign for change lines (U+2212), so "−4" lines up with "+4". */
export const MINUS = "−";

/** `"60-61"` -> [60, 61], `"61"` -> [61, 61], anything else -> null. */
export function parseWeeksParam(value) {
  const text = String(value ?? "").trim().replace("–", "-");
  if (!/^\d+(-\d+)?$/.test(text)) return null;
  const [a, b = a] = text.split("-").map(Number);
  return [Math.min(a, b), Math.max(a, b)];
}

export function formatWeeksParam([start, end]) {
  return start === end ? String(start) : `${start}-${end}`;
}

export function firstWeek(weeks) {
  return weeks?.length ? weeks[0].week : null;
}

export function lastWeek(weeks) {
  return weeks?.length ? weeks[weeks.length - 1].week : null;
}

/** The page's default period: the latest two weeks. */
export function defaultRange(weeks) {
  const last = lastWeek(weeks);
  if (last == null) return null;
  return [Math.max(firstWeek(weeks), last - 1), last];
}

/** Keeps a requested range inside the weeks that exist; falls back to the default. */
export function clampRange(range, weeks) {
  const first = firstWeek(weeks);
  const last = lastWeek(weeks);
  if (!range || first == null) return defaultRange(weeks);
  const start = Math.max(first, Math.min(range[0], last));
  const end = Math.max(first, Math.min(range[1], last));
  return [Math.min(start, end), Math.max(start, end)];
}

export function isAllWeeks(range, weeks) {
  return Boolean(range && weeks?.length && range[0] === firstWeek(weeks) && range[1] === lastWeek(weeks));
}

/** "All weeks", "Week 61" or "Weeks 60–61". */
export function weeksLabel(range, weeks) {
  if (!range) return "No weeks";
  if (isAllWeeks(range, weeks) && range[0] !== range[1]) return "All weeks";
  return range[0] === range[1] ? `Week ${range[0]}` : `Weeks ${range[0]}–${range[1]}`;
}

/** Patches that overlap the range, oldest first. */
export function patchesInRange(range, patches = []) {
  if (!range) return [];
  return patches.filter((patch) => patch.start_week <= range[1] && patch.end_week >= range[0]);
}

function coversExactly(range, patch) {
  return patch.start_week === range[0] && patch.end_week === range[1];
}

/** "All patches", "City Never Sleeps", "City Never Sleeps (part)" or "3 patches". */
export function patchLabel(range, weeks, patches = []) {
  if (isAllWeeks(range, weeks) && patches.length !== 1) return "All patches";
  const inside = patchesInRange(range, patches);
  if (inside.length === 0) return "No patch";
  if (inside.length === 1) return inside[0].name + (coversExactly(range, inside[0]) ? "" : " (part)");
  return `${inside.length} patches`;
}

/** The picker footer's detail line. */
export function rangeDetail(range, patches = [], { pending = false } = {}) {
  const inside = patchesInRange(range, patches);
  let text;
  if (inside.length === 0) text = "No patch information for these weeks";
  else if (inside.length === 1) {
    const [patch] = inside;
    text = coversExactly(range, patch)
      ? `Exactly the ${patch.name} patch`
      : `Part of ${patch.name} (weeks ${patch.start_week}–${patch.end_week})`;
  } else {
    const names =
      inside.length <= 3
        ? inside.map((patch) => patch.name).join(", ")
        : `${inside[0].name} → ${inside[inside.length - 1].name}`;
    text = `Spans ${inside.length} patches: ${names}`;
  }
  return pending ? `${text} · now pick an end week` : text;
}

/** Matches played in the range, overall or in one region. */
export function matchesInRange(range, weeks = [], region = "All") {
  if (!range) return 0;
  return weeks
    .filter((entry) => entry.week >= range[0] && entry.week <= range[1])
    .reduce((sum, entry) => sum + (region === "All" ? entry.matches : entry.regions?.[region] ?? 0), 0);
}

/** The picker's preset pills, newest-relative. Dropped when they would repeat a smaller one. */
export function periodPresets(weeks) {
  const first = firstWeek(weeks);
  const last = lastWeek(weeks);
  if (last == null) return [];
  const span = (n) => [Math.max(first, last - n + 1), last];
  const presets = [
    { label: "All weeks", range: [first, last] },
    { label: "Latest week", range: [last, last] },
    { label: "Last 4 weeks", range: span(4) },
    { label: "Last 8 weeks", range: span(8) },
  ];
  const seen = new Set();
  return presets.filter((preset) => {
    const key = preset.range.join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Patch band label: "Gameplay Update " is dropped so the band reads "10-02". */
export function shortPatchName(name = "") {
  return name.startsWith("Gameplay Update ") ? name.slice("Gameplay Update ".length) : name;
}

/** Signed change for a headline cell: "+1", "−24", "±0". */
export function formatSignedNumber(delta) {
  if (delta == null || Number.isNaN(Number(delta))) return null;
  const value = Math.round(Number(delta));
  if (value === 0) return "±0";
  return value > 0 ? `+${value.toLocaleString("en-GB")}` : `${MINUS}${Math.abs(value).toLocaleString("en-GB")}`;
}

/** Signed clock change: 223 -> "+3:43", -65 -> "−1:05", 0 -> "±0:00". */
export function formatSignedDuration(delta) {
  if (delta == null || Number.isNaN(Number(delta))) return null;
  const value = Math.round(Number(delta));
  const abs = Math.abs(value);
  const clock = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  if (value === 0) return `±${clock}`;
  return `${value > 0 ? "+" : MINUS}${clock}`;
}
