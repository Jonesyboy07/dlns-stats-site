/**
 * The match timeline's derived shape: deaths clustered into team fights, and the
 * badges each kill carries.
 *
 * `matchTimeline.js` turns `/db/matches/<id>/events` into display rows; this module
 * builds the structures behind the map, the feed and the lanes, so those three can
 * never disagree about which fight a kill belongs to or who was on a streak. Pure
 * throughout -- no DOM, no clock, no fetch -- so the whole derivation is testable.
 *
 * The thresholds mirror the design handoff. A match's own recorded respawn
 * (`death_duration_s`) is used where the API reported it, and the site's existing
 * estimate only fills the handful of deaths that predate it.
 */

import { respawnSeconds } from "./replay";

// Kills this close together are one engagement, and a group only counts as a fight
// once it is this big -- a lone pick is not a team fight.
export const FIGHT_GAP_S = 20;
export const FIGHT_MIN_KILLS = 3;
// A fight is reported slightly wider than its kills so the band reads as an event
// rather than as a span of the kill tick marks.
export const FIGHT_PAD_S = 4;
// A fight's follow-up objective: the first one taken this soon after it ended.
export const FIGHT_FOLLOW_UP_S = 75;
// Consecutive kills by one player within this window chain into a multi-kill.
export const MULTI_KILL_GAP_S = 10;
// Kills in a row before the next death of that player is a shutdown.
export const SHUTDOWN_STREAK = 3;

/** Index is the chain length; the first two are not multi-kills. */
export const MULTI_KILL_LABELS = [
  null,
  null,
  "Double Kill",
  "Triple Kill",
  "Quad Kill",
  "Penta Kill",
  "Hexa Kill",
];

/** Badge tones, matching the design system's variants. */
export const BADGE_WARNING = "warning";
export const BADGE_ACCENT = "accent";
export const BADGE_DANGER = "danger";

/** Items at or above this tier are the "key items" the timeline highlights. */
export const KEY_ITEM_MIN_TIER = 3;

const toNumber = (value) => (value == null ? null : Number(value));
const timeOf = (row) => toNumber(row?.timeS ?? row?.time_s);

/** `player_slot` -> player, so a death can resolve the killer the feed names by slot. */
export function indexPlayers(players = []) {
  const bySlot = new Map();
  for (const player of players || []) {
    const slot = toNumber(player?.player_slot);
    if (slot != null) bySlot.set(slot, player);
  }
  return bySlot;
}

/** How many players are on each side, so a whole-team wipe can be recognised. */
function teamSizes(bySlot) {
  const sizes = new Map();
  for (const player of bySlot.values()) {
    const team = toNumber(player?.team);
    if (team != null) sizes.set(team, (sizes.get(team) || 0) + 1);
  }
  return sizes;
}

/**
 * Every death as a kill: who killed whom, when, where both stood, how long the victim
 * stayed down, and the badges the kill earned.
 *
 * `team` is the *killer's* side, which is what a fight's score is counted from, and is
 * null when the API recorded no killer (a neutral-camp death) so it cannot be credited
 * to anyone. `killedTeam` is the victim's.
 */
