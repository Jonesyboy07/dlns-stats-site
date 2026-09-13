/**
 * Series grouping helpers for the home page.
 *
 * Deliberately plain functions — no React — so the week/series/score roll-up
 * can be unit tested without rendering anything.
 */

/** "2026-08-01T18:00:00+00:00" -> "1 Aug 2026" (UTC, so everyone agrees). */
export function formatWeekDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Fold paged match rows plus /db/weeks details into per-week series groups.
 *
 * Matches with no entry in matches.json (or no week) are skipped: they cannot
 * be attributed to a week, so showing them would invent a fixture.
 *
 * @param {Array<Object>} matches - rows from /db/matches/latest/paged
 * @param {Object} details - details map from /db/weeks, keyed by match_id
 * @returns {Array<Object>} week groups, newest week first. Each group is
 *   `{ week, totalSeries, dateLabel, entries[] }`; each entry is
 *   `{ week, series, series_title, team_a, team_b, wins_a, wins_b,
 *      games: [{ matchId, game }], firstMatchId, vod_url, start_time }`.
 */
export function buildWeekGroups(matches, details) {
  const detailMap = details || {};
  const seriesMap = new Map();

  for (const match of matches || []) {
    const detail = detailMap[String(match.match_id)];
    if (!detail || detail.week == null) continue;

    const key = `${detail.week}_${(detail.team_a || "").toLowerCase()}_${(detail.team_b || "").toLowerCase()}`;

    let entry = seriesMap.get(key);
    if (!entry) {
      entry = {
        week: detail.week,
        series: detail.series,
        series_title: detail.series_title || "",
        team_a: detail.team_a || "TBD",
        team_b: detail.team_b || "TBD",
        wins_a: 0,
        wins_b: 0,
        games: [],
        firstMatchId: match.match_id,
        vod_url: detail.match_vod || "",
        start_time: match.start_time || match.created_at || null,
      };
      seriesMap.set(key, entry);
    }

    entry.games.push({ matchId: match.match_id });
    if (!entry.vod_url && detail.match_vod) entry.vod_url = detail.match_vod;

    // `event_team_a_ingame_side` says which game side team A played; when it is
    // missing we assume side 0, matching the previous behaviour.
    const teamASide =
      match.event_team_a_ingame_side != null
        ? match.event_team_a_ingame_side
        : 0;
    if (match.winning_team === teamASide) entry.wins_a += 1;
    else if (match.winning_team != null) entry.wins_b += 1;

    const playedAt = match.start_time || match.created_at;
    if (
      playedAt &&
      (!entry.start_time || new Date(playedAt) < new Date(entry.start_time))
    ) {
      entry.start_time = playedAt;
    }
  }

  const weeks = new Map();
  for (const entry of seriesMap.values()) {
    // Number the games 1, 2, 3… in the order they were played.
    entry.games.sort((a, b) => a.matchId - b.matchId);
    entry.games.forEach((game, index) => {
      game.game = index + 1;
    });

    let group = weeks.get(entry.week);
    if (!group) {
      group = { week: entry.week, entries: [], earliest: null };
      weeks.set(entry.week, group);
    }
    group.entries.push(entry);

    // The week's own date comes from its earliest game.
    if (
      entry.start_time &&
      (!group.earliest || new Date(entry.start_time) < new Date(group.earliest))
    ) {
      group.earliest = entry.start_time;
    }
  }

  return [...weeks.values()]
    .map((group) => ({
      week: group.week,
      totalSeries: group.entries.length,
      dateLabel: formatWeekDate(group.earliest),
      entries: group.entries.sort((a, b) =>
        a.firstMatchId > b.firstMatchId ? -1 : 1,
      ),
    }))
    .sort((a, b) => Number(b.week) - Number(a.week));
}
