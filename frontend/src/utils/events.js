/**
 * Event (series) helpers.
 *
 * Week numbers restart in every event: Fight Night week 5 is not Night Shift
 * week 5. Anything plotted or labelled by week has to carry its event too. A
 * match with no title counts as the main league, which matches the backend's
 * `PRIMARY_EVENT` in `db/teams.py`.
 */

export const PRIMARY_EVENT = "Night Shift";

const PREFIXES = {
  "Night Shift": "NS",
  "Fight Night": "FN",
  "Night Shift APAC": "APAC",
  "Night Shift Open 1": "Open",
};

/** The event a match or row belongs to; untitled rows are the main league. */
export function eventOf(title) {
  return title || PRIMARY_EVENT;
}

/** Short week prefix for an event: "NS", "FN", … or the title's initials. */
export function eventPrefix(title) {
  const event = eventOf(title);
  if (PREFIXES[event]) return PREFIXES[event];
  return event
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word[0].toUpperCase()))
    .join("");
}

/** Main league first, then by games played (desc), then by name. */
export function compareEvents(a, b, gamesByEvent = {}) {
  if (a === PRIMARY_EVENT || b === PRIMARY_EVENT) {
    if (a === b) return 0;
    return a === PRIMARY_EVENT ? -1 : 1;
  }
  const games = (gamesByEvent[b] ?? 0) - (gamesByEvent[a] ?? 0);
  return games || a.localeCompare(b);
}
