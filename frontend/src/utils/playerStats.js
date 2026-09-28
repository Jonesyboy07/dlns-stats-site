/**
 * Pure derivations for the player pages (PlayerDetail, Player × Hero).
 *
 * Input is a row from `/db/users/:id/matches` — a `players` row joined to its
 * `matches` row, newest first. Everything here is side-effect free and unit
 * tested in `playerStats.test.js`, so the pages stay presentational.
 */

export const WIN = "W";
export const LOSS = "L";
/**
 * No result can be derived. The league really does hold matches with no
 * `event_team_a_ingame_side` (the whole Night Shift Open 1 qualifier), so this
 * is a first-class state — it counts toward games but never toward W–L.
 */
export const UNKNOWN = "U";

/** In-game sides. `players.team` and `matches.winning_team` share the encoding. */
export const AMBER = 0;
export const SAPPHIRE = 1;

/** Heroes under this many decided games are excluded from best/worst callouts. */
export const MIN_HERO_GAMES = 3;

export const OUTCOME_LABEL = {
  [WIN]: "Win",
  [LOSS]: "Loss",
  [UNKNOWN]: "Unknown",
};

const isSide = (value) => value === AMBER || value === SAPPHIRE;

/**
 * The team the player turned out for, or null when the match has no side data
 * (without it there is no way to tell which of the two teams they played for).
 */
export function teamForMatch(match) {
  const side = match?.team;
  const eventSide = match?.event_team_a_ingame_side;
  if (!isSide(side) || !isSide(eventSide)) return null;
  return side === eventSide ? match.event_team_a : match.event_team_b;
}

/**
 * "W" | "L" | "U". Derived from the player's side and the winning side whenever
 * both are known; `players.result` is only a fallback, because a side-less match
 * must stay unknown rather than defaulting to a win.
 */
export function matchOutcome(match) {
  const side = match?.team;
  const winner = match?.winning_team;
  if (isSide(side) && isSide(winner)) return side === winner ? WIN : LOSS;
  if (match?.result === "Win") return WIN;
  if (match?.result === "Loss") return LOSS;
  return UNKNOWN;
}

/** Compact "NS 57 · Game 1" label for a match. */
export function matchLabel(match) {
  const week = match?.event_week != null ? `NS ${match.event_week}` : "Preseason";
  return match?.event_game ? `${week} · ${match.event_game}` : week;
}

/** Games / W–L / unknown. Unknown games are excluded from the win rate. */
export function summarise(matches = []) {
  let wins = 0;
  let losses = 0;
  let unknown = 0;
  for (const match of matches) {
    const outcome = matchOutcome(match);
    if (outcome === WIN) wins += 1;
    else if (outcome === LOSS) losses += 1;
    else unknown += 1;
  }
  const decided = wins + losses;
  return {
    games: matches.length,
    wins,
    losses,
    unknown,
    decided,
    winRate: decided > 0 ? wins / decided : null,
  };
}

/**
 * The last `size` games, OLDEST first, for the form strip. Short histories pad
 * with null slots on the left so the newest game always sits at the right edge.
 */
export function formStrip(matches = [], size = 10) {
  const recent = matches.slice(0, size).reverse();
  const slots = recent.map((match) => ({
    outcome: matchOutcome(match),
    title: `${matchLabel(match)} · ${match.hero_name || `Hero ${match.hero_id}`} · ${
      OUTCOME_LABEL[matchOutcome(match)]
    }`,
  }));
  const padded = Array(Math.max(0, size - slots.length))
    .fill(null)
    .concat(slots);
  const { wins, losses, unknown } = summarise(recent);
  const parts = [`${wins} W`, `${losses} L`];
  if (unknown > 0) parts.push(`${unknown} unknown`);
  return { slots: padded, wins, losses, unknown, played: recent.length, summary: parts.join(" · ") };
}

/**
 * Only the number that decided a W–L pair is coloured: the larger side (green
 * when the wins lead, red when the losses do). The smaller one goes dim, and a
 * tie keeps both neutral. Tones are mapped to classes by `ScoreChip`.
 */
