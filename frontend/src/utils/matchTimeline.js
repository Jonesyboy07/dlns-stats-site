/**
 * The match page's timeline tab: `/db/matches/<id>/events` turned into simple rows.
 *
 * The feed is already in time order, so this only translates ids and slots into
 * words. Team labels are passed in because the match page shows the event's team
 * names (Amber/Sapphire are the in-game sides).
 */

import { laneMeta } from "./lanes";

/**
 * Short names for the objective ids (see docs/db_schema.md). The ids are Valve's
 * `ECitadelTeamObjective` slots; the names here follow the objective's tier on the
 * board, so the lane objectives read Guardian -> Walker -> Base Guardian and the
 * base reads Shrine -> Patron Guardian -> Patron. Id 2, 6 and 13 are the lane-2 slot,
 * which no match reports: the current map has three lanes.
 */
export const OBJECTIVE_LABELS = {
  0: "Patron",
  1: "Guardian",
  2: "Guardian",
  3: "Guardian",
  4: "Guardian",
  5: "Walker",
  6: "Walker",
  7: "Walker",
  8: "Walker",
  9: "Patron Guardian",
  10: "Shrine",
  11: "Shrine",
  12: "Base Guardian",
  13: "Base Guardian",
  14: "Base Guardian",
  15: "Base Guardian",
};

export const objectiveLabel = (objectiveId) =>
  OBJECTIVE_LABELS[Number(objectiveId)] ?? `Objective ${objectiveId}`;

/** `m:ss` clock for a match second. */
export const clock = (seconds) => {
  if (seconds == null || Number.isNaN(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * A shareable `?t=` value as a match second: either `m:ss` or bare seconds, which is
 * what `clock` writes and what a hand-edited URL tends to contain. Returns null when
 * there is nothing usable, so the caller can fall back to its own default rather than
 * seeking to zero.
 *
 * The emptiness check is explicit because `Number(null)` and `Number("")` are both 0,
 * which would read as "the start of the match".
 */
export const parseMatchTime = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":");
    const whole = Number(minutes);
    const part = Number(seconds);
    if (!Number.isFinite(whole) || !Number.isFinite(part)) return null;
    return Math.max(0, Math.round(whole * 60 + part));
  }
  const raw = Number(text);
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : null;
};

/** The `?t=` value for a match second, i.e. `clock` in the form the URL carries. */
export const matchTimeParam = (seconds) => clock(seconds);

const defaultTeamLabel = (team) =>
  team === 0 ? "Amber" : team === 1 ? "Sapphire" : "Unknown";

/**
 * Which row wins a shared timestamp. Items sort after the fight they were bought for:
 * a buy at 11:05 reads better under the kill that forced it than above it.
 */
export const ROW_TYPE_ORDER = { objective: 0, mid_boss: 1, death: 2, purchase: 3 };

/**
 * One row per item purchase, in the same shape as an event row so one list can render
 * both. `accountId` is what the timeline's per-player filter matches on, and
 * `soldTimeS` is when the player sold it back — null while they still held it.
 *
 * A match logs a few hundred purchases against a few dozen events, so the caller
 * decides whose to merge in rather than showing them all by default.
 */
export function buildPurchaseRows(purchases = []) {
  return (purchases || []).map((purchase, index) => {
    const item = purchase?.item || "Unknown item";
    // `sold_time_s` is 0 while the player still holds the item; the API's raw sentinel
    // is handled here too, so a row is correct whether or not the route normalised it.
    const soldTimeS = purchase?.sold_time_s || null;
    const owner = purchase?.persona_name || null;
    return {
      key: `purchase-${purchase?.item_id ?? "?"}-${index}`,
      time_s: purchase?.time_s ?? null,
      type: "purchase",
      team: purchase?.team ?? null,
      position: null,
      lane: null,
      laneName: null,
      laneColor: null,
      heroId: purchase?.hero_id ?? null,
      killerHeroId: null,
      damage: null,
      accountId: purchase?.account_id ?? null,
      label: "Item",
      item,
      icon: purchase?.icon ?? null,
      image: purchase?.image ?? null,
      soldTimeS,
      text: item,
      trailing: [owner, soldTimeS != null ? `sold ${clock(soldTimeS)}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

/** Timeline rows and purchase rows merged into one time-ordered list. */
export function mergeTimelineRows(rows = [], purchases = []) {
  const at = (row) => (row?.time_s == null ? Number.POSITIVE_INFINITY : Number(row.time_s));
  return [...(rows || []), ...(purchases || [])].sort(
    (a, b) => at(a) - at(b) || (ROW_TYPE_ORDER[a?.type] ?? 9) - (ROW_TYPE_ORDER[b?.type] ?? 9),
  );
}

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
      playerSlot: event.player_slot ?? null,
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
