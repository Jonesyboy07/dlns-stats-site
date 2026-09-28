import { describe, expect, it } from "vitest";
import {
  AMBER,
  LOSS,
  MIN_HERO_GAMES,
  SAPPHIRE,
  UNKNOWN,
  WIN,
  decisiveScore,
  delta,
  formStrip,
  headlineStats,
  heroPool,
  kda,
  lastNOn,
  leagueGames,
  longestWinStreak,
  matchLabel,
  matchOutcome,
  opponentForMatch,
  perMinute,
  personalBests,
  pickShare,
  playedTeams,
  poolCallouts,
  sortPool,
  summarise,
  teamForMatch,
} from "./playerStats";

/** A well-formed match row, newest-first order is the caller's business. */
const match = (overrides = {}) => ({
  match_id: 1,
  team: AMBER,
  winning_team: AMBER,
  result: "Win",
  hero_id: 50,
  hero_name: "Pocket",
  kills: 4,
  deaths: 2,
  assists: 10,
  net_worth: 30000,
  player_damage: 25000,
  duration_s: 1800,
  event_week: 57,
  event_game: "Game 1",
  event_team_a: "Poppers' Pupils",
  event_team_b: "Melee Creeps",
  event_team_a_ingame_side: 0,
  ...overrides,
});

describe("matchOutcome", () => {
  it("derives the result from the player's side and the winning side", () => {
    expect(matchOutcome(match({ team: AMBER, winning_team: AMBER }))).toBe(WIN);
    expect(matchOutcome(match({ team: SAPPHIRE, winning_team: AMBER }))).toBe(LOSS);
    expect(matchOutcome(match({ team: SAPPHIRE, winning_team: SAPPHIRE }))).toBe(WIN);
  });

  it("prefers the derived result over a stored one", () => {
    expect(matchOutcome(match({ team: AMBER, winning_team: SAPPHIRE, result: "Win" }))).toBe(LOSS);
  });

  it("falls back to the stored result when the winner is missing", () => {
    expect(matchOutcome(match({ winning_team: null, result: "Win" }))).toBe(WIN);
    expect(matchOutcome(match({ winning_team: null, result: "Loss" }))).toBe(LOSS);
  });

  it("is unknown when no side data exists, never a default win", () => {
    expect(matchOutcome(match({ team: null, winning_team: null, result: null }))).toBe(UNKNOWN);
    expect(matchOutcome(match({ team: null, winning_team: null, result: null }))).toBe(UNKNOWN);
    expect(matchOutcome(match({}))).not.toBe(undefined);
    expect(matchOutcome(undefined)).toBe(UNKNOWN);
  });

  it("keeps the stored result for side-less matches (the Open 1 qualifier)", () => {
    // Those games have no `event_team_a_ingame_side`, so they have no team name,
    // but the player's own result is still recorded and must not be thrown away.
    const sideLess = match({ team: null, winning_team: null, result: "Loss" });
    expect(matchOutcome(sideLess)).toBe(LOSS);
    expect(teamForMatch(sideLess)).toBeNull();
  });
});

describe("summarise", () => {
  it("counts games, W-L and unknown separately", () => {
    const rows = [
      match({ team: AMBER, winning_team: AMBER }),
      match({ team: AMBER, winning_team: SAPPHIRE }),
      match({ team: null, winning_team: null, result: null }),
    ];
    expect(summarise(rows)).toEqual({
      games: 3,
      wins: 1,
      losses: 1,
      unknown: 1,
      decided: 2,
      winRate: 0.5,
    });
  });

  it("excludes unknown games from the win rate", () => {
    const rows = [
      match({ team: AMBER, winning_team: AMBER }),
      match({ team: AMBER, winning_team: AMBER }),
      match({ team: null, winning_team: null, result: null }),
      match({ team: null, winning_team: null, result: null }),
    ];
    const summary = summarise(rows);
    expect(summary.games).toBe(4);
    expect(summary.winRate).toBe(1);
  });

  it("reports a null win rate when nothing was decided", () => {
    expect(summarise([match({ team: null, winning_team: null, result: null })]).winRate).toBeNull();
    expect(summarise([]).winRate).toBeNull();
  });
});

