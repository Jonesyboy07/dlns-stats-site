/**
 * Derivations for the merged Night Shift week page (`/week/:n`).
 *
 * Everything here is pure over the `/db/nightshift` payloads so the bracket,
 * leaderboard, match-results and picks panels all narrow from the same scope
 * rule: the week, plus a selected series if there is one, otherwise a region.
 *
 * Source shape notes:
 * - A week's matches each carry `event_region` (NA/EU, hand-authored and
 *   occasionally blank), `event_subtitle` (the round title, e.g. "FINALS") and
 *   `event_team_a` / `event_team_b`.
 * - `winning_team` is the in-game side (0 = Amber, 1 = Sapphire) and
 *   `event_team_a_ingame_side` maps team A onto a side.
 */

export const REGION_ORDER = ["NA", "EU"];

export const WEEK_STATS = [
  { key: "k", label: "Kills", column: "kills" },
  { key: "a", label: "Assists", column: "assists" },
  { key: "d", label: "Deaths", column: "deaths" },
  { key: "obj", label: "Obj Damage", column: "player_damage" },
  { key: "heal", label: "Healing", column: "player_healing" },
  { key: "souls", label: "Souls", column: "net_worth" },
];

export const LEADERBOARD_PREVIEW = 8;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-09-28T18:00:00Z` -> `Sep 28, 2026`. */
export function formatLongDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** `2026-09-28T18:00:00Z` -> `Sep 28`. */
export function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** `2026-09-28T18:00:00Z` -> `Sep 2026`, used for the sidebar month groups. */
export function monthLabel(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Seconds -> `m:ss`. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") return "—";
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return "—";
  const whole = Math.floor(total);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function regionLabel(region) {
  if (!region || region === "all") return "both regions";
  return region;
}

const normalizeRegion = (value) => {
  const region = String(value || "").trim().toUpperCase();
  return region || null;
};

/** A round is the grand final when its hand-authored title says "final". */
export const isFinalRound = (round) => /final/i.test(String(round || ""));

/** Which side won a single match: 'a', 'b', or null when undecided. */
export function matchWinnerSide(match) {
  const winning = match?.winning_team;
  if (winning !== 0 && winning !== 1) return null;
  const sideA = match?.event_team_a_ingame_side;
  const resolvedSideA = sideA === 0 || sideA === 1 ? sideA : 0;
  return winning === resolvedSideA ? "a" : "b";
}

/** Two-letter initials for a team name: "Melee Creeps" -> "MC". */
export function teamInitials(name) {
  const parts = String(name || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Group a week's matches into series (one per team pairing). Blank regions are
 * inferred from a team that already has one, mirroring the week index endpoint,
 * so the sidebar and this page agree on which region a series belongs to.
 */
export function buildSeries(matches) {
  const byKey = new Map();
  const order = [];

  for (const match of matches || []) {
    const teamA = match?.event_team_a;
    const teamB = match?.event_team_b;
    if (!teamA || !teamB) continue;
    const region = normalizeRegion(match?.event_region);
    const round = String(match?.event_subtitle || "").trim();
    const key = `${region || ""}|${round}|${teamA}|${teamB}`;
    let series = byKey.get(key);
    if (!series) {
      series = {
        region,
        round: round || null,
        teamA,
        teamB,
        scoreA: 0,
        scoreB: 0,
        startTime: match?.start_time || null,
        games: [],
        teams: [teamA, teamB],
      };
      byKey.set(key, series);
      order.push(series);
    }
    if (match?.start_time && (!series.startTime || match.start_time < series.startTime)) {
      series.startTime = match.start_time;
    }
    const winner = matchWinnerSide(match);
    if (winner === "a") series.scoreA += 1;
    if (winner === "b") series.scoreB += 1;
    series.games.push({ match, winner });
  }

  // Infer any blank region from another series in the week that shares a team.
  const knownRegions = new Map();
  for (const series of order) {
    if (!series.region) continue;
    for (const team of series.teams) knownRegions.set(team, series.region);
  }
  for (const series of order) {
    if (series.region) continue;
    series.region = knownRegions.get(series.teamA) || knownRegions.get(series.teamB) || "Other";
  }

  for (const series of order) {
    series.games.sort(compareGames);
    finalizeSeries(series);
  }
  order.sort((left, right) => compareText(left.startTime, right.startTime));
  return order;
}

/** Derive a series' winner from its game tally. */
function finalizeSeries(series) {
  const winner = series.scoreA === series.scoreB ? null : series.scoreA > series.scoreB ? "a" : "b";
  series.winner = winner;
  series.winnerTeam = winner === "a" ? series.teamA : winner === "b" ? series.teamB : null;
  return series;
}

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""));

/** Team names two series have in common. */
const sharedTeams = (left, right) =>
  left.teams.filter((team) => right.teams.includes(team));

function compareGames(left, right) {
  const leftTime = left.match?.start_time || "";
  const rightTime = right.match?.start_time || "";
  if (leftTime !== rightTime) return compareText(leftTime, rightTime);
  return (left.match?.match_id || 0) - (right.match?.match_id || 0);
}

/**
 * Build one bracket per region: the semifinal column plus, when the week has
 * one, the grand final. Series get stable `region-index` keys that double as the
 * `?series=` URL value.
 */
export function buildRegionBrackets(seriesList) {
  const byRegion = new Map();
  for (const series of seriesList || []) {
    if (!byRegion.has(series.region)) byRegion.set(series.region, []);
    byRegion.get(series.region).push(series);
  }

  const regions = [...byRegion.keys()].sort((left, right) => {
    const leftIndex = REGION_ORDER.indexOf(left);
    const rightIndex = REGION_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return compareText(left, right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  const brackets = regions.map((region) => {
    const regionSeries = byRegion.get(region).sort((left, right) =>
      compareText(left.startTime, right.startTime),
    );
    const finals = regionSeries.filter((series) => isFinalRound(series.round));
    let finalSeries = finals.length > 0 ? finals[finals.length - 1] : null;
    let semis = regionSeries.filter((series) => series !== finalSeries);

    /* Stage titles are hand-authored in the feed and are often blank — every NA
       series from week 44 on is untitled in the live database at the time of
       writing. When a region has no titled final but exactly two untitled series
       that share exactly one team, those two are a bracket (the shared team
       advanced) and the later series is the final. Series that carry an explicit
       non-final title are left alone, so authored data always wins. */
    if (!finalSeries && regionSeries.length === 2 && regionSeries.some((series) => !series.round)) {
      const [first, second] = regionSeries;
      if (sharedTeams(first, second).length === 1) {
        finalSeries = second;
        semis = [first];
      }
    }

    const ordered = [...semis, ...(finalSeries ? [finalSeries] : [])];
    ordered.forEach((series, index) => {
      series.key = `${region}-${index}`;
      series.isFinal = series === finalSeries;
    });

    const teams = [];
    for (const series of ordered) {
      for (const team of series.teams) if (!teams.includes(team)) teams.push(team);
    }

    const champ = finalSeries
      ? finalSeries.winnerTeam
      : ordered.length > 0
        ? ordered[ordered.length - 1].winnerTeam
        : null;

    return {
      name: region,
      series: ordered,
      semis,
      final: finalSeries,
      teams,
      champ,
    };
  });

  /* Stage titles are authored per series in the feed, but a week is often titled
     on one side only (every NA series from week 44 on is untitled in the live
     database at the time of writing). Resolve one label per round from whichever
     series do carry a title, so a half-titled week still reads consistently
     instead of showing "Challenger" for EU and a generic name for NA. */
  const weekSeries = brackets.flatMap((bracket) => bracket.series);
  const [semiLabel, finalLabel] = [
    pickRoundTitle(weekSeries.filter((series) => !series.isFinal)) || "Semifinals",
    pickRoundTitle(weekSeries.filter((series) => series.isFinal)) || "Grand Final",
  ];
  for (const series of weekSeries) {
    series.roundLabel = (series.round || "").trim() || (series.isFinal ? finalLabel : semiLabel);
  }

  return brackets;
}

/** The most common authored stage title in a group of series, or null. */
function pickRoundTitle(seriesList) {
  const counts = new Map();
  for (const series of seriesList) {
    const title = (series.round || "").trim();
    if (title) counts.set(title, (counts.get(title) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [title, count] of counts) {
    if (count > bestCount) {
      best = title;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Column labels for the bracket header, taken from the week's authored stage
 * titles (so "Challenger" / "Finals" rather than invented names).
 */
export function roundColumns(brackets) {
  const weekSeries = (brackets || []).flatMap((bracket) => bracket.series);
  return [
    weekSeries.find((series) => !series.isFinal)?.roundLabel || "Semifinals",
    weekSeries.find((series) => series.isFinal)?.roundLabel || "Grand Final",
  ];
}

/**
 * Where each bracket card sits, plus the connector lines between rounds.
 *
 * The 3- and 4-team shapes reproduce the design's hand-tuned geometry exactly;
 * anything else (a week with more than two semifinals, or none) falls back to
 * evenly stacked cards with no connectors, so the card never overflows.
 */
export function bracketLayout(bracket) {
  const CARD_WIDTH = 160;
  const COLUMN_PITCH = 196;
  const ROW_HEIGHT = 25;
  const CARD_HEIGHT = ROW_HEIGHT * 2 + 2;
  const GAP = 24;

  const semiCount = bracket.semis.length;
  const gfRow = (team) =>
    bracket.final && bracket.final.teamB === team ? 1 : 0;

  if (bracket.final && semiCount >= 1 && semiCount <= 2) {
    const two = semiCount === 2;
    const semiY = two ? [0, 76] : [30];
    const gfY = two ? 38 : 0;
    const height = two ? 132 : 86;
    /* Each connector lands on the grand-final row that the advancing team
       actually occupies, rather than assuming the design's team order. */
    const rowY = (row) => (two ? (row === 0 ? 52 : 78) : row === 0 ? 14 : 40);
    const lines = [];
    bracket.semis.forEach((series, index) => {
      const startY = two ? (index === 0 ? 26 : 102) : 57;
      lines.push(...elbow(CARD_WIDTH, startY, COLUMN_PITCH, rowY(gfRow(series.winnerTeam))));
    });
    if (!two) {
      // The team that sat out the semifinal enters on a plain stub.
      const byeTeam = gfRow(bracket.semis[0].winnerTeam) === 0 ? bracket.final.teamB : bracket.final.teamA;
      lines.push({ left: COLUMN_PITCH - 18, top: rowY(gfRow(byeTeam)), width: 18, height: 1 });
    }
    const cards = [
      ...bracket.semis.map((series, index) => ({
        series,
        left: 0,
        top: semiY[index],
      })),
      { series: bracket.final, left: COLUMN_PITCH, top: gfY },
    ];
    return { width: COLUMN_PITCH + CARD_WIDTH, height, cards, lines };
  }

  const cards = bracket.series.map((series, index) => ({
    series,
    left: index < semiCount ? 0 : COLUMN_PITCH,
    top: index < semiCount ? index * (CARD_HEIGHT + GAP) : 0,
  }));
  const semiHeight =
    semiCount > 0 ? semiCount * CARD_HEIGHT + (semiCount - 1) * GAP : CARD_HEIGHT;
  return {
    width: bracket.final ? COLUMN_PITCH + CARD_WIDTH : CARD_WIDTH,
    height: Math.max(86, bracket.final ? semiHeight + 34 : semiHeight),
    cards,
    lines: [],
  };
}

/** Three rectangles forming a right-angled connector from (x1,y1) to (x2,y2). */
function elbow(x1, y1, x2, y2) {
  const margin = 18;
  const midX = x1 + margin;
  return [
    { left: x1, top: y1, width: margin, height: 1 },
    {
      left: midX,
      top: Math.min(y1, y2),
      width: 1,
      height: Math.abs(y2 - y1) + 1,
    },
    { left: midX, top: y2, width: x2 - midX, height: 1 },
  ];
}

/**
 * How far a team got this week: Champion, Runner-up, Semifinal, or null when
 * the team did not play. An unfinaled week reports the last series it played.
 */
export function regionOutcome(bracket, team) {
  if (!bracket || !team) return null;
  const played = bracket.series.some((series) => series.teams.includes(team));
  if (!played) return null;
  if (bracket.champ === team) return "Champion";
  if (bracket.final && bracket.final.teams.includes(team)) return "Runner-up";
  return "Semifinal";
}

/** `{NA: 'Melee Creeps', EU: 'Leviathan'}` for the sidebar rows. */
export function weekChampions(brackets) {
  const champions = {};
  for (const bracket of brackets || []) {
    if (bracket.champ) champions[bracket.name] = bracket.champ;
  }
  return champions;
}

/**
 * Summarize an `/db/nightshift/index` week: its champions and every team's
 * result, which the sidebar needs to tag a filtered team.
 */
export function summarizeIndexWeek(week) {
  const seriesList = [];
  for (const [region, bucket] of Object.entries(week?.regions || {})) {
    for (const entry of bucket?.series || []) {
      seriesList.push(
        finalizeSeries({
          region,
          round: entry.round || null,
          teamA: entry.team_a,
          teamB: entry.team_b,
          scoreA: entry.score_a || 0,
          scoreB: entry.score_b || 0,
          startTime: entry.start_time || null,
          games: [],
          teams: [entry.team_a, entry.team_b],
        }),
      );
    }
  }
  const brackets = buildRegionBrackets(seriesList);

  const results = {};
  for (const bracket of brackets) {
    for (const team of bracket.teams) {
      const outcome = regionOutcome(bracket, team);
      if (outcome) results[team] = { region: bracket.name, result: outcome };
    }
  }
  return {
    week: week?.week,
    date: week?.date || null,
    champions: weekChampions(brackets),
    teamResults: results,
  };
}

/**
 * `?region=` / `?series=` selection. A selected series wins over the region,
 * and a region that matches nothing falls back to the whole week.
 */
export function scopeSeries(seriesList, seriesKey, region) {
  if (seriesKey) {
    const selected = (seriesList || []).find((series) => series.key === seriesKey);
    if (selected) {
      return {
        series: [selected],
        region: selected.region,
        selected,
        scopeLabel: `${selected.teamA} v ${selected.teamB} · ${selected.region} ${roundName(selected)}`,
      };
    }
  }
  if (region && region !== "all") {
    const wanted = String(region).toUpperCase();
    const scoped = (seriesList || []).filter((series) => series.region === wanted);
    if (scoped.length > 0) {
      return {
        series: scoped,
        region: wanted,
        selected: null,
        scopeLabel: regionLabel(wanted),
      };
    }
  }
  return { series: seriesList || [], region: "all", selected: null, scopeLabel: "both regions" };
}

/** Display name for a series' stage, falling back when the feed left it blank. */
export function roundName(series) {
  if (!series) return "Semifinals";
  if (series.roundLabel) return series.roundLabel;
  return isFinalRound(series.round) ? "Grand Final" : "Semifinals";
}

/** Every game in scope, flattened with its series and region context. */
export function scopeGames(scopedSeries) {
  const games = [];
  for (const series of scopedSeries || []) {
    series.games.forEach((game) => {
      games.push({ ...game, series });
    });
  }
  return games;
}

/**
 * Best single-game value per player across the scoped games, highest first.
 * `total` is how many player-games were considered, for "Showing 8 of N".
 */
export function buildLeaderboard(scopedGames, statKey) {
  const stat = WEEK_STATS.find((entry) => entry.key === statKey) || WEEK_STATS[0];
  const best = new Map();
  let total = 0;

  for (const { match } of scopedGames || []) {
    for (const player of match?.players || []) {
      if (!player?.account_id) continue;
      const value = Number(player[stat.column]);
      if (!Number.isFinite(value)) continue;
      total += 1;
      const current = best.get(player.account_id);
      if (!current || value > current.value) {
        best.set(player.account_id, {
          accountId: player.account_id,
          name: player.persona_name || `Player ${player.account_id}`,
          hero: player.hero_name || "",
          value,
          matchId: match.match_id,
          durationS: match.duration_s,
          side: player.team,
        });
      }
    }
  }

  const rows = [...best.values()].sort((left, right) => {
    if (right.value !== left.value) return right.value - left.value;
    return compareText(left.name, right.name);
  });

  return {
    stat,
    total,
    rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

/**
 * Hero picks across the scoped games: one dot per game, green when the picking
 * side won and grey when it lost. Bans are only counted when the data has any.
 */
export function buildHeroPicks(scopedGames, mode = "picks") {
  const counts = new Map();
  const ensure = (hero) => {
    if (!counts.has(hero)) counts.set(hero, { hero, won: 0, lost: 0, banned: 0 });
    return counts.get(hero);
  };

  for (const { match } of scopedGames || []) {
    const decided = match?.winning_team === 0 || match?.winning_team === 1;
    if (decided) {
      for (const player of match.players || []) {
        const hero = player?.hero_name;
        if (!hero) continue;
        const entry = ensure(hero);
        if (player.team === match.winning_team) entry.won += 1;
        else entry.lost += 1;
      }
    }
    // Bans are independent of the result, so they count even without a winner.
    for (const ban of match?.bans || []) {
      const hero = ban?.hero_name;
      if (hero) ensure(hero).banned += 1;
    }
  }

  /* Bans are only present for some events. When a scope has none, a stale
     "bans" selection must not render an all-zero board, so fall back to picks. */
  const entries = [...counts.values()];
  const anyBans = entries.some((entry) => entry.banned > 0);
  const effectiveMode = mode === "bans" && !anyBans ? "picks" : mode;

  const value = (entry) => {
    if (effectiveMode === "bans") return entry.banned;
    if (effectiveMode === "picks") return entry.won + entry.lost;
    return entry.won + entry.lost + entry.banned;
  };

  const rows = entries.map((entry) => ({ ...entry, count: value(entry) }));
  const highest = Math.max(...rows.map((row) => row.count), 0);

  const board = [];
  for (let count = highest; count >= 0; count -= 1) {
    const heroRows = rows.filter((row) => row.count === count);
    if (heroRows.length === 0) continue;
    heroRows.sort((left, right) => {
      const leftPicks = left.won + left.lost;
      const rightPicks = right.won + right.lost;
      if (rightPicks !== leftPicks) return rightPicks - leftPicks;
      return compareText(left.hero, right.hero);
    });
    board.push({ count, heroes: heroRows });
  }

  const totalGames = (scopedGames || []).length;
  return { board, totalGames, anyBans };
}
