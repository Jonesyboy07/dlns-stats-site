/**
 * The match page's timeline tab: `/db/matches/<id>/events` turned into simple rows.
 *
 * The feed is already in time order, so this only translates ids and slots into
 * words. Team labels are passed in because the match page shows the event's team
 * names (Amber/Sapphire are the in-game sides).
 */

import { laneMeta } from "./lanes";

/** Short names for the objective ids (see docs/db_schema.md). */
export const OBJECTIVE_LABELS = {
  0: "Patron",
  1: "Tier 1 Walker",
  2: "Tier 1 Walker",
  3: "Tier 1 Walker",
  4: "Tier 1 Walker",
  5: "Tier 2 Walker",
  6: "Tier 2 Walker",
  7: "Tier 2 Walker",
  8: "Tier 2 Walker",
  9: "Base Guardian",
  10: "Shield Generator",
  11: "Shield Generator",
  12: "Barrack Boss",
  13: "Barrack Boss",
  14: "Barrack Boss",
  15: "Barrack Boss",
};

export const objectiveLabel = (objectiveId) =>
  OBJECTIVE_LABELS[Number(objectiveId)] ?? `Objective ${objectiveId}`;

/** `m:ss` clock for a match second. */
export const clock = (seconds) => {
  if (seconds == null || Number.isNaN(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const defaultTeamLabel = (team) =>
  team === 0 ? "Amber" : team === 1 ? "Sapphire" : "Unknown";

/**
 * One row per event: `{ key, time_s, type, label, text, lane, laneName, laneColor,
 * team, heroId, killerHeroId, damage }`.
 *
 * `players` is the scoreboard list; the events feed names the killer by in-game
 * slot, so the slot is looked up there. A kill whose killer is unknown still shows
 * up, just without a name.
 */
export function buildTimelineRows(events = [], players = [], teamLabel = defaultTeamLabel) {
  const bySlot = new Map();
  for (const player of players || []) {
    if (player?.player_slot != null) bySlot.set(Number(player.player_slot), player);
  }
  const nameOf = (player) =>
    player?.persona_name || (player?.account_id != null ? `#${player.account_id}` : "Unknown");
  const slotOf = (slot) => (slot == null ? null : bySlot.get(Number(slot)) ?? null);

  return (events || []).map((event, index) => {
    const base = {
      key: `${event.type}-${index}`,
      time_s: event.time_s ?? null,
      type: event.type,
      team: event.team ?? null,
      // World coordinates, kept so the map can plot the same rows the list shows.
      position: event.position ?? null,
      lane: null,
      laneName: null,
      laneColor: null,
      heroId: null,
      killerHeroId: null,
      damage: null,
    };

    if (event.type === "objective") {
      const lane = laneMeta(event.lane);
      const label = objectiveLabel(event.objective_id);
      return {
        ...base,
        label,
        lane: lane?.id ?? null,
        laneName: lane?.name ?? null,
        laneColor: lane?.color ?? null,
        text: `${lane ? `${lane.name} ` : ""}${label} destroyed by ${teamLabel(event.team)}`,
        damage: event.player_damage ?? null,
      };
    }

    if (event.type === "mid_boss") {
      return {
        ...base,
        label: "Mid Boss",
        text: `Mid Boss killed, claimed by ${teamLabel(event.team)}`,
      };
    }

    const victim = slotOf(event.player_slot);
    const killer = slotOf(event.killer_player_slot);
    return {
      ...base,
      label: "Kill",
      // The victim's own hero is what the row is "about"; the killer's hero is secondary.
      heroId: victim?.hero_id ?? event.hero_id ?? null,
      killerHeroId: killer?.hero_id ?? null,
      text: killer
        ? `${nameOf(victim)} killed by ${nameOf(killer)}`
        : `${nameOf(victim)} died`,
    };
  });
}