describe("formStrip", () => {
  const rows = [
    match({ match_id: 3, team: AMBER, winning_team: AMBER }), // newest
    match({ match_id: 2, team: AMBER, winning_team: SAPPHIRE }),
    match({ match_id: 1, team: null, winning_team: null, result: null }), // oldest
  ];

  it("reads oldest -> newest with short histories padded on the left", () => {
    const { slots, played } = formStrip(rows, 5);
    expect(played).toBe(3);
    expect(slots).toHaveLength(5);
    expect(slots.slice(0, 2)).toEqual([null, null]);
    expect(slots.slice(2).map((slot) => slot.outcome)).toEqual([UNKNOWN, LOSS, WIN]);
  });

  it("titles each square with week, game, hero and result", () => {
    const { slots } = formStrip(rows, 1);
    expect(slots[0].title).toBe("NS 57 · Game 1 · Pocket · Win");
  });

  it("summarises the counted games and omits unknown when there are none", () => {
    expect(formStrip(rows).summary).toBe("1 W · 1 L · 1 unknown");
    expect(formStrip([match()]).summary).toBe("1 W · 0 L");
  });

  it("handles an empty history", () => {
    const { slots, summary } = formStrip([], 10);
    expect(slots.every((slot) => slot === null)).toBe(true);
    expect(summary).toBe("0 W · 0 L");
  });
});

describe("decisiveScore", () => {
  it("colours only the number that decided the pair", () => {
    expect(decisiveScore(2, 0)).toEqual({ winsTone: "win", lossesTone: "neutral" });
    expect(decisiveScore(1, 2)).toEqual({ winsTone: "neutral", lossesTone: "loss" });
  });

  it("keeps a tie neutral", () => {
    expect(decisiveScore(1, 1)).toEqual({ winsTone: "tie", lossesTone: "tie" });
    expect(decisiveScore(0, 0)).toEqual({ winsTone: "tie", lossesTone: "tie" });
  });
});

describe("kda and perMinute", () => {
  it("uses (K + A) / max(D, 1)", () => {
    expect(kda({ kills: 4, deaths: 2, assists: 10 })).toBe(7);
    expect(kda({ kills: 4, deaths: 0, assists: 0 })).toBe(4);
    expect(kda({})).toBe(0);
  });

  it("returns null when a per-minute rate cannot be computed", () => {
    expect(perMinute(30000, 1800)).toBe(1000);
    expect(perMinute(30000, 0)).toBeNull();
    expect(perMinute(30000, null)).toBeNull();
    expect(perMinute(null, 1800)).toBeNull();
  });
});

