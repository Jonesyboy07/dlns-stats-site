/**
 * What the timeline's map draws, and how each death is styled.
 *
 * The map is four layers: the minimap art, a heat canvas, killer-to-victim lines and
 * death crosses. This module decides the contents of the last three from the derived
 * kills in `matchTimelineModel.js`, so the component itself stays a thin renderer and
 * every rule -- which deaths are in view, who is highlighted, which lines are drawn --
 * can be unit-tested without a canvas.
 *
 * Positions arrive in world units and go through the same `worldToPixels` transform
 * the rest of the site uses, so the map can never disagree with `MatchMap`.
 */

import { trailPositionAt } from "./replay";
import { worldToPercent, worldToPixels } from "./matchMap";

/** The design fixes the map at 520px; the heat radius below is expressed against it. */
export const MAP_SIZE = 520;
/** ~5.8% of the map width, per the handoff's heatmap spec. */
export const HEAT_RADIUS = 30;
/** "Last 3 min" on the window control. */
export const RECENT_WINDOW_S = 180;
/** A death this recent is still "fresh" and gets the highlight ring. */
export const FRESH_DEATH_S = 40;

/** Heat strokes are drawn per colour group and composited onto the map. */
export const HEAT_COLORS = {
  amber: "rgb(250,175,40)",
  sapphire: "rgb(80,140,255)",
  single: "rgb(190,130,250)",
};

/** Death cross sizes: resting, over the heat, highlighted, and faded out. */
export const DOT_SIZE = { base: 11, both: 8, highlighted: 14, faded: 7, freshBonus: 5 };

export const KILL_LINE_WIDTH = 2;
export const KILLER_RING_SIZE = 10;
/** Lines dim to this when the reader is hovering a different kill. */
export const KILL_LINE_DIM = 0.35;

/** The map modes, in tab order, with the label each one shows. Keeping the labels here
 * keeps the tab strip and the rules from drifting apart. */
export const MAP_MODE_LABELS = {
  deaths: "Deaths",
  heat: "Heatmap",
  both: "Both",
  realtime: "Realtime",
};
export const MAP_MODES = Object.keys(MAP_MODE_LABELS);
export const HEAT_COLORS_MODE = ["team", "single"];
export const RANGES = ["all", "recent"];
export const LINE_MODES = ["off", "hover", "all"];

/** The site's own team colours, so a line matches every other team mark on the page. */
export const TEAM_STROKE = {
  0: "var(--color-team-amber)",
  1: "var(--color-team-sapphire)",
};

const toNumber = (value) => (value == null ? null : Number(value));

/** A world position as `{x, y}` pixels on the map, or null when it is incomplete. */
export function mapPoint(position, size = MAP_SIZE) {
  if (!position) return null;
  const x = toNumber(position.x);
  const y = toNumber(position.y);
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return worldToPixels(x, y, size, size);
}

/** Is either end of this kill one of the highlighted players? */
export function killInvolves(kill, selection = []) {
  if (!selection?.length) return false;
  return selection.includes(kill?.killerAccountId) || selection.includes(kill?.victimAccountId);
}

/**
 * The deaths the map can plot: those with a position, already fatal by `t`, and inside
 * the window. A focused fight ignores both `t` and the window -- focusing a fight is
 * how the reader asks to see exactly that engagement.
 */
export function plottableDeaths(kills = [], { t = null, range = "all", focusedFight = null } = {}) {
  if (focusedFight) return focusedFight.kills.filter((kill) => mapPoint(kill.position));

  const at = t == null ? Infinity : toNumber(t);
  const from = range === "recent" && at !== Infinity ? at - RECENT_WINDOW_S : -Infinity;

  return (kills || []).filter((kill) => {
    const timeS = toNumber(kill?.timeS);
    if (timeS == null || !mapPoint(kill.position)) return false;
    return timeS <= at && timeS >= from;
  });
}

/**
 * The deaths that colour the heatmap: the highlighted players' own deaths, or every
 * visible death when nobody is highlighted.
 */
export function heatDeaths(deaths = [], { selection = [] } = {}) {
  if (!selection?.length) return deaths;
  return deaths.filter((kill) => selection.includes(kill.victimAccountId));
}

/**
 * Heat strokes grouped by colour. `team` splits them by the side that died, so amber
 * means the first team's deaths; `single` puts them all in one group.
 */
