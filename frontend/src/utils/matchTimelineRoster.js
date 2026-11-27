/**
 * Who is alive, who is respawning, and what the score is at the current match second.
 *
 * The roster and the header both read from here, so the "4 alive" count, a player's
 * countdown and the scoreline can never disagree with each other or with the map.
 * Pure: the clock comes in as an argument.
 */

import { datedSouls, interpolateAt } from "./matchTimelineLanes";

/** A kill counts toward the scoreline once its second has passed. */
export function teamScores(kills = [], t = null) {
  const at = t == null ? Infinity : Number(t);
  const scores = { 0: 0, 1: 0 };
  for (const kill of kills || []) {
    const timeS = kill?.timeS;
    if (timeS == null || timeS > at) continue;
    if (kill.team === 0 || kill.team === 1) scores[kill.team] += 1;
  }
  return scores;
}

/**
 * Each player with their state at `t`: whether they are down, and how many seconds are
 * left. A player is dead between a death and the end of its respawn, which is the same
 * window the map's kill lines and the lanes' dead bars use.
 *
 * `remainingS` rounds up, so a player with half a second left reads "1s" rather than
 * "0s" sitting next to a dead pill.
 *
 * `kills` and `deaths` count the kill events up to `t`, so they are exact. Assists are
 * not counted: a death records only its killer. `souls` is estimated between the
 * player's stats snapshots (minutes apart) and is null without them; `timelinePlayers`
 * is the `/timeline` response's `players`, keyed by account id.
 */
export function playerStates(
  players = [],
  kills = [],
  t = null,
  { timelinePlayers = null, durationS = null } = {},
) {
  const at = t == null ? Infinity : Number(t);
  const soulsClock = Number.isFinite(at) ? at : Number(durationS) || Infinity;
  return (players || []).map((player) => {
    let killCount = 0;
    let deathCount = 0;
    for (const kill of kills || []) {
      if (kill.timeS == null || kill.timeS > at) continue;
      if (kill.killerAccountId === player.account_id) killCount += 1;
      if (kill.victimAccountId === player.account_id) deathCount += 1;
    }
    const snapshots = timelinePlayers?.[String(player.account_id)]?.snapshots;
    const points = datedSouls(snapshots, durationS);
    const souls = Number.isFinite(soulsClock)
      ? interpolateAt(points, soulsClock, { read: (p) => p.souls })
      : points.length
        ? points[points.length - 1].souls
        : null;

    const death = (kills || []).find((kill) => {
      if (kill.victimAccountId !== player.account_id) return false;
      if (kill.timeS == null || kill.timeS > at) return false;
      return kill.untilS != null && at < kill.untilS;
    });
    const remainingS = death ? Math.max(0, Math.ceil(death.untilS - at)) : 0;
    return {
      ...player,
      dead: Boolean(death),
      remainingS,
      killerName: death?.killerName ?? null,
      kills: killCount,
      deaths: deathCount,
      souls,
    };
  });
}

/** How many of one side are up. */
export function aliveCount(states = [], team = null) {
  return (states || []).filter((state) => state.team === team && !state.dead).length;
}

/**
 * The roster split into its two sides, each with its alive count. Sides come back in
 * the order [0, 1], which is what lets the layout mirror the second panel.
 */
export function buildRoster({
  players = [],
  kills = [],
  t = null,
  timelinePlayers = null,
  durationS = null,
} = {}) {
  const states = playerStates(players, kills, t, { timelinePlayers, durationS });
  const order = (state) => state.player_slot ?? 0;
  return [0, 1].map((team) => {
    const members = states.filter((state) => state.team === team).sort((a, b) => order(a) - order(b));
    return { team, members, alive: members.filter((state) => !state.dead).length };
  });
}