export function buildKills(events = [], { players = [] } = {}) {
  const bySlot = indexPlayers(players);
  const sizes = teamSizes(bySlot);

  const ordered = [];
  (events || []).forEach((event, index) => {
    if (event?.type === "death") ordered.push({ event, index });
  });
  // Same-second kills keep the feed's order, which is what makes a multi-kill chain
  // read the same way every time the page loads.
  ordered.sort((a, b) => (timeOf(a.event) ?? 0) - (timeOf(b.event) ?? 0) || a.index - b.index);

  const lastKillAt = new Map();
  const multiCount = new Map();
  const streak = new Map();
  const downUntil = new Map();
  const kills = [];

  ordered.forEach(({ event }, id) => {
    const timeS = timeOf(event);
    const victimSlot = toNumber(event.player_slot);
    const rawKillerSlot = toNumber(event.killer_player_slot);
    // A slot that matches the victim is not a killer; treat it as unrecorded.
    const killerSlot = rawKillerSlot != null && rawKillerSlot !== victimSlot ? rawKillerSlot : null;
    const victim = bySlot.get(victimSlot) ?? null;
    const killer = bySlot.get(killerSlot) ?? null;
    const killedTeam = toNumber(victim?.team ?? event.team);
    const team = killer ? toNumber(killer.team) : null;

    const recorded = toNumber(event.death_duration_s);
    const respawnS = recorded ?? (timeS == null ? null : respawnSeconds(timeS));
    const untilS = respawnS == null || timeS == null ? null : timeS + respawnS;

    const badges = [];
    if (id === 0) badges.push({ label: "First Blood", tone: BADGE_WARNING });

    if (killerSlot != null && timeS != null) {
      const previous = lastKillAt.get(killerSlot);
      const chain = previous != null && timeS - previous <= MULTI_KILL_GAP_S
        ? (multiCount.get(killerSlot) || 1) + 1
        : 1;
      multiCount.set(killerSlot, chain);
      lastKillAt.set(killerSlot, timeS);
      if (chain >= 2) {
        badges.push({
          label: MULTI_KILL_LABELS[chain] ?? `${chain}x Kill`,
          tone: BADGE_ACCENT,
        });
      }
    }

    if ((streak.get(victimSlot) || 0) >= SHUTDOWN_STREAK) {
      badges.push({ label: "Shutdown", tone: BADGE_WARNING });
    }
    if (killerSlot != null && timeS != null) {
      streak.set(killerSlot, (streak.get(killerSlot) || 0) + 1);
    }
    if (victimSlot != null) streak.set(victimSlot, 0);

    if (victimSlot != null && untilS != null) {
      downUntil.set(victimSlot, untilS);
      const size = sizes.get(killedTeam);
      if (size) {
        let down = 0;
        for (const [slot, until] of downUntil) {
          if (until > timeS && toNumber(bySlot.get(slot)?.team) === killedTeam) down += 1;
        }
        if (down >= size) badges.push({ label: "Team Wipe", tone: BADGE_DANGER });
      }
    }

    kills.push({
      id,
      timeS,
      victimSlot,
      killerSlot,
      victim,
      killer,
      victimAccountId: toNumber(event.account_id),
      killerAccountId: toNumber(killer?.account_id),
      victimHeroId: toNumber(event.hero_id),
      victimName: victim?.persona_name ?? event.persona_name ?? null,
      killerName: killer?.persona_name ?? null,
      killerHeroId: toNumber(killer?.hero_id),
      team,
      killedTeam,
      respawnS,
      // True when the API did not report a duration and the site's estimate stood in.
      respawnEstimated: recorded == null,
      untilS,
      position: event.position ?? null,
      killerPosition: event.killer_position ?? null,
      badges,
    });
  });

  return kills;
}

/**
 * Deaths clustered into team fights. A group of `FIGHT_MIN_KILLS` or more spaced no
 * further apart than `FIGHT_GAP_S` becomes a fight, padded by `FIGHT_PAD_S` on each
 * side; `winner` is the side with more kills (null when even or uncountable), and
 * `objective` is the first one the winner took within `FIGHT_FOLLOW_UP_S` afterwards.
 *
 * `objectives` are `{ timeS, label, laneName, ... }`; passing none simply leaves every
 * fight without a follow-up.
 */
