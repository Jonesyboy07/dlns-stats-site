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
export const PLAYBACK_SPEEDS = [1, 2, 4];
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
        // So hovering the mark lights the same kill on the map, the feed and the track.
        killId: kill.id,
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
        itemId: purchase.itemId,
        item: purchase.item,
        icon: purchase.icon,
        image: purchase.image,
        soldTimeS: purchase.soldTimeS ?? null,
      };
    })
    .filter(Boolean);

  return { deadBars, killMarks, itemMarks };
}

/** The soul-lead track's drawing box; the SVG scales it to the lane's real width. */
export const SOUL_LEAD_VIEW = { width: 1000, height: 56 };
/** The symmetric scale is the match's biggest lead times this, so the peak has headroom. */
export const SOUL_LEAD_HEADROOM = 1.1;

/**
 * Turning-point windows as faint bands on the soul-lead track, so the swings the header
 * names can be found on the chart. `points` come from `turningPoints()`.
 */
export function turningPointBands(points = [], durationS = null) {
  return (points || [])
    .map((point) => {
      const span = spanPercent(point?.startS, point?.endS, durationS);
      if (!span) return null;
      return {
        key: `tp-${point.startS}`,
        left: span.left,
        width: span.width,
        team: point.team === 1 ? 1 : 0,
        startS: point.startS,
        endS: point.endS,
      };
    })
    .filter(Boolean);
}

/**
 * The part of the soul-lead chart spoiler-safe hides: everything after the playhead.
 * Null when there is nothing left to hide (the clock is at the end) or no clock.
 */
export function spoilerMask(t, durationS) {
  const left = percentOf(t, durationS);
  if (left === null || left >= 100) return null;
  return { left, width: 100 - left };
}

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * One player's snapshots as `[{ timeS, souls, assists }]` in time order. Snapshots are
 * dated by `time_stamp_s`; when any lacks one they are spread evenly across the match
 * instead, the same fallback the scoreboard's souls chart uses.
 *
 * `assists` rides along because it only exists at snapshot granularity: the timeline
 * records each death's killer but not who assisted, so the roster can only read
 * assists between samples, never between events.
 */
export function datedSouls(snapshots = [], durationS = null) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const duration = finiteOrNull(durationS);
  const allTimed = list.length > 0 && list.every((s) => finiteOrNull(s?.time_stamp_s) !== null);
  return list
    .map((snapshot, index) => {
      let timeS = finiteOrNull(snapshot?.time_stamp_s);
      if (!allTimed) {
        if (duration === null || list.length < 2) return null;
        timeS = Math.round((index / (list.length - 1)) * duration);
      }
      const souls = finiteOrNull(snapshot?.net_worth);
      if (souls === null) return null;
      return { timeS, souls, assists: finiteOrNull(snapshot?.assists) };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeS - b.timeS);
}

/**
 * A value read off time-ordered `points` at `timeS`, linear between the points either
 * side. Everyone starts a match with nothing, so before the first point the value rises
 * from `zero` at 0:00 -- the same line the soul-lead track draws. After the last point
 * it holds. Null when there are no points.
 *
 * `read` and `zero` let one routine serve a single number or a `[amber, sapphire]`
 * pair; the result is rounded either way.
 */
export function interpolateAt(points = [], timeS = 0, { read = (p) => p.value, zero = 0 } = {}) {
  if (!points?.length) return null;
  const t = Math.max(0, Number(timeS) || 0);
  const mix = (a, b, ratio) =>
    Array.isArray(a)
      ? a.map((value, i) => Math.round(value + (b[i] - value) * ratio))
      : Math.round(a + (b - a) * ratio);
  const first = points[0];
  if (t <= first.timeS) {
    if (first.timeS <= 0) return mix(read(first), read(first), 0);
    return mix(zero, read(first), t / first.timeS);
  }
  const last = points[points.length - 1];
  if (t >= last.timeS) return mix(read(last), read(last), 0);
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid].timeS <= t) low = mid;
    else high = mid;
  }
  const a = points[low];
  const b = points[high];
  return mix(read(a), read(b), (t - a.timeS) / (b.timeS - a.timeS || 1));
}

/**
 * Amber's souls minus Sapphire's at every snapshot second, from the per-player
 * snapshots `/db/matches/<id>/timeline` returns.
 *
 * Each player's snapshots are dated by `time_stamp_s`; a player whose snapshots carry no
 * time has them spread evenly across the match, the same fallback the scoreboard's souls
 * chart uses. Players are summed at the union of all snapshot seconds, each holding their
 * latest value, so one player's snapshots landing a second late cannot spike the lead.
 * Returns `[{ timeS, lead, souls: [amber, sapphire] }]` in time order, or `[]` when there
 * is nothing to plot.
 */
