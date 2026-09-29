/**
 * Soul-income source ids from deadlock-api's `gold_sources` array, user-confirmed
 * against the in-game breakdown. `player_gold_sources.source` stores the id, so
 * the labels live here and the match tooltip and the player profile import the
 * same map — they can never disagree about what a source id means.
 */
export const SOUL_SOURCES = [
  { id: 1, label: "Enemy Kills" },
  { id: 2, label: "Troopers" },
  { id: 3, label: "Neutral Enemies" },
  { id: 4, label: "Objectives" },
  { id: 5, label: "Urn" },
  { id: 6, label: "Kill Assists" },
  { id: 7, label: "Denies" },
  { id: 8, label: "Team Catch-Up" },
  { id: 9, label: "Ability Assassinate" },
  { id: 10, label: "Trophy Collector" },
  { id: 11, label: "Cultist Sacrifice" },
  { id: 12, label: "Breakable Pickups" },
  { id: 13, label: "Golden Goose Egg" },
];

/** id -> label, for sparse payloads (a match only reports the sources it used). */
export const SOUL_SOURCE_LABELS = Object.fromEntries(
  SOUL_SOURCES.map(({ id, label }) => [id, label]),
);

/** Label for a source id that may be newer than this map. */
export const soulSourceLabel = (source) => SOUL_SOURCE_LABELS[source] ?? `Source ${source}`;
