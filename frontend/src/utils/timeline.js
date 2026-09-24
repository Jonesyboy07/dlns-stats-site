/**
 * Roster timeline geometry.
 *
 * The axis is an explicit list of weeks rather than a numeric first..last range,
 * because the league can skip a week. Adjacency is therefore measured in COLUMN
 * positions, not in week numbers: two weeks sitting next to each other on the
 * axis stay visually joined even when their numbers differ by more than one.
 * That keeps a break in a bar meaning exactly "the team played and this player
 * did not", instead of also meaning "the league took a week off".
 */

/** Map each axis week to its column index. */
export function weekColumns(weeks = []) {
  const columns = new Map();
  weeks.forEach((week, index) => columns.set(week, index));
  return columns;
}

/**
 * Collapse a player's weeks into runs of adjacent axis columns.
 * Returns `[{ start, span }]` in column units, ordered left to right.
 */
export function toSegments(playerWeeks = [], weeks = []) {
  const columns = weekColumns(weeks);
  const indices = [
    ...new Set(
      playerWeeks
        .map((week) => columns.get(week))
        .filter((index) => index !== undefined),
    ),
  ].sort((a, b) => a - b);

  const segments = [];
  for (const index of indices) {
    const previous = segments[segments.length - 1];
    if (previous && index === previous.start + previous.span) {
      previous.span += 1;
    } else {
      segments.push({ start: index, span: 1 });
    }
  }
  return segments;
}

/** The weeks a player actually played, in axis order. */
export function playedWeeks(playerWeeks = [], weeks = []) {
  const played = new Set(playerWeeks);
  return weeks.filter((week) => played.has(week));
}

/** A player is on the current roster when they turned out in the latest week. */
export function isActivePlayer(player, maxWeek) {
  return maxWeek == null || player?.last_week === maxWeek;
}

/**
 * Invert the timeline rows: axis week -> the rows that played it, in display
 * order. Weeks nobody played (the team sat one out) are absent from the map, so
 * callers can tell "no lineup" from "week not on the axis".
 */
export function lineupsByWeek(rows = []) {
  const lineups = new Map();
  for (const row of rows) {
    for (const week of row.played ?? []) {
      if (!lineups.has(week)) lineups.set(week, []);
      lineups.get(week).push(row);
    }
  }
  return lineups;
}

/**
 * Where a contiguous run of weeks sits inside the league's full history, as
 * percentages of the whole strip.
 *
 * Used by the league ruler for both the team's tenure and the currently visible
 * slice, so the two bands are directly comparable. Positions are ORDINAL (index
 * within the league's week list), not arithmetic on week numbers, so a bye week
 * would not distort the proportions.
 */
export function spanPercentages(fromWeek, toWeek, leagueWeeks = []) {
  const total = leagueWeeks.length;
  if (total === 0 || fromWeek == null || toWeek == null) {
    return { startPct: 0, widthPct: 0, weeks: 0, total };
  }

  const fromIndex = leagueWeeks.indexOf(fromWeek);
  const toIndex = leagueWeeks.indexOf(toWeek);
  const from = fromIndex < 0 ? 0 : fromIndex;
  const to = toIndex < 0 ? total - 1 : toIndex;
  const start = Math.min(from, to);
  const end = Math.max(from, to);

  return {
    startPct: (start / total) * 100,
    widthPct: ((end - start + 1) / total) * 100,
    weeks: end - start + 1,
    total,
  };
}

/**
 * Active roster first, then alumni; each group by games desc, then by name.
 * The API already returns this order, but re-deriving it keeps the component
 * correct for any input and makes the rule testable.
 */
export function orderTimelineRows(players = [], maxWeek) {
  const byGamesThenName = (a, b) => {
    const gamesA = a.appearances ?? 0;
    const gamesB = b.appearances ?? 0;
    if (gamesA !== gamesB) return gamesB - gamesA;

    const nameA = (a.persona_name ?? "").toLowerCase();
    const nameB = (b.persona_name ?? "").toLowerCase();
    if (nameA === nameB) return 0;
    return nameA < nameB ? -1 : 1;
  };

  const active = players.filter((player) => isActivePlayer(player, maxWeek));
  const alumni = players.filter((player) => !isActivePlayer(player, maxWeek));
  return [...active.sort(byGamesThenName), ...alumni.sort(byGamesThenName)];
}