describe("heroPool", () => {
  const rows = [
    match({ hero_id: 50, hero_name: "Pocket", team: AMBER, winning_team: AMBER }),
    match({ hero_id: 50, hero_name: "Pocket", team: AMBER, winning_team: SAPPHIRE }),
    match({ hero_id: 50, hero_name: "Pocket", team: null, winning_team: null, result: null, net_worth: null, player_damage: null }),
    match({ hero_id: 8, hero_name: "McGinnis", team: AMBER, winning_team: AMBER }),
    match({ hero_id: 8, hero_name: "McGinnis", team: null, winning_team: null, result: null }),
  ];

  it("aggregates games, W-L, unknown and KDA per hero", () => {
    const [pocket, mcGinnis] = heroPool(rows);
    expect(pocket.games).toBe(3);
    expect(pocket.wins).toBe(1);
    expect(pocket.losses).toBe(1);
    expect(pocket.unknown).toBe(1);
    expect(pocket.decided).toBe(2);
    expect(pocket.winRate).toBe(0.5);
    // Every row in this fixture is 4/2/10, so both formulas agree here.
    expect(pocket.kda).toBe(kda({ kills: 4, deaths: 2, assists: 10 }));

    expect(mcGinnis.games).toBe(2);
    expect(mcGinnis.decided).toBe(1);
    expect(mcGinnis.winRate).toBe(1);
  });

  it("averages per-game KDA rather than the ratio of the totals", () => {
    const pool = heroPool([
      match({ kills: 10, deaths: 0, assists: 0 }), // 10.00
      match({ kills: 0, deaths: 10, assists: 0 }), // 0.00
    ]);
    // The ratio of the totals would be (10 + 0) / max(10, 1) = 1.
    expect(pool[0].kda).toBe(5);
  });

  it("sorts by games played, then by name", () => {
    expect(heroPool(rows).map((hero) => hero.hero_name)).toEqual(["Pocket", "McGinnis"]);
  });

  it("averages souls and damage per minute over the games that have them", () => {
    const pocket = heroPool(rows)[0];
    // Two games carry souls (30000 over 1800s = 1000/min); the third is null.
    expect(pocket.soulsPerMin).toBeCloseTo(1000, 5);
    expect(pocket.damagePerMin).toBeCloseTo((25000 / 30 + 25000 / 30) / 2, 5);
  });

  it("reports null rates when no game has the data", () => {
    const pool = heroPool([match({ net_worth: null, player_damage: null })]);
    expect(pool[0].soulsPerMin).toBeNull();
    expect(pool[0].damagePerMin).toBeNull();
    expect(pool[0].killsPerGame).toBe(4);
  });

  it("ignores rows without a hero and an empty history", () => {
    expect(heroPool([match({ hero_id: null })])).toEqual([]);
    expect(heroPool([])).toEqual([]);
  });
});

describe("pickShare", () => {
  const pool = [
    { hero_name: "A", games: 5 },
    { hero_name: "B", games: 3 },
    { hero_name: "C", games: 2 },
    { hero_name: "D", games: 1 },
    { hero_name: "E", games: 1 },
  ];

  it("splits the top N from everyone else", () => {
    const share = pickShare(pool, 3);
    expect(share.totalGames).toBe(12);
    expect(share.top.map((hero) => hero.hero_name)).toEqual(["A", "B", "C"]);
    expect(share.top[0].share).toBeCloseTo(5 / 12, 5);
    expect(share.others).toEqual({ count: 2, games: 2, share: 2 / 12 });
    expect(share.topShare).toBeCloseTo(10 / 12, 5);
  });

  it("survives an empty pool", () => {
    expect(pickShare([], 3)).toEqual({
      totalGames: 0,
      top: [],
      others: { count: 0, games: 0, share: 0 },
      topShare: 0,
    });
  });
});

describe("poolCallouts", () => {
  const hero = (name, games, wins) => ({ hero_name: name, games, wins, losses: games - wins,
    decided: games, winRate: games > 0 ? wins / games : null });

  it("only rates heroes with the minimum number of decided games", () => {
    const callouts = poolCallouts(
      [hero("Most", 9, 4), hero("Lucky", 2, 2), hero("Great", 4, 4), hero("Bad", 5, 0)],
      MIN_HERO_GAMES,
    );
    expect(callouts.mostPlayed.hero_name).toBe("Most");
    expect(callouts.best.hero_name).toBe("Great");
    expect(callouts.worst.hero_name).toBe("Bad");
    expect(callouts.hasRated).toBe(true);
  });

  it("reports nothing to rate when the pool is too thin", () => {
    const callouts = poolCallouts([hero("Lucky", 1, 1)], MIN_HERO_GAMES);
    expect(callouts.mostPlayed.hero_name).toBe("Lucky");
    expect(callouts.best).toBeNull();
    expect(callouts.worst).toBeNull();
    expect(callouts.hasRated).toBe(false);
    expect(callouts.minGames).toBe(3);
  });
});

