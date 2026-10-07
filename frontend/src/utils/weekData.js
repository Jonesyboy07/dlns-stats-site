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

/** Slot marker `brackets.json` uses for a team that has not been decided yet. */
const BYE = "BYE";

/**
 * Which in-game side the event's team A played on. Missing sides read as Amber,
 * matching the ingester, which leaves the column null when it could not decide.
 */
const resolveSideA = (match) => {
  const sideA = match?.event_team_a_ingame_side;
  return sideA === 0 || sideA === 1 ? sideA : 0;
};

/** Which side won a single match: 'a', 'b', or null when undecided. */
export function matchWinnerSide(match) {
  const winning = match?.winning_team;
  if (winning !== 0 && winning !== 1) return null;
  return winning === resolveSideA(match) ? "a" : "b";
}

/** The event team a given in-game side belonged to, e.g. "Melee Creeps". */
export function teamForSide(match, side) {
  if (side !== 0 && side !== 1) return null;
  const isTeamA = side === resolveSideA(match);
  return (isTeamA ? match?.event_team_a : match?.event_team_b) || null;
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

/** NA before EU, then anything else alphabetically. */
const compareRegions = (left, right) => {  const leftIndex = REGION_ORDER.indexOf(left);
  const rightIndex = REGION_ORDER.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) return compareText(left, right);
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
};

/** Team names two series have in common. */
const sharedTeams = (left, right) =>
  left.teams.filter((team) => right.teams.includes(team));

function compareGames(left, right) {
  const leftTime = left.match?.start_time || "";
  const rightTime = right.match?.start_time || "";
  if (leftTime !== rightTime) return compareText(leftTime, rightTime);
  return (left.match?.match_id || 0) - (right.match?.match_id || 0);
}

/** A hero's appearances, in the order the games were played. */
const compareHeroGames = (left, right) =>
  (left.matchId || 0) - (right.matchId || 0) || (left.gameNo || 0) - (right.gameNo || 0);

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

  const regions = [...byRegion.keys()].sort(compareRegions);

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

  /* Give the derived brackets the same shape as an authored one, so the layout
     and the header only ever deal with rounds. */
  for (const bracket of brackets) {
    bracket.rounds = [
      { name: semiLabel, bestOf: null, series: bracket.semis },
      ...(bracket.final ? [{ name: finalLabel, bestOf: null, series: [bracket.final] }] : []),
    ].filter((round) => round.series.length > 0);
  }

  return brackets;
}

/**
 * Build one bracket per region for the week page.
 *
 * `authored` is the `brackets` array from `/db/nightshift/<week>`: the week's
 * events from `data/brackets.json`, already scored and advanced by the bracket
 * builder. That file is the source of truth for how many rounds an event has and
 * which series feed which, so with it the page shows the rounds an admin
 * authored instead of inferring a semifinal/final split from feed titles.
 *
 * Without it — a database with no `brackets.json` beside it, or a week the file
 * does not cover — the bracket is derived from the match rows as before.
 */
export function buildBrackets(matches, authored) {
  const events = (authored || []).filter((event) => (event?.series || []).length > 0);
  if (events.length === 0) return buildRegionBrackets(buildSeries(matches));

  const byMatchId = new Map();
  for (const match of matches || []) {
    const id = Number(match?.match_id);
    if (Number.isFinite(id)) byMatchId.set(id, match);
  }

  return events
    .map((event) => authoredBracket(event, byMatchId))
    .filter((bracket) => bracket.series.length > 0)
    .sort((left, right) => compareRegions(left.name, right.name));
}