export function soulLeadSeries(timelinePlayers = null, durationS = null) {
  const duration = finiteOrNull(durationS);
  const players = Object.values(timelinePlayers || {}).filter(
    (player) => player && (player.team === 0 || player.team === 1),
  );

  const dated = players.map((player) => ({
    team: player.team,
    points: datedSouls(player.snapshots, duration),
  }));

  const times = [...new Set(dated.flatMap((player) => player.points.map((p) => p.timeS)))].sort(
    (a, b) => a - b,
  );
  if (!times.length) return [];

  // One cursor per player walks forward with the clock, so this is linear in snapshots.
  const cursors = dated.map(() => -1);
  return times.map((timeS) => {
    const souls = [0, 0];
    dated.forEach((player, i) => {
      while (cursors[i] + 1 < player.points.length && player.points[cursors[i] + 1].timeS <= timeS) {
        cursors[i] += 1;
      }
      if (cursors[i] >= 0) souls[player.team] += player.points[cursors[i]].souls;
    });
    return { timeS, lead: souls[0] - souls[1], souls };
  });
}

/**
 * The lead at `timeS`, interpolated between the snapshots either side so the readout
 * moves smoothly during playback. Before the first snapshot it rises from an even 0:00,
 * matching the drawn line; after the last it holds. Null when there is no series.
 */
export function soulLeadAt(series = [], timeS = 0) {
  // Derived from the team totals so the lane's readout and the header's gap can never
  // differ by a rounding step.
  const souls = teamSoulsAt(series, timeS);
  return souls ? souls[0] - souls[1] : null;
}

/**
 * Each team's banked souls at `timeS` as `[amber, sapphire]`, interpolated like
 * `soulLeadAt` so the header's totals and the lane's readout always agree. Before the
 * first snapshot both rise from 0 at 0:00; null when there is no series.
 */
export function teamSoulsAt(series = [], timeS = 0) {
  const totals = (point) => point.souls ?? [Math.max(0, point.lead), Math.max(0, -point.lead)];
  return interpolateAt(series, timeS, { read: totals, zero: [0, 0] });
}

/**
 * The soul-lead track's geometry in `SOUL_LEAD_VIEW` units: a polyline for the lead and
 * a closed area path that the component clips into the Amber (above zero) and Sapphire
 * (below zero) halves. The scale is symmetric -- `scaleSouls`, the biggest lead times
 * `SOUL_LEAD_HEADROOM` -- so neither side's region looks bigger than it is, and the
 * track labels its top and bottom with it. The line starts at 0:00 with no lead when the
 * first snapshot is later.
 */
export function soulLeadPath(series = [], durationS = null, view = SOUL_LEAD_VIEW) {
  const duration = finiteOrNull(durationS);
  if (!series?.length || duration === null || duration <= 0) return null;

  const points = series[0].timeS > 0 ? [{ timeS: 0, lead: 0 }, ...series] : series;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.lead)));
  const scaleSouls = maxAbs * SOUL_LEAD_HEADROOM;
  const mid = view.height / 2;
  const scale = mid / scaleSouls;

  const coords = points.map((p) => {
    const x = (clamp(p.timeS, 0, duration) / duration) * view.width;
    const y = mid - p.lead * scale;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `M${first[0]},${mid} L${line.replace(/ /g, " L")} L${last[0]},${mid} Z`;

  const peak = points.reduce(
    (acc, p) => {
      if (p.lead > acc.amber.lead) acc.amber = p;
      if (p.lead < acc.sapphire.lead) acc.sapphire = p;
      return acc;
    },
    { amber: { lead: 0, timeS: null }, sapphire: { lead: 0, timeS: null } },
  );

  return { line, area, mid, maxAbs, scaleSouls, peak };
}

/**
 * Everything the lane strip draws, in one call: the fixed tracks, then one lane per
 * highlighted player. `soulLead` is a precomputed `soulLeadSeries` -- it is built once
 * per match rather than on every playback tick.
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
  soulLead = [],
  turningPoints = [],
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
      souls: soulLeadPath(soulLead, durationS),
      turningPoints: turningPointBands(turningPoints, durationS),
    },
    soulLead: soulLead || [],
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