describe("playedTeams", () => {
  const rows = [
    match({ event_week: 57, team: AMBER, event_team_a_ingame_side: 0 }), // newest
    match({ event_week: 55, team: AMBER, event_team_a_ingame_side: 0 }),
    match({ event_week: 40, team: SAPPHIRE, event_team_a_ingame_side: 0 }), // FPS Lounge
    match({ event_week: 20, team: null, event_team_a_ingame_side: null }),
  ];

  it("names the team per match from the side the player was on", () => {
    expect(teamForMatch(rows[0])).toBe("Poppers' Pupils");
    expect(teamForMatch(rows[2])).toBe("Melee Creeps");
    expect(teamForMatch(rows[3])).toBeNull();
  });

  it("groups teams by games, with the week span and the newest team", () => {
    const { teams, current, teamCount, firstWeek, lastWeek } = playedTeams(rows);
    expect(teamCount).toBe(2);
    expect(teams[0]).toMatchObject({ team: "Poppers' Pupils", games: 2, weeks: [55, 57] });
    expect(teams[1]).toMatchObject({ team: "Melee Creeps", games: 1, weeks: [40] });
    expect(current).toBe("Poppers' Pupils");
    expect(firstWeek).toBe(20);
    expect(lastWeek).toBe(57);
  });

  it("handles a player with no games", () => {
    expect(playedTeams([])).toMatchObject({
      teams: [],
      current: null,
      teamCount: 0,
      firstWeek: null,
      lastWeek: null,
    });
  });
});

describe("headlineStats", () => {
  it("averages only the rows that carry the stat", () => {
    const rows = [
      match({ kills: 4, deaths: 2, assists: 10, net_worth: 30000, player_damage: 20000 }),
      match({ kills: 6, deaths: 4, assists: 14, net_worth: null, player_damage: null }),
    ];
    const stats = headlineStats(rows);
    expect(stats.games).toBe(2);
    expect(stats.wins).toBe(2);
    expect(stats.decided).toBe(2);
    expect(stats.winRate).toBe(1);
    expect(stats.kda).toBeCloseTo((7 + 5) / 2, 5);
    expect(stats.soulsPerGame).toBe(30000);
    expect(stats.damagePerGame).toBe(20000);
    expect(stats.soulsGames).toBe(1);
    expect(stats.damageGames).toBe(1);
  });

  it("reports null averages for a player with no games", () => {
    const stats = headlineStats([]);
    expect(stats.kda).toBeNull();
    expect(stats.soulsPerGame).toBeNull();
    expect(stats.damagePerGame).toBeNull();
    expect(stats.winRate).toBeNull();
  });
});

describe("delta", () => {
  it("reads a percentage change against the baseline", () => {
    expect(delta(4.34 * 1.12, 4.34)).toMatchObject({ kind: "better", label: "+12%" });
    expect(delta(4.34 * 0.8, 4.34)).toMatchObject({ kind: "worse", label: "-20%" });
  });

  it("treats ±2% as flat", () => {
    expect(delta(101, 100)).toMatchObject({ kind: "flat", label: "≈" });
    expect(delta(99, 100)).toMatchObject({ kind: "flat", label: "≈" });
  });

  it("shows percentage points for win rates", () => {
    expect(delta(0.62, 0.468, { unit: "pts" })).toMatchObject({
      kind: "better",
      label: "+15.2 pts",
    });
  });

  it("flips for metrics where lower is better", () => {
    expect(delta(8, 10, { invert: true })).toMatchObject({ kind: "better", label: "-20%" });
    expect(delta(12, 10, { invert: true })).toMatchObject({ kind: "worse", label: "+20%" });
  });

  it("reports no delta without a usable baseline", () => {
    expect(delta(null, 10)).toEqual({ kind: "none" });
    expect(delta(10, null)).toEqual({ kind: "none" });
    expect(delta(10, 0)).toEqual({ kind: "none" });
  });
});

describe("matchLabel", () => {
  it("reads as NS week and game", () => {
    expect(matchLabel({ event_week: 57, event_game: "Game 1" })).toBe("NS 57 · Game 1");
    expect(matchLabel({ event_week: null, event_game: null })).toBe("Preseason");
  });
});

describe("opponentForMatch", () => {
  it("names the other team whichever side the player was on", () => {
    expect(opponentForMatch(match({ team: AMBER, event_team_a_ingame_side: 0 }))).toBe(
      "Melee Creeps",
    );
    expect(opponentForMatch(match({ team: SAPPHIRE, event_team_a_ingame_side: 0 }))).toBe(
      "Poppers' Pupils",
    );
  });

  it("is null when the player's own team cannot be resolved", () => {
    expect(opponentForMatch(match({ team: null, event_team_a_ingame_side: null }))).toBeNull();
  });
});