export function decisiveScore(wins = 0, losses = 0) {
  if (wins === losses) return { winsTone: "tie", lossesTone: "tie" };
  return wins > losses
    ? { winsTone: "win", lossesTone: "neutral" }
    : { winsTone: "neutral", lossesTone: "loss" };
}

/** (K + A) / max(D, 1) — the site-wide KDA formula. */
export function kda({ kills = 0, deaths = 0, assists = 0 } = {}) {
  return (kills + assists) / Math.max(deaths, 1);
}

/** Value per minute of game time, or null when either input is unusable. */
export function perMinute(value, durationS) {
  if (value == null || durationS == null || durationS <= 0) return null;
  return (value * 60) / durationS;
}

/**
 * Per-hero aggregate, sorted by games. Souls and damage per minute come from
 * `net_worth` / `player_damage` and are null for the oldest games (no snapshot
 * data), so they are averaged over the games that have them.
 *
 * KDA is the MEAN OF PER-GAME KDA (not the ratio of the totals), which is the
 * same formula as the headline tile and the team page — a 10/0/0 game must not
 * be diluted by a 0/10/0 one.
 */
export function heroPool(matches = []) {
  const byHero = new Map();
  for (const match of matches) {
    const id = match?.hero_id;
    if (id == null) continue;
    if (!byHero.has(id)) {
      byHero.set(id, {
        hero_id: id,
        hero_name: match.hero_name || `Hero ${id}`,
        games: 0,
        wins: 0,
        losses: 0,
        unknown: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        _kdaSum: 0,
        _soulsPerMin: 0,
        _soulsGames: 0,
        _damagePerMin: 0,
        _damageGames: 0,
      });
    }
    const hero = byHero.get(id);
    hero.games += 1;
    const outcome = matchOutcome(match);
    if (outcome === WIN) hero.wins += 1;
    else if (outcome === LOSS) hero.losses += 1;
    else hero.unknown += 1;
    hero.kills += match.kills || 0;
    hero.deaths += match.deaths || 0;
    hero.assists += match.assists || 0;
    hero._kdaSum += kda(match);
    const souls = perMinute(match.net_worth, match.duration_s);
    if (souls != null) {
      hero._soulsPerMin += souls;
      hero._soulsGames += 1;
    }
    const damage = perMinute(match.player_damage, match.duration_s);
    if (damage != null) {
      hero._damagePerMin += damage;
      hero._damageGames += 1;
    }
  }

  return [...byHero.values()]
    .map((hero) => {
      const decided = hero.wins + hero.losses;
      const {
        _kdaSum,
        _soulsPerMin,
        _soulsGames,
        _damagePerMin,
        _damageGames,
        ...rest
      } = hero;
      return {
        ...rest,
        decided,
        winRate: decided > 0 ? hero.wins / decided : null,
        kda: hero.games > 0 ? _kdaSum / hero.games : null,
        killsPerGame: hero.games ? hero.kills / hero.games : null,
        deathsPerGame: hero.games ? hero.deaths / hero.games : null,
        assistsPerGame: hero.games ? hero.assists / hero.games : null,
        soulsPerMin: _soulsGames > 0 ? _soulsPerMin / _soulsGames : null,
        damagePerMin: _damageGames > 0 ? _damagePerMin / _damageGames : null,
      };
    })
    .sort((a, b) => b.games - a.games || a.hero_name.localeCompare(b.hero_name));
}

/** Top-N heroes vs everyone else, as shares of total games played. */
export function pickShare(pool = [], topN = 3) {
  const totalGames = pool.reduce((sum, hero) => sum + hero.games, 0);
  const top = pool.slice(0, topN);
  const rest = pool.slice(topN);
  const topGames = top.reduce((sum, hero) => sum + hero.games, 0);
  const share = (games) => (totalGames > 0 ? games / totalGames : 0);
  return {
    totalGames,
    top: top.map((hero) => ({ ...hero, share: share(hero.games) })),
    others: {
      count: rest.length,
      games: totalGames - topGames,
      share: share(totalGames - topGames),
    },
    topShare: share(topGames),
  };
}

/**
 * Most played / best / worst win rate. Only heroes with at least `minGames`
 * decided games qualify for the ratings, so a single lucky win cannot be
 * presented as the player's best hero.
 */
