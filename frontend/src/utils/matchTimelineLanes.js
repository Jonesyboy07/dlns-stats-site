/**
 * The timeline's lane geometry: where every mark sits along the match clock.
 *
 * Each lane is a horizontal strip spanning 0..duration, so a match second becomes a
 * percentage of the strip's width. Doing that conversion here -- rather than inline in
 * the component -- matters because this is where the fiddly cases live: a fight shorter
 * than a few pixels still has to be clickable, a death bar must stop at the end of the
 * match rather than run past it, and a missing clock must not produce `NaN%`.
 *
 * Pure throughout: no DOM, no timers, so every rule is unit-testable.
 */

/** Axis labels every five minutes. */
export const LANE_AXIS_STEP_S = 300;
/** A fight band narrower than this is still worth a click. */
export const LANE_MIN_BAND_PX = 22;
/** Playback speeds, as multiples of real time: 1 x advances one match second per second. */
export const PLAYBACK_SPEEDS = [1, 2, 3, 4];
/**
 * Playback ticks this often. A quarter second is short enough that a marker glides to
 * its next position instead of stepping a whole match second at a time.
 */
export const PLAYBACK_TICK_MS = 250;

/**
 * Match seconds to advance per tick at a given speed.
 *
 * At 1 x this is exactly the tick's own length, which is what makes playback real time
 * rather than the accelerated replay it used to be. A speed or tick that cannot be used
 * advances nothing, so a bad value stalls rather than jumping the clock somewhere.
 */
export function playbackStep(speed = 1, tickMs = PLAYBACK_TICK_MS) {
  const rate = Number(speed);
  const tick = Number(tickMs);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  return (tick / 1000) * rate;
}
/** The kill track draws each kill as a tick in the half of the lane its team owns. */
export const TRACK_TICK = { height: 9, amberTop: 2, sapphireTop: 13 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * A match second as a percentage of the match. Anything outside the match clamps to an
 * edge, and a missing clock or duration returns null so the caller can skip the mark
 * rather than render it at `NaN%`.
 *
 * The null check is explicit because `Number(null)` is `0`, not `NaN`: without it a
 * death the API never dated would place itself at the start of the lane.
 */
export function percentOf(timeS, durationS) {
  if (timeS == null || durationS == null) return null;
  const time = Number(timeS);
  const duration = Number(durationS);
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return null;
  return clamp((time / duration) * 100, 0, 100);
}

/** The span between two match seconds as a `{ left, width }` percentage pair. */
export function spanPercent(startS, endS, durationS) {
  const left = percentOf(startS, durationS);
  const right = percentOf(endS, durationS);
  if (left === null || right === null) return null;
  return { left, width: Math.max(0, right - left) };
}

/** Axis labels every `stepS`, plus the closing tick at the end of the match. */
export function axisTicks(durationS, stepS = LANE_AXIS_STEP_S) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const ticks = [];
  for (let time = 0; time < duration; time += stepS) {
    ticks.push({ timeS: time, left: percentOf(time, duration) });
  }
  return ticks;
}

/** A click at `ratio` (0..1) across a lane, as a match second. */
export function seekTime(ratio, durationS) {
  const duration = Number(durationS);
  const value = Number(ratio);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, 1) * duration);
}

/**
 * One tick per kill, on the half of the lane its killer's team owns, so a glance down
 * the lane shows which side was winning the trades. `involved` is null when nobody is
 * highlighted, and true/false once somebody is, which is how the track fades the
 * kills that had nothing to do with them.
 */
export function killTicks(kills = [], durationS = null, { selection = [], involves = null } = {}) {
  return (kills || [])
    .map((kill) => {
      const left = percentOf(kill?.timeS, durationS);
      if (left === null) return null;
      const team = kill.team === 1 ? 1 : kill.team === 0 ? 0 : null;
      const involved = selection?.length && involves ? Boolean(involves(kill)) : null;
      return { killId: kill.id, timeS: kill.timeS, left, team, involved };
    })
    .filter(Boolean);
}