/** One region's bracket from one event of `data/brackets.json`. */
function authoredBracket(event, byMatchId) {
  const region = normalizeRegion(event?.region) || "Other";
  const authoredRounds = [...(event?.rounds || [])].sort(
    (left, right) => (left?.round ?? 0) - (right?.round ?? 0),
  );
  const lastRound = authoredRounds.length > 0 ? authoredRounds[authoredRounds.length - 1]?.round : null;

  const rounds = authoredRounds
    .map((round) => ({
      name: String(round?.name || "").trim() || `Round ${round?.round ?? ""}`.trim(),
      bestOf: round?.best_of ?? null,
      series: (event?.series || [])
        .filter((entry) => entry?.round === round?.round)
        .map((entry) =>
          authoredSeries(entry, region, round, round?.round === lastRound, byMatchId),
        ),
    }))
    .filter((round) => round.series.length > 0);

  const series = rounds.flatMap((round) => round.series);
  series.forEach((entry, index) => {
    entry.key = `${region}-${index}`;
  });

  const teams = [];
  for (const entry of series) {
    for (const team of entry.teams) if (!teams.includes(team)) teams.push(team);
  }

  /* A gauntlet's champion is the winner of its last round's only series, which is
     the series `regionOutcome` treats as the final. A final still waiting on a
     feeder has no winner, and stays null. */
  const last = rounds[rounds.length - 1];
  const finalSeries = last && last.series.length === 1 ? last.series[0] : null;
  const champ = finalSeries
    ? finalSeries.winnerTeam
    : series.length > 0
      ? series[series.length - 1].winnerTeam
      : null;

  return { name: region, rounds, series, final: finalSeries, teams, champ, authored: true };
}

/**
 * One series of an authored bracket, joined to the week's ingested match rows so
 * the games carry durations, players and bans. A bracket game whose match has not
 * been ingested yet keeps a stub so the card still counts it.
 */