export function poolCallouts(pool = [], minGames = MIN_HERO_GAMES) {
  const rated = pool.filter((hero) => hero.decided >= minGames && hero.winRate != null);
  return {
    minGames,
    mostPlayed: pool[0] ?? null,
    best: rated.length ? rated.reduce((a, b) => (b.winRate > a.winRate ? b : a)) : null,
    worst: rated.length ? rated.reduce((a, b) => (b.winRate < a.winRate ? b : a)) : null,
    ratedCount: rated.length,
    hasRated: rated.length > 0,
  };
}

/**
 * Teams the player appears for (games desc), plus the span of weeks they played
 * and the team of their most recent match. Side-less matches still name a team
 * when `event_team_a_ingame_side` exists; they only lack a result.
 */
export function playedTeams(matches = []) {
  const byTeam = new Map();
  for (const match of matches) {
    const name = teamForMatch(match);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byTeam.has(key)) byTeam.set(key, { team: name, games: 0, weeks: new Set() });
    const entry = byTeam.get(key);
    entry.games += 1;
    if (match.event_week != null) entry.weeks.add(match.event_week);
  }
  const teams = [...byTeam.values()]
    .map((entry) => ({
      team: entry.team,
      games: entry.games,
      weeks: [...entry.weeks].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));

  const weeks = matches.map((match) => match.event_week).filter((week) => week != null);
  const newest = matches.find((match) => teamForMatch(match));
  const current = newest ? teamForMatch(newest) : null;

  return {
    teams,
    current,
    teamCount: teams.length,
    firstWeek: weeks.length ? Math.min(...weeks) : null,
    lastWeek: weeks.length ? Math.max(...weeks) : null,
  };
}

/**
 * The six headline tile values. Averages skip rows where the stat is missing, so
 * a player whose oldest games have no snapshot data gets null (rendered "—")
 * instead of a misleading zero.
 */
export function headlineStats(matches = []) {
  const mean = (values) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const souls = matches.map((match) => match.net_worth).filter((value) => value != null);
  const damage = matches.map((match) => match.player_damage).filter((value) => value != null);
  const kdas = matches
    .filter((match) => match.kills != null || match.deaths != null)
    .map((match) => kda(match));

  return {
    ...summarise(matches),
    kda: mean(kdas),
    soulsPerGame: mean(souls),
    damagePerGame: mean(damage),
    soulsGames: souls.length,
    damageGames: damage.length,
  };
}

/**
 * Change against a league baseline, as the DeltaBadge renders it.
 *   unit "pct" — percentage change ("+12%"), for per-game averages
 *   unit "pts" — percentage points ("+15.2 pts"), for win rates
 * `invert` flips what counts as better (deaths, deaths/min). Anything within
 * ±2% reads as flat ("≈"). Returns `{ kind: "none" }` when there is no baseline.
 */
export function delta(value, baseline, { unit = "pct", invert = false, flatBand = 0.02 } = {}) {
  if (value == null || baseline == null) return { kind: "none" };

  if (unit === "pts") {
    const points = (value - baseline) * 100;
    const flat = Math.abs(points) <= flatBand * 100;
    return {
      kind: flat ? "flat" : (invert ? points < 0 : points > 0) ? "better" : "worse",
      label: flat ? "≈" : `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`,
      points,
    };
  }

  if (baseline === 0) return { kind: "none" };
  const ratio = (value - baseline) / baseline;
  const flat = Math.abs(ratio) <= flatBand;
  return {
    kind: flat ? "flat" : (invert ? ratio < 0 : ratio > 0) ? "better" : "worse",
    label: flat ? "≈" : `${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%`,
    ratio,
  };
}

/**
 * The other team in the match, or null when the player's own team cannot be
 * resolved. Team names are hand-authored with mixed casing, so this compares
 * against the exact strings the row carries.
 */
export function opponentForMatch(match) {
  const mine = teamForMatch(match);
  if (!mine) return null;
  return mine === match.event_team_a ? match.event_team_b : match.event_team_a;
}