/** Objective marks: the Patron and Mid Boss read larger than a lane objective. */
export function objectiveMarks(objectives = [], durationS = null) {
  return (objectives || [])
    .map((objective) => {
      const left = percentOf(objective?.timeS, durationS);
      if (left === null) return null;
      return {
        timeS: objective.timeS,
        left,
        team: objective.team === 1 ? 1 : 0,
        label: objective.label,
        laneName: objective.laneName ?? null,
      };
    })
    .filter(Boolean);
}

/** Fight bands, positioned across the lane and labelled with the score. */
export function fightBands(fights = [], durationS = null) {
  return (fights || [])
    .map((fight) => {
      const span = spanPercent(fight?.startS, fight?.endS, durationS);
      if (!span) return null;
      return {
        index: fight.index,
        timeS: fight.startS,
        left: span.left,
        width: span.width,
        score: fight.score,
        winner: fight.winner ?? null,
      };
    })
    .filter(Boolean);
}

/**
 * One highlighted player's lane: how long they spent dead, the kills they made, and
 * the key items they bought.
 *
 * A death bar runs from the death to the end of the respawn, but never past the end of
 * the match -- a death at the final second would otherwise draw off the lane.
 */
export function playerLane({ kills = [], keyPurchases = [], accountId = null, durationS = null } = {}) {
  if (accountId == null) return { deadBars: [], killMarks: [], itemMarks: [] };

  const deadBars = (kills || [])
    .filter((kill) => kill.victimAccountId === accountId)
    .map((kill) => {
      const ended = kill.untilS == null ? kill.timeS : kill.untilS;
      const span = spanPercent(kill.timeS, ended, durationS);
      if (!span) return null;
      return {
        key: `dead-${kill.id}`,
        left: span.left,
        width: span.width,
        timeS: kill.timeS,
        respawnS: kill.respawnS,
        estimated: kill.respawnEstimated,
        killerName: kill.killerName ?? null,
      };
    })
    .filter(Boolean);

  const killMarks = (kills || [])
    .filter((kill) => kill.killerAccountId === accountId)
    .map((kill) => {
      const left = percentOf(kill.timeS, durationS);
      if (left === null) return null;
      return {
        key: `kill-${kill.id}`,
        left,
        timeS: kill.timeS,
        team: kill.team === 1 ? 1 : 0,
        victimName: kill.victimName ?? null,
      };
    })
    .filter(Boolean);

  const itemMarks = (keyPurchases || [])
    .filter((purchase) => purchase.accountId === accountId)
    .map((purchase, index) => {
      const left = percentOf(purchase.timeS, durationS);
      if (left === null) return null;
      return {
        key: `item-${purchase.itemId}-${index}`,
        left,
        timeS: purchase.timeS,
        item: purchase.item,
        icon: purchase.icon,
        image: purchase.image,
        soldTimeS: purchase.soldTimeS ?? null,
      };
    })
    .filter(Boolean);

  return { deadBars, killMarks, itemMarks };
}

/**
 * Everything the lane strip draws, in one call: the three fixed tracks, then one lane
 * per highlighted player.
 */
export function buildLaneView({
  kills = [],
  objectives = [],
  fights = [],
  keyPurchases = [],
  selection = [],
  players = [],
  durationS = null,
  involves = null,
} = {}) {
  const byAccount = new Map(
    (players || [])
      .filter((player) => player?.account_id != null)
      .map((player) => [player.account_id, player]),
  );

  return {
    tracks: {
      fights: fightBands(fights, durationS),
      kills: killTicks(kills, durationS, { selection, involves }),
      objectives: objectiveMarks(objectives, durationS),
    },
    players: (selection || []).map((accountId) => {
      const player = byAccount.get(accountId) ?? null;
      return {
        accountId,
        name: player?.persona_name ?? `#${accountId}`,
        heroId: player?.hero_id ?? null,
        team: player?.team === 1 ? 1 : 0,
        ...playerLane({ kills, keyPurchases, accountId, durationS }),
      };
    }),
    axis: axisTicks(durationS),
    durationS,
  };
}