describe("lastNOn", () => {
  const rows = [
    match({ match_id: 5, hero_id: 50, event_week: 57 }),
    match({ match_id: 4, hero_id: 8, event_week: 56 }),
    match({ match_id: 3, hero_id: 50, event_week: 55 }),
    match({ match_id: 2, hero_id: 50, event_week: 54 }),
  ];

  it("keeps only that hero's games, newest first", () => {
    expect(lastNOn(rows, 50, 5).map((row) => row.match_id)).toEqual([5, 3, 2]);
  });

  it("caps the list", () => {
    expect(lastNOn(rows, 50, 2).map((row) => row.match_id)).toEqual([5, 3]);
  });

  it("handles a hero with no games and a missing id", () => {
    expect(lastNOn(rows, 99)).toEqual([]);
    expect(lastNOn(rows, null)).toEqual([]);
  });
});

describe("sortPool", () => {
  const pool = [
    { hero_name: "Zed", games: 1, wins: 1, winRate: 1, kda: 2, soulsPerMin: null, damagePerMin: 100 },
    { hero_name: "Ana", games: 6, wins: 3, winRate: 0.5, kda: 9, soulsPerMin: 900, damagePerMin: 300 },
    { hero_name: "Bea", games: 6, wins: 4, winRate: 0.4, kda: 4, soulsPerMin: 1100, damagePerMin: 200 },
  ];

  it("defaults to games descending", () => {
    expect(sortPool(pool, "games", "desc").map((h) => h.hero_name)).toEqual(["Ana", "Bea", "Zed"]);
  });

  it("breaks ties on the hero name", () => {
    expect(sortPool(pool, "games", "desc").slice(0, 2).map((h) => h.hero_name)).toEqual([
      "Ana",
      "Bea",
    ]);
  });

  it("sorts each exposed key both ways", () => {
    expect(sortPool(pool, "winRate", "desc").map((h) => h.hero_name)).toEqual(["Zed", "Ana", "Bea"]);
    expect(sortPool(pool, "kda", "asc").map((h) => h.hero_name)).toEqual(["Zed", "Bea", "Ana"]);
    expect(sortPool(pool, "soulsPerMin", "desc").map((h) => h.hero_name)).toEqual([
      "Bea",
      "Ana",
      "Zed",
    ]);
    expect(sortPool(pool, "damagePerMin", "desc").map((h) => h.hero_name)).toEqual([
      "Ana",
      "Bea",
      "Zed",
    ]);
    expect(sortPool(pool, "record", "desc").map((h) => h.hero_name)).toEqual(["Bea", "Ana", "Zed"]);
  });

  it("sinks heroes with no value for the sort key", () => {
    expect(sortPool(pool, "soulsPerMin", "asc")[2].hero_name).toBe("Zed");
  });

  it("falls back to games for an unknown key and never mutates the input", () => {
    const copy = [...pool];
    expect(sortPool(pool, "nonsense", "desc").map((h) => h.hero_name)).toEqual([
      "Ana",
      "Bea",
      "Zed",
    ]);
    expect(pool).toEqual(copy);
  });
});

describe("leagueGames", () => {
  it("drops the Open qualifier", () => {
    const rows = [
      match({ match_id: 1 }),
      match({ match_id: 2, event_title: "Night Shift Open 1" }),
    ];
    expect(leagueGames(rows).map((row) => row.match_id)).toEqual([1]);
  });

  it("keeps matches that carry no event title at all", () => {
    expect(leagueGames([match({ event_title: null })])).toHaveLength(1);
  });
});