function authoredSeries(entry, region, round, isFinal, byMatchId) {
  const games = (entry?.games || []).map((game, index) => {
    const matchId = Number(game?.match_id);
    const match = byMatchId.get(matchId) || { match_id: matchId };
    return {
      match,
      gameNo: game?.game ?? index + 1,
      winner:
        game?.winner === "team_a"
          ? "a"
          : game?.winner === "team_b"
            ? "b"
            : matchWinnerSide(match),
    };
  });
  /* The authored order is authoritative: a game whose match has not been
     ingested yet has no start time, and would otherwise sort to the front. */
  games.sort((left, right) => left.gameNo - right.gameNo);

  const teamA = entry?.team_a || null;
  const teamB = entry?.team_b || null;
  const winner = entry?.winner === "team_a" ? "a" : entry?.winner === "team_b" ? "b" : null;

  return {
    key: null,
    id: entry?.id || null,
    region,
    round: round?.name || null,
    roundLabel: String(round?.name || "").trim() || null,
    isFinal,
    bestOf: entry?.best_of ?? round?.best_of ?? null,
    status: entry?.status || null,
    vod: entry?.vod || null,
    winnerTo: entry?.winner_to || null,
    teamA,
    teamB,
    teams: [teamA, teamB].filter((team) => team && team !== BYE),
    scoreA: Number(entry?.score_a) || 0,
    scoreB: Number(entry?.score_b) || 0,
    winner,
    winnerTeam: entry?.winner_name || (winner === "a" ? teamA : winner === "b" ? teamB : null),
    startTime: games.reduce((earliest, game) => {
      const time = game.match?.start_time || null;
      if (!time) return earliest;
      return !earliest || time < earliest ? time : earliest;
    }, null),
    games,
  };
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
 * Column labels for the bracket header, one per round, taken from the authored
 * stage names (`brackets.json`) so a week reads "Challenger" / "Finals" rather
 * than invented labels. A round left blank in one region borrows the name the
 * other region authored.
 */
export function roundColumns(brackets) {
  const list = brackets || [];
  const depth = list.reduce((max, bracket) => Math.max(max, (bracket.rounds || []).length), 0);
  const columns = [];
  for (let index = 0; index < depth; index += 1) {
    const named = mostCommon(list.map((bracket) => (bracket.rounds?.[index]?.name || "").trim()));
    columns.push(
      named ||
        (index === depth - 1 ? "Grand Final" : index === 0 ? "Semifinals" : `Round ${index + 1}`),
    );
  }
  return columns;
}

/** The most repeated non-blank value, or null. */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Where each bracket card sits, plus the connector lines between rounds.
 *
 * Design 13a's hand-tuned geometry is reproduced exactly for the two shapes it
 * draws — 3-team (semifinal + grand final) and 4-team (two semifinals + grand
 * final). Anything else, such as an authored gauntlet that runs three rounds,
 * falls back to a generic layout: one column per round, the first stacked
 * top-down and each later round centred on the round that feeds it.
 */
export function bracketLayout(bracket) {
  const CARD_WIDTH = 160;
  const COLUMN_PITCH = 196;
  const ROW_HEIGHT = 25;
  const CARD_HEIGHT = ROW_HEIGHT * 2 + 2;
  const GAP = 24;

  const rounds = (bracket?.rounds || []).filter((round) => (round.series || []).length > 0);
  if (rounds.length === 0) {
    return { width: CARD_WIDTH, height: CARD_HEIGHT, cards: [], lines: [] };
  }

  const cards = [];
  const centres = new Map();
  const firstRound = rounds[0].series;
  const lastRound = rounds[rounds.length - 1].series;

  if (rounds.length === 2 && firstRound.length <= 2 && lastRound.length === 1) {
    const two = firstRound.length === 2;
    const semiY = two ? [0, 76] : [30];
    const finalY = two ? 38 : 0;
    firstRound.forEach((series, index) => {
      cards.push({ series, left: 0, top: semiY[index] });
    });
    cards.push({ series: lastRound[0], left: COLUMN_PITCH, top: finalY });
    cards.forEach((card) => centres.set(card.series, card.top + CARD_HEIGHT / 2));

    const lines = connectors(rounds, cards, centres, CARD_WIDTH, COLUMN_PITCH);
    if (!two) {
      /* The team that sat out the semifinal enters the grand final on a stub, on
         whichever row the semifinal's winner does not take. */
      const wonRow = advanceRow(firstRound[0], lastRound[0]);
      lines.push({
        left: COLUMN_PITCH - 18,
        top: finalY + (wonRow === 0 ? 40 : 14),
        width: 18,
        height: 1,
      });
    }
    return { width: COLUMN_PITCH + CARD_WIDTH, height: two ? 132 : 86, cards, lines };
  }

  rounds.forEach((round, roundIndex) => {
    round.series.forEach((series, index) => {
      let top;
      if (roundIndex === 0) {
        top = index * (CARD_HEIGHT + GAP);
      } else {
        const feeders = rounds[roundIndex - 1].series.filter(
          (feeder) => feeder.winnerTo?.series === series.id,
        );
        const pool = feeders.length > 0 ? feeders : rounds[roundIndex - 1].series;
        const centres_ = pool.map((feeder) => centres.get(feeder)).filter((value) => value !== undefined);
        top =
          centres_.length > 0
            ? centres_.reduce((total, value) => total + value, 0) / centres_.length - CARD_HEIGHT / 2
            : index * (CARD_HEIGHT + GAP);
      }
      cards.push({ series, left: roundIndex * COLUMN_PITCH, top });
      centres.set(series, top + CARD_HEIGHT / 2);
    });
  });

  const stacked = firstRound.length;
  return {
    width: rounds.length * CARD_WIDTH + (rounds.length - 1) * (COLUMN_PITCH - CARD_WIDTH),
    height: Math.max(
      86,
      CARD_HEIGHT,
      ...cards.map((card) => card.top + CARD_HEIGHT),
      stacked > 0 ? stacked * CARD_HEIGHT + (stacked - 1) * GAP : CARD_HEIGHT,
    ),
    cards,
    lines: connectors(rounds, cards, centres, CARD_WIDTH, COLUMN_PITCH),
  };
}

/** Right-angled connectors from every card into the round it feeds. */
function connectors(rounds, cards, centres, cardWidth, pitch) {
  const topOf = new Map(cards.map((card) => [card.series, card.top]));
  const lines = [];
  rounds.forEach((round, roundIndex) => {
    if (roundIndex === 0) return;
    const previous = rounds[roundIndex - 1].series;
    for (const series of round.series) {
      const targetTop = topOf.get(series);
      const feeders = previous.filter((feeder) => feeder.winnerTo?.series === series.id);
      for (const feeder of feeders.length > 0 ? feeders : previous) {
        lines.push(
          ...elbow(
            cardWidth + (roundIndex - 1) * pitch,
            centres.get(feeder),
            roundIndex * pitch,
            targetTop + (advanceRow(feeder, series) === 0 ? 14 : 40),
          ),
        );
      }
    }
  });
  return lines;
}

/**
 * Which of a card's two rows the advancing team takes: 0 (team A) or 1 (team B).
 *
 * Where the team actually sits wins over the authored `winner_to` hint, because
 * the hint only ever fills a slot that is still empty — a bracket whose target
 * teams are both named puts the winner wherever it was authored, regardless of
 * which slot the link names. The hint is the fallback for a team still to come.
 */
function advanceRow(feeder, target) {
  if (!target || !feeder?.winnerTeam) return 0;
  if (target.teamA === feeder.winnerTeam) return 0;
  if (target.teamB === feeder.winnerTeam) return 1;
  const link = feeder.winnerTo;
  if (link && link.series === target.id && link.slot) return link.slot === "team_b" ? 1 : 0;
  return 0;
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
    (series.games || []).forEach((game, index) => {
      games.push({ ...game, gameNo: game.gameNo ?? index + 1, series });
    });
  }
  return games;
}