export function buildFights(kills = [], { objectives = [] } = {}) {
  const groups = [];
  let current = [];
  for (const kill of kills || []) {
    const previous = current[current.length - 1];
    if (previous && (kill.timeS ?? 0) - (previous.timeS ?? 0) > FIGHT_GAP_S) {
      if (current.length >= FIGHT_MIN_KILLS) groups.push(current);
      current = [];
    }
    current.push(kill);
  }
  if (current.length >= FIGHT_MIN_KILLS) groups.push(current);

  const ordered = [...(objectives || [])].sort((a, b) => (timeOf(a) ?? 0) - (timeOf(b) ?? 0));

  return groups.map((group, index) => {
    const startS = (group[0].timeS ?? 0) - FIGHT_PAD_S;
    const endS = (group[group.length - 1].timeS ?? 0) + FIGHT_PAD_S;
    const amber = group.filter((kill) => kill.team === 0).length;
    const sapphire = group.filter((kill) => kill.team === 1).length;
    const winner = amber === sapphire ? null : amber > sapphire ? 0 : 1;
    const objective =
      ordered.find((entry) => {
        const at = timeOf(entry);
        return at != null && at >= endS && at <= endS + FIGHT_FOLLOW_UP_S;
      }) ?? null;

    return {
      index,
      startS,
      endS,
      kills: group,
      killIds: new Set(group.map((kill) => kill.id)),
      amberKills: amber,
      sapphireKills: sapphire,
      // Deaths with no recorded killer count toward neither side, so the score can be
      // smaller than the group.
      unresolvedKills: group.length - amber - sapphire,
      winner,
      score: `${amber}–${sapphire}`,
      objective,
    };
  });
}

/**
 * Objective destructions as the timeline needs them: when, whose, what it was called
 * and which lane it belonged to. Mid boss kills are not here -- they are their own
 * event type.
 */
export function buildObjectives(events = [], { labelOf = null, laneOf = null } = {}) {
  const objectives = [];
  (events || []).forEach((event, index) => {
    if (event?.type !== "objective") return;
    const objectiveId = toNumber(event.objective_id);
    const lane = laneOf ? laneOf(event.lane) : null;
    objectives.push({
      id: index,
      timeS: timeOf(event),
      team: toNumber(event.team),
      objectiveId,
      label: labelOf ? labelOf(objectiveId) : event.objective ?? null,
      laneId: toNumber(event.lane),
      laneName: lane?.name ?? null,
      laneColor: lane?.color ?? null,
      damage: toNumber(event.player_damage),
    });
  });
  return objectives;
}

/**
 * The purchases worth showing on a lane: the ones at or above `KEY_ITEM_MIN_TIER`.
 * A cheaper pickup is a component, not a power spike.
 */
export function keyPurchases(purchases = []) {
  return (purchases || [])
    .filter((purchase) => (toNumber(purchase?.tier) ?? 0) >= KEY_ITEM_MIN_TIER)
    .map((purchase) => ({
      timeS: timeOf(purchase),
      accountId: toNumber(purchase?.account_id),
      playerSlot: toNumber(purchase?.player_slot),
      team: toNumber(purchase?.team),
      itemId: toNumber(purchase?.item_id),
      item: purchase?.item ?? null,
      icon: purchase?.icon ?? null,
      image: purchase?.image ?? null,
      tier: toNumber(purchase?.tier),
      slot: purchase?.slot ?? null,
      soldTimeS: toNumber(purchase?.sold_time_s),
    }));
}

/** Everything the timeline tab derives in one call. */
export function buildTimelineModel({
  events = [],
  purchases = [],
  players = [],
  objectives: objectiveRows = null,
  durationS = null,
} = {}) {
  const bySlot = indexPlayers(players);
  const kills = buildKills(events, { players });
  const objectives = objectiveRows ?? buildObjectives(events);
  const fights = buildFights(kills, { objectives });

  const killFight = new Map();
  fights.forEach((fight) => {
    fight.killIds.forEach((killId) => killFight.set(killId, fight));
  });

  return {
    durationS: toNumber(durationS),
    playersBySlot: bySlot,
    kills,
    objectives,
    fights,
    keyPurchases: keyPurchases(purchases),
    /** The fight a kill belongs to, or undefined -- used to indent the feed. */
    fightForKill: (killId) => killFight.get(killId),
  };
}
