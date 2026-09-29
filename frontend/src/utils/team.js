/**
 * Team page derived values.
 *
 * The team endpoints hand over raw rows (matches, players, weeks); everything the
 * redesigned page shows on top of that — records, tones, series groups, tenure
 * cells — is derived here so the components stay presentational and the rules are
 * testable in one place.
 */

export const DASH = "\u2014";

/** Team names are hand-authored in matches.json, so compare them without case. */
export const sameTeam = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

/**
 * Win = true, loss = false, null when the side or the winner is unknown.
 *
 * Requires the sides: a match with no `event_team_a_ingame_side` cannot say which
 * team won, so it stays unknown rather than defaulting to a loss.
 */
export function gameResult(match, teamName) {
  const side = match?.event_team_a_ingame_side;
  if (side == null || match?.winning_team == null) return null;
  return sameTeam(match.event_team_a, teamName)
    ? match.winning_team === side
    : match.winning_team !== side;
}

/**
 * A record as the design paints it: the number that DECIDED it carries the
 * colour (green when the wins lead, red when the losses do) and the other stays
 * secondary, so "22–12" reads as a win at a glance.
 *
 * `barPct` is 0-100 for the win-rate track; `pct` is the label, null when nothing
 * is decided.
 */
export function recordOf(wins = 0, losses = 0) {
  const w = wins ?? 0;
  const l = losses ?? 0;
  const decided = w + l;
  return {
    wins: w,
    losses: l,
    decided,
    played: decided > 0,
    barPct: decided > 0 ? (w / decided) * 100 : 0,
    pct: decided > 0 ? `${Math.round((w / decided) * 100)}%` : null,
    winsTone: w > l ? "text-success" : "text-secondary",
    lossesTone: l > w ? "text-danger-text" : "text-secondary",
  };
}

/**
 * Group a team's flat match list into series, then into weeks.
 *
 * Input is newest-first (the endpoint's order), and the output keeps that: weeks
 * newest first, series within a week newest first. Each series' GAMES are re-ordered
 * oldest-first, because a series reads as game 1 → N and only `start_time` (or, when
 * that is missing, the reversal of the input order) can establish that.
 *
 * A series is one matchup within one event and week — the same key the backend uses
 * for its own series record, so the two agree.
 */
export function seriesGroups(matches = [], teamName) {
  const bySeries = new Map();

  for (const match of matches) {
    const key = [
      match.event_team_a,
      match.event_team_b,
      match.event_title,
      match.event_week,
    ].join("||");
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key).push(match);
  }

  const series = [...bySeries.entries()].map(([key, games]) => {
    const ordered =
      games.length < 2
        ? games
        : games.every((m) => m.start_time)
          ? [...games].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
          : [...games].reverse();

    const first = ordered[0];
    const opponent = sameTeam(first.event_team_a, teamName)
      ? first.event_team_b
      : first.event_team_a;

    let wins = 0;
    let losses = 0;
    let seconds = 0;
    let timed = 0;
    for (const game of ordered) {
      const result = gameResult(game, teamName);
      if (result === true) wins += 1;
      else if (result === false) losses += 1;
      if (game.duration_s) {
        seconds += game.duration_s;
        timed += 1;
      }
    }

    return {
      key,
      week: first.event_week ?? null,
      opponent,
      games: ordered,
      wins,
      losses,
      avgSeconds: timed > 0 ? seconds / timed : null,
      date: first.start_time ?? first.created_at ?? null,
      newest: games[0]?.start_time ?? games[0]?.created_at ?? "",
    };
  });

  series.sort((a, b) => String(b.newest).localeCompare(String(a.newest)));

  const weeks = [];
  for (const item of series) {
    const last = weeks[weeks.length - 1];
    if (last && last.week === item.week) last.items.push(item);
    else weeks.push({ week: item.week, items: [item] });
  }
  return weeks;
}

/** The team's own week span, from the matches it actually played. */
export function teamWeekRange(matches = []) {
  const weeks = matches
    .map((match) => match.event_week)
    .filter((week) => week != null);
  if (weeks.length === 0) return { first: null, last: null };
  return { first: Math.min(...weeks), last: Math.max(...weeks) };
}

/** One cell per axis week: rostered or not. */
export function tenureCells(playerWeeks = [], axis = []) {
  const played = new Set(playerWeeks);
  return axis.map((week) => ({ week, rostered: played.has(week) }));
}

/**
 * Which axis weeks get a printed label: every `every`-th week plus the last one,
 * so the axis always states both where it starts and where it ends.
 */
export function axisLabels(axis = [], every = 3) {
  const labels = new Set();
  axis.forEach((week, index) => {
    if (index % every === 0 || index === axis.length - 1) labels.add(week);
  });
  return labels;
}

/** "NS 44–58 · 15 wk · 34 g" — a single week collapses to "NS 52 · 1 wk · 7 g". */
export function tenureSummary({ first, last, weeks, games }) {
  if (first == null && last == null) return null;
  const span = first == null || first === last ? `NS ${last ?? first}` : `NS ${first}\u2013${last}`;
  const parts = [span];
  if (weeks != null) parts.push(`${weeks} wk`);
  if (games != null) parts.push(`${games} g`);
  return parts.join(" \u00b7 ");
}