/**
 * The chip text for a week's announcement. The title is used as-is — the feed's
 * titles are already human-readable ("City Never Sleeps", "Minor Update -
 * 10-05-2026") and some carry their own date, so prefixing another would repeat
 * it. The posted date lives in the tooltip.
 */
export function newsLabel(entry) {
  if (!entry) return null;
  const title = String(entry.title || "").trim();
  if (title) return title;
  return formatShortDate(entry.published_at) || null;
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
          team: teamForSide(match, player.team),
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
 *
 * Every hero also carries the games it appeared in, which the board shows on
 * hover so a dot can be traced back to the match behind it.
 */
export function buildHeroPicks(scopedGames, mode = "picks") {
  const counts = new Map();
  const ensure = (hero) => {
    if (!counts.has(hero)) counts.set(hero, { hero, won: 0, lost: 0, banned: 0, games: [] });
    return counts.get(hero);
  };
  const record = (entry, game, match, outcome) => {
    entry.games.push({
      matchId: match?.match_id ?? null,
      durationS: match?.duration_s ?? null,
      outcome,
      round: game.series ? roundName(game.series) : null,
      region: game.series?.region || null,
      gameNo: game.gameNo ?? null,
    });
  };

  for (const game of scopedGames || []) {
    const { match } = game;
    const decided = match?.winning_team === 0 || match?.winning_team === 1;
    if (decided) {
      for (const player of match.players || []) {
        const hero = player?.hero_name;
        if (!hero) continue;
        const entry = ensure(hero);
        if (player.team === match.winning_team) {
          entry.won += 1;
          record(entry, game, match, "won");
        } else {
          entry.lost += 1;
          record(entry, game, match, "lost");
        }
      }
    }
    // Bans are independent of the result, so they count even without a winner.
    for (const ban of match?.bans || []) {
      const hero = ban?.hero_name;
      if (hero) {
        const entry = ensure(hero);
        entry.banned += 1;
        record(entry, game, match, "banned");
      }
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

  const rows = entries.map((entry) => ({
    ...entry,
    games: [...entry.games].sort(compareHeroGames),
    count: value(entry),
  }));
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