describe("longestWinStreak", () => {
  const win = (id) => match({ match_id: id });
  const loss = (id) =>
    match({ match_id: id, team: AMBER, winning_team: SAPPHIRE, result: "Loss" });
  const unknown = (id) => match({ match_id: id, team: null, winning_team: null, result: null });

  it("returns the longest run, oldest first", () => {
    // Newest first, as the endpoint returns them.
    expect(longestWinStreak([win(5), win(4), win(3), loss(2), win(1)]).map((r) => r.match_id)).toEqual([
      3, 4, 5,
    ]);
  });

  it("is broken by a loss", () => {
    expect(longestWinStreak([win(4), loss(3), win(2), win(1)]).map((r) => r.match_id)).toEqual([1, 2]);
  });

  it("is broken by a game with no result, which cannot count as a win", () => {
    expect(longestWinStreak([win(3), unknown(2), win(1)]).map((r) => r.match_id)).toEqual([1]);
  });

  it("keeps the oldest of two equally long runs", () => {
    expect(
      longestWinStreak([win(4), win(3), loss(2), win(1)]).map((r) => r.match_id),
    ).toEqual([3, 4]);
  });

  it("has no streak without games or without wins", () => {
    expect(longestWinStreak([])).toEqual([]);
    expect(longestWinStreak([loss(1), loss(2)])).toEqual([]);
  });
});

describe("personalBests", () => {
  const rows = [
    // Newest first.
    match({
      match_id: 30,
      kills: 2,
      deaths: 0,
      assists: 3,
      net_worth: 41000,
      player_damage: 30000,
      duration_s: 1500,
      event_week: 51,
    }),
    match({
      match_id: 29,
      kills: 9,
      deaths: 1,
      assists: 21,
      net_worth: 52000,
      player_damage: 18000,
      duration_s: 2200,
      event_week: 50,
    }),
    match({
      match_id: 28,
      team: SAPPHIRE,
      winning_team: AMBER,
      result: "Loss",
      kills: 1,
      deaths: 8,
      assists: 2,
      net_worth: 20000,
      player_damage: 48000,
      duration_s: 3100,
      event_week: 49,
    }),
    match({
      match_id: 27,
      kills: 6,
      deaths: 2,
      assists: 9,
      net_worth: 33000,
      player_damage: 21000,
      duration_s: 2700,
      event_week: 48,
    }),
  ];
  const byId = (records) => Object.fromEntries(records.map((record) => [record.id, record]));

  it("picks the best game for each record", () => {
    const { records, games } = personalBests(rows);
    const best = byId(records);
    expect(games).toBe(4);

    expect(best.kda.match.match_id).toBe(29);
    expect(best.kda.value).toBe(30);
    expect(best.souls.match.match_id).toBe(29);
    expect(best.souls.value).toBe(52000);
    // The damage record is a loss — the best game is not always a win.
    expect(best.damage.match.match_id).toBe(28);
    expect(best.damage.value).toBe(48000);
    expect(best.longestWin.match.match_id).toBe(27);
    expect(best.longestWin.value).toBe(2700);
  });

  it("reports the streak with the games that made it", () => {
    const { records } = personalBests(rows);
    const streak = byId(records).streak;
    expect(streak.value).toBe(2);
    expect(streak.from.match_id).toBe(29);
    expect(streak.to.match_id).toBe(30);
    // Linking target is the game the streak started in.
    expect(streak.match.match_id).toBe(29);
  });

  it("counts league games only", () => {
    const openGame = match({
      match_id: 31,
      event_title: "Night Shift Open 1",
      kills: 40,
      deaths: 0,
      assists: 40,
      net_worth: 99999,
      player_damage: 99999,
    });
    const { records, games } = personalBests([openGame, ...rows]);
    const best = byId(records);
    expect(games).toBe(4);
    expect(best.kda.match.match_id).toBe(29);
    expect(best.souls.value).toBe(52000);
  });

  it("leaves out a record no game has data for", () => {
    const bare = [
      match({ match_id: 1, net_worth: null, player_damage: null, kills: null, deaths: null, assists: null }),
    ];
    expect(personalBests(bare).records.map((record) => record.id)).toEqual(["longestWin", "streak"]);
  });

  it("has nothing to show for an empty history", () => {
    expect(personalBests([]).records).toEqual([]);
    expect(personalBests([]).games).toBe(0);
  });
});