export function heatGroups(deaths = [], { color = "team", selection = [] } = {}) {
  const scoped = heatDeaths(deaths, { selection });
  if (color === "single") return [{ color: HEAT_COLORS.single, deaths: scoped }];
  return [
    { color: HEAT_COLORS.amber, deaths: scoped.filter((kill) => toNumber(kill.killedTeam) === 0) },
    { color: HEAT_COLORS.sapphire, deaths: scoped.filter((kill) => toNumber(kill.killedTeam) === 1) },
  ].filter((group) => group.deaths.length > 0);
}

/** Both ends of a kill line in pixels, or null when the killer's position is missing. */
export function killLine(kill, size = MAP_SIZE) {
  const victim = mapPoint(kill?.position, size);
  const killer = mapPoint(kill?.killerPosition, size);
  if (!victim || !killer) return null;
  return { x1: killer.x, y1: killer.y, x2: victim.x, y2: victim.y };
}

/**
 * Which kills get a line drawn. `all` draws every visible kill (narrowed to the
 * highlighted players when there is a selection), `hover` only the one being pointed
 * at, and `off` none.
 */
export function lineDeaths(deaths = [], { lines = "hover", hoveredKillId = null, selection = [] } = {}) {
  if (lines === "off") return [];
  if (lines === "hover") {
    if (hoveredKillId == null) return [];
    const hit = (deaths || []).find((kill) => kill.id === hoveredKillId);
    return hit ? [hit] : [];
  }
  if (!selection?.length) return deaths;
  return deaths.filter((kill) => killInvolves(kill, selection));
}

/**
 * How one death is drawn: where, how big, and whether it is hollow.
 *
 * Highlighting a player grows the kills they were part of to `highlighted` and shrinks
 * everything else to `faded`; their *own* deaths are drawn hollow, so a highlighted
 * player's deaths read differently from the kills they made. A death in the last
 * `FRESH_DEATH_S` seconds of the clock grows and takes the accent ring.
 */
export function dotFor(
  kill,
  { t = null, mode = "deaths", selection = [], focusedFight = null, durationS = null } = {},
) {
  const point = mapPoint(kill?.position);
  if (!point) return null;

  const hasSelection = Boolean(selection?.length);
  const involved = killInvolves(kill, selection);
  const faded = hasSelection && !involved;
  const base = mode === "both" ? DOT_SIZE.both : DOT_SIZE.base;

  const at = toNumber(t);
  const duration = toNumber(durationS);
  const timeS = toNumber(kill?.timeS);
  const fresh =
    !focusedFight && at != null && duration != null && at < duration && timeS != null &&
    at - timeS < FRESH_DEATH_S;

  let size = faded ? DOT_SIZE.faded : involved ? DOT_SIZE.highlighted : base;
  if (fresh) size += DOT_SIZE.freshBonus;

  return {
    ...point,
    size,
    opacity: faded ? 0.15 : 1,
    team: toNumber(kill?.team),
    // Born of the victim being highlighted while the killer is not, so two players on
    // one side fighting each other still read as a normal death.
    hollow:
      hasSelection &&
      selection.includes(kill?.victimAccountId) &&
      !selection.includes(kill?.killerAccountId),
    fresh,
    killId: kill?.id ?? null,
    timeS,
  };
}

/**
 * Where each tracked player stands at the clock, from their position trail.
 *
 * This is the map's "Realtime" mode: the death plot answers *where did people die*, and
 * this answers *where are they now*, which is what makes the timeline scrub like a
 * replay.
 *
 * `MatchReplay` does the same job but reads the respawn from the site's estimate. This
 * uses the recorded duration the roster and the lanes already count down, so a
 * countdown on the map can never disagree with the one beside a player's name. A
 * player inside their respawn window is pinned where they fell and marked `dead`.
 *
 * Left/top come back as percentages of the map, matching `playerMarkersAt`.
 */