/** The player's most recent `count` games on one hero (input is newest-first). */
export function lastNOn(matches = [], heroId, count = 5) {
  if (heroId == null) return [];
  return matches.filter((match) => match.hero_id === heroId).slice(0, count);
}

/** The Night Shift Open qualifier is the one event that is not a league game. */
export const NON_LEAGUE_EVENT = "Night Shift Open 1";

/**
 * League games only. A best-of over a qualifier bracket is not comparable to a
 * Night Shift week, so Personal Bests leaves those matches out — the same rule
 * the team endpoints apply in SQL.
 */
export function leagueGames(matches = []) {
  return matches.filter((match) => match?.event_title !== NON_LEAGUE_EVENT);
}

/**
 * The longest run of consecutive wins, as the matches that made it (oldest
 * first). Input is newest-first. A game with no decidable result breaks the run:
 * it cannot count as a win, and it did happen between the wins around it.
 */
export function longestWinStreak(matches = []) {
  let best = [];
  let run = [];
  for (const match of [...matches].reverse()) {
    if (matchOutcome(match) === WIN) {
      run = [...run, match];
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  return best;
}

/**
 * The single best game for one per-game record, or null when no game carries the
 * stat. Ties keep the most recent game (the input is newest-first).
 */
function bestGame(matches, read, better) {
  let winner = null;
  let value = null;
  for (const match of matches) {
    const candidate = read(match);
    if (candidate == null || Number.isNaN(candidate)) continue;
    if (value == null || better(candidate, value)) {
      winner = match;
      value = candidate;
    }
  }
  return winner ? { match: winner, value } : null;
}

/** A row with none of the three stats is not a 0/0/0 game, it is a missing one. */
const hasKdaStats = (match) =>
  match?.kills != null || match?.deaths != null || match?.assists != null;

/**
 * The Personal Bests tiles: one best game per record, each carrying the match it
 * happened in so the tile can link to it. A record with no data at all is left
 * out rather than rendered as a dash, so an empty list means "nothing to show".
 */
export function personalBests(matches = []) {
  const games = leagueGames(matches);
  const kdaBest = bestGame(games.filter(hasKdaStats), kda, (a, b) => a > b);
  const soulsBest = bestGame(games, (match) => match.net_worth, (a, b) => a > b);
  const damageBest = bestGame(games, (match) => match.player_damage, (a, b) => a > b);
  const longestWin = bestGame(
    games.filter((match) => matchOutcome(match) === WIN),
    (match) => match.duration_s,
    (a, b) => a > b,
  );
  const streak = longestWinStreak(games);

  return {
    games: games.length,
    records: [
      kdaBest && { id: "kda", ...kdaBest },
      soulsBest && { id: "souls", ...soulsBest },
      damageBest && { id: "damage", ...damageBest },
      longestWin && { id: "longestWin", ...longestWin },
      streak.length > 0 && {
        id: "streak",
        value: streak.length,
        match: streak[0],
        from: streak[0],
        to: streak[streak.length - 1],
      },
    ].filter(Boolean),
  };
}

/** Sort keys the hero pool table exposes. Unknown keys fall back to games. */
const POOL_SORT_KEYS = {
  games: (hero) => hero.games,
  record: (hero) => hero.wins,
  winRate: (hero) => hero.winRate,
  kda: (hero) => hero.kda,
  soulsPerMin: (hero) => hero.soulsPerMin,
  damagePerMin: (hero) => hero.damagePerMin,
};

export const POOL_SORT_KEY_NAMES = Object.keys(POOL_SORT_KEYS);

/**
 * Sort a hero pool by one of POOL_SORT_KEYS. Heroes missing the stat always sink
 * to the bottom (a hero with no snapshot data should never lead a souls sort),
 * and ties fall back to the hero name so the order is stable.
 */
export function sortPool(pool = [], key = "games", direction = "desc") {
  const read = POOL_SORT_KEYS[key] ?? POOL_SORT_KEYS.games;
  const sign = direction === "asc" ? 1 : -1;
  return [...pool].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (left == null && right == null) return a.hero_name.localeCompare(b.hero_name);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left === right) return a.hero_name.localeCompare(b.hero_name);
    return (left - right) * sign;
  });
}