export function trailMarkers(trails = [], kills = [], t = null) {
  if (t == null || !Number.isFinite(Number(t))) return [];
  const at = Number(t);

  return (trails || [])
    .map((trail) => {
      const player = trail?.player ?? {};
      const death = (kills || []).find(
        (kill) =>
          kill.victimAccountId === player.account_id &&
          kill.timeS != null &&
          kill.timeS <= at &&
          kill.untilS != null &&
          at < kill.untilS,
      );
      const dead = Boolean(death);
      // A dead player is shown where they fell; the trail keeps running, and following
      // it would slide their marker away from their own corpse.
      const position = dead
        ? death.position ?? trailPositionAt(trail, death.timeS)
        : trailPositionAt(trail, at);
      const point = position ? worldToPercent(position.x, position.y) : null;
      if (!point) return null;
      return {
        key: `trail-${player.player_slot ?? player.account_id}`,
        accountId: player.account_id ?? null,
        playerSlot: player.player_slot ?? null,
        team: player.team === 1 ? 1 : 0,
        heroId: player.hero_id ?? null,
        name: player.persona_name || `Slot ${player.player_slot}`,
        left: point.left,
        top: point.top,
        dead,
        respawnIn: dead ? Math.max(0, Math.ceil(death.untilS - at)) : 0,
      };
    })
    .filter(Boolean);
}

/**
 * Wording for Trails mode, which shows live player positions rather than deaths. A match
 * without recorded trails would otherwise caption an empty map with "0 players tracked",
 * which reads like a bug rather than missing data.
 */
export function trailCaption(count = 0) {
  if (!count) return "No position trails recorded for this match";
  return `${count} player${count === 1 ? "" : "s"} tracked · ring = their side`;
}

/** The line of small print under the map, describing exactly what is on it. */
export function mapCaption({
  shown = 0,
  selection = [],
  names = [],
  mode = "deaths",
  heatColor = "team",
  lines = "hover",
  focusedFight = null,
  teamNames = [],
} = {}) {
  const parts = [
    focusedFight ? `Fight ${focusedFight.index + 1}: ${shown} deaths` : `${shown} deaths shown`,
  ];

  if (selection.length && names.length) {
    parts.push(`${names.join(", ")} highlighted (hollow = their deaths)`);
  }
  // Only the two heat modes carry a heat layer, so only they describe one.
  if (mode === "heat" || mode === "both") {
    if (heatColor === "single") {
      parts.push("heat: all deaths");
    } else {
      const amber = teamNames[0] || "amber";
      const sapphire = teamNames[1] || "blue";
      parts.push(`heat: amber = ${amber} deaths, blue = ${sapphire} deaths`);
    }
  }
  if (lines !== "off" || focusedFight) parts.push("ring = killer position");
  return parts.join(" · ");
}

/**
 * Everything the map draws, in one call: the dots, the heat groups and the lines.
 * Composing it here keeps the component free of the rules.
 */
export function buildMapView({
  kills = [],
  t = null,
  range = "all",
  mode = "deaths",
  heatColor = "team",
  lines = "hover",
  hoveredKillId = null,
  selection = [],
  focusedFight = null,
  durationS = null,
  size = MAP_SIZE,
} = {}) {
  // Real time is a position view, so a death belongs on it only while it is still news.
  // It reuses the "Last 3 min" window rather than defining its own, so the two features
  // can never disagree about how long three minutes is.
  const deaths = plottableDeaths(kills, {
    t,
    range: mode === "realtime" ? "recent" : range,
    focusedFight,
  });
  const dots = deaths
    .map((kill) => ({ kill, dot: dotFor(kill, { t, mode, selection, focusedFight, durationS }) }))
    .filter((entry) => entry.dot);

  // Heat belongs to the plot modes that show deaths as a density. It hides the crosses
  // so the two layers do not fight for the same pixels.
  const heatOn = mode === "heat" || mode === "both";
  const dotsForHeat = mode === "heat" ? [] : dots;
  const linesDrawn = lineDeaths(deaths, { lines, hoveredKillId, selection })
    .map((kill) => {
      const geometry = killLine(kill, size);
      return geometry
        ? {
            ...geometry,
            killId: kill.id,
            color: TEAM_STROKE[toNumber(kill.team)] ?? TEAM_STROKE[1],
            opacity: hoveredKillId != null && kill.id !== hoveredKillId ? KILL_LINE_DIM : 1,
          }
        : null;
    })
    .filter(Boolean);

  return {
    deaths,
    dots: dotsForHeat,
    heat: heatOn ? heatGroups(deaths, { color: heatColor, selection }) : [],
    lines: linesDrawn,
    hoveredKillId,
    size,
  };
}
