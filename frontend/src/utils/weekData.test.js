import { describe, expect, it } from "vitest";
import {
  bracketLayout,
  buildBrackets,
  buildHeroPicks,
  buildLeaderboard,
  buildRegionBrackets,
  buildSeries,
  formatDuration,
  patchNoteLabel,
  regionOutcome,
  roundColumns,
  scopeGames,
  scopeSeries,
  summarizeIndexWeek,
  teamInitials,
  weekChampions,
} from "./weekData";

const match = (overrides = {}) => ({
  match_id: 1,
  duration_s: 1800,
  winning_team: 0,
  event_team_a: "Melee Creeps",
  event_team_b: "Pulsar Esports",
  event_team_a_ingame_side: 0,
  event_region: "NA",
  event_subtitle: "FINALS",
  start_time: "2026-09-30T18:00:00Z",
  players: [],
  ...overrides,
});

const player = (overrides = {}) => ({
  account_id: 1,
  persona_name: "Kaizen",
  hero_name: "Haze",
  team: 0,
  kills: 10,
  deaths: 2,
  assists: 5,
  player_damage: 1000,
  player_healing: 0,
  net_worth: 20000,
  ...overrides,
});

describe("buildSeries", () => {
  it("groups a series' games and tallies wins per team", () => {
    const series = buildSeries([
      match({ match_id: 1, winning_team: 0 }),
      match({ match_id: 2, winning_team: 1 }),
      match({ match_id: 3, winning_team: 1 }),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].scoreA).toBe(1);
    expect(series[0].scoreB).toBe(2);
    expect(series[0].winner).toBe("b");
    expect(series[0].winnerTeam).toBe("Pulsar Esports");
    expect(series[0].games.map((game) => game.match.match_id)).toEqual([1, 2, 3]);
  });

  it("reads the winner through team A's in-game side", () => {
    // Team A was on Sapphire (1) and Sapphire won, so A takes the game.
    const series = buildSeries([
      match({ winning_team: 1, event_team_a_ingame_side: 1 }),
    ]);
    expect(series[0].scoreA).toBe(1);
  });

  it("leaves a series with no decided games without a winner", () => {
    const series = buildSeries([match({ match_id: 1, winning_team: 9 })]);
    expect(series[0].winner).toBeNull();
    expect(series[0].winnerTeam).toBeNull();
  });

  it("infers a blank region from a team shared within the week", () => {
    const series = buildSeries([
      match({ match_id: 1, event_region: "EU", event_team_a: "Leviathan", event_team_b: "Abrahams" }),
      match({
        match_id: 2,
        event_region: null,
        event_team_a: "Buff Enjoyers",
        event_team_b: "Leviathan",
      }),
    ]);
    expect(series.map((entry) => entry.region)).toEqual(["EU", "EU"]);
  });

  it("keeps series with no shared team in an Other bucket", () => {
    const series = buildSeries([match({ match_id: 1, event_region: null })]);
    expect(series[0].region).toBe("Other");
  });

  it("ignores teamless matches", () => {
    expect(buildSeries([match({ event_team_a: null, event_team_b: null })])).toHaveLength(0);
  });
});

describe("buildRegionBrackets", () => {
  const week = () =>
    buildSeries([
      match({
        match_id: 1,
        event_subtitle: "CHALLENGER MATCH",
        event_team_a: "Pulsar Esports",
        event_team_b: "Vanguard",
      }),
      match({
        match_id: 2,
        event_subtitle: "FINALS",
        event_team_a: "Melee Creeps",
        event_team_b: "Pulsar Esports",
        winning_team: 1,
      }),
      match({
        match_id: 3,
        event_region: "EU",
        event_subtitle: "FINALS",
        event_team_a: "Leviathan",
        event_team_b: "Buff Enjoyers",
      }),
    ]);

  it("splits semifinals from the grand final per region", () => {
    const [na, eu] = buildRegionBrackets(week());
    expect(na.name).toBe("NA");
    expect(na.semis).toHaveLength(1);
    expect(na.final.teamA).toBe("Melee Creeps");
    expect(eu.semis).toHaveLength(0);
    expect(eu.final.teamB).toBe("Buff Enjoyers");
  });

  it("orders regions NA first", () => {
    const brackets = buildRegionBrackets(week());
    expect(brackets.map((bracket) => bracket.name)).toEqual(["NA", "EU"]);
  });

  it("gives every series a stable region-index key", () => {
    const [na] = buildRegionBrackets(week());
    expect(na.series.map((series) => series.key)).toEqual(["NA-0", "NA-1"]);
  });

  it("takes the champion from the grand final winner", () => {
    const [na] = buildRegionBrackets(week());
    expect(na.champ).toBe("Pulsar Esports");
  });

  it("falls back to the last series when a week has no final", () => {
    const [na] = buildRegionBrackets(
      buildSeries([
        match({ match_id: 1, event_subtitle: "CHALLENGER MATCH", winning_team: 1 }),
      ]),
    );
    expect(na.final).toBeNull();
    expect(na.champ).toBe("Pulsar Esports");
  });

  it("collects a week's champions per region", () => {
    expect(weekChampions(buildRegionBrackets(week()))).toEqual({
      NA: "Pulsar Esports",
      EU: "Leviathan",
    });
  });

  it("infers the final when the stage titles are blank", () => {
    const untitled = buildSeries([
      match({
        match_id: 1,
        event_subtitle: null,
        event_team_a: "Pulsar Esports",
        event_team_b: "Vanguard",
        winning_team: 0,
        start_time: "2026-09-30T19:00:00Z",
      }),
      match({
        match_id: 2,
        event_subtitle: null,
        event_team_a: "Melee Creeps",
        event_team_b: "Pulsar Esports",
        winning_team: 1,
        start_time: "2026-09-30T20:00:00Z",
      }),
    ]);
    const [na] = buildRegionBrackets(untitled);
    expect(na.semis.map((series) => series.teamA)).toEqual(["Pulsar Esports"]);
    expect(na.final.teamA).toBe("Melee Creeps");
    expect(na.champ).toBe("Pulsar Esports");
  });

  it("leaves two unrelated untitled series as semifinals", () => {
    const untitled = buildSeries([
      match({ match_id: 1, event_subtitle: null, event_team_a: "Alpha", event_team_b: "Bravo" }),
      match({ match_id: 2, event_subtitle: null, event_team_a: "Charlie", event_team_b: "Delta" }),
    ]);
    const [na] = buildRegionBrackets(untitled);
    expect(na.final).toBeNull();
    expect(na.semis).toHaveLength(2);
  });

  it("prefers an explicit non-final title over the untitled inference", () => {
    const titled = buildSeries([
      match({
        match_id: 1,
        event_subtitle: "CHALLENGER MATCH",
        event_team_a: "Hydra Nation",
        event_team_b: "PKP",
        start_time: "2026-08-12T19:00:00Z",
      }),
      match({
        match_id: 2,
        event_subtitle: "CHALLENGER MATCH",
        event_team_a: "Valhalla",
        event_team_b: "PKP",
        start_time: "2026-08-12T20:00:00Z",
      }),
    ]);
    const [na] = buildRegionBrackets(titled);
    expect(na.final).toBeNull();
    expect(na.semis).toHaveLength(2);
  });
});

describe("round labelling", () => {
  it("uses the authored stage titles for the bracket columns", () => {
    const brackets = buildRegionBrackets(
      buildSeries([
        match({
          match_id: 1,
          event_subtitle: "Challenger",
          event_team_a: "Pulsar Esports",
          event_team_b: "Vanguard",
          start_time: "2026-09-30T19:00:00Z",
        }),
        match({
          match_id: 2,
          event_subtitle: "Finals",
          event_team_a: "Melee Creeps",
          event_team_b: "Pulsar Esports",
          start_time: "2026-09-30T20:00:00Z",
        }),
      ]),
    );
    expect(roundColumns(brackets)).toEqual(["Challenger", "Finals"]);
  });

  it("labels each series with its own authored title", () => {
    const brackets = buildRegionBrackets(
      buildSeries([
        match({
          match_id: 1,
          event_subtitle: "CHALLENGER MATCH",
          event_team_a: "Pulsar Esports",
          event_team_b: "Vanguard",
          start_time: "2026-09-30T19:00:00Z",
        }),
        match({
          match_id: 2,
          event_subtitle: "FINALS",
          event_team_a: "Melee Creeps",
          event_team_b: "Pulsar Esports",
          start_time: "2026-09-30T20:00:00Z",
        }),
      ]),
    );
    expect(brackets[0].series.map((series) => series.roundLabel)).toEqual([
      "CHALLENGER MATCH",
      "FINALS",
    ]);
  });

  it("lends the titled round's name to an untitled sibling", () => {
    // EU carries titles; NA is blank, as it is in the live database for week 44 on.
    const brackets = buildRegionBrackets(
      buildSeries([
        match({
          match_id: 1,
          event_region: "EU",
          event_subtitle: "CHALLENGER MATCH",
          event_team_a: "Buff Enjoyers",
          event_team_b: "Abrahams",
          start_time: "2026-09-30T17:00:00Z",
        }),
        match({
          match_id: 2,
          event_region: "EU",
          event_subtitle: "FINALS",
          event_team_a: "Leviathan",
          event_team_b: "Buff Enjoyers",
          start_time: "2026-09-30T18:00:00Z",
        }),
        match({
          match_id: 3,
          event_region: "NA",
          event_subtitle: null,
          event_team_a: "Pulsar Esports",
          event_team_b: "Vanguard",
          start_time: "2026-09-30T19:00:00Z",
        }),
        match({
          match_id: 4,
          event_region: "NA",
          event_subtitle: null,
          event_team_a: "Melee Creeps",
          event_team_b: "Pulsar Esports",
          start_time: "2026-09-30T20:00:00Z",
        }),
      ]),
    );
    const na = brackets.find((bracket) => bracket.name === "NA");
    expect(na.series.map((series) => series.roundLabel)).toEqual(["CHALLENGER MATCH", "FINALS"]);
    expect(roundColumns(brackets)).toEqual(["CHALLENGER MATCH", "FINALS"]);
  });

  it("names the scope label after the authored round", () => {
    const series = buildSeries([
      match({
        match_id: 1,
        event_subtitle: "Challenger",
        event_team_a: "Pulsar Esports",
        event_team_b: "Vanguard",
      }),
      match({
        match_id: 2,
        event_subtitle: "Finals",
        event_team_a: "Melee Creeps",
        event_team_b: "Pulsar Esports",
      }),
    ]);
    const brackets = buildRegionBrackets(series);
    const scoped = scopeSeries(series, brackets[0].series[1].key, "all");
    expect(scoped.scopeLabel).toBe("Melee Creeps v Pulsar Esports · NA Finals");
  });

  it("falls back to generic names when nothing is authored", () => {
    const brackets = buildRegionBrackets(
      buildSeries([
        match({ match_id: 1, event_subtitle: null, event_team_a: "Alpha", event_team_b: "Bravo" }),
        match({ match_id: 2, event_subtitle: null, event_team_a: "Charlie", event_team_b: "Delta" }),
      ]),
    );
    expect(roundColumns(brackets)).toEqual(["Semifinals"]);
    expect(brackets[0].series[0].roundLabel).toBe("Semifinals");
  });
});

describe("bracketLayout", () => {
  it("centres the grand final between two semifinals", () => {
    const semis = [
      { key: "NA-0", winnerTeam: "A", teams: ["A", "B"] },
      { key: "NA-1", winnerTeam: "C", teams: ["C", "D"] },
    ];
    const final = { key: "NA-2", teamA: "A", teamB: "C", teams: ["A", "C"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Challenger", series: semis },
        { name: "Finals", series: [final] },
      ],
    });
    expect(layout.height).toBe(132);
    expect(layout.cards.map((card) => card.top)).toEqual([0, 76, 38]);
    expect(layout.cards.map((card) => card.left)).toEqual([0, 0, 196]);
  });

  it("offsets the single semifinal of a three-team bracket below the final", () => {
    const semi = { key: "NA-0", winnerTeam: "B", teams: ["A", "B"] };
    const final = { key: "NA-1", teamA: "C", teamB: "B", teams: ["C", "B"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Challenger", series: [semi] },
        { name: "Finals", series: [final] },
      ],
    });
    expect(layout.height).toBe(86);
    expect(layout.cards.map((card) => card.top)).toEqual([30, 0]);
    // The bye team (C) sits on the final's top row, the semifinal winner (B) below it.
    expect(layout.lines).toContainEqual({ left: 178, top: 14, width: 18, height: 1 });
    expect(layout.lines[0]).toEqual({ left: 160, top: 56, width: 18, height: 1 });
  });

  it("swaps the three-team stubs when the bye team is the bottom row", () => {
    const semi = { key: "NA-0", winnerTeam: "B", teams: ["A", "B"] };
    const final = { key: "NA-1", teamA: "B", teamB: "C", teams: ["B", "C"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Challenger", series: [semi] },
        { name: "Finals", series: [final] },
      ],
    });
    expect(layout.lines).toContainEqual({ left: 178, top: 40, width: 18, height: 1 });
    expect(layout.lines[0]).toEqual({ left: 160, top: 56, width: 18, height: 1 });
    expect(layout.lines[1].top).toBe(14);
  });

  it("lands each connector on the row the winner takes, from the authored links", () => {
    const semi = {
      key: "NA-0",
      id: "R1M1",
      winnerTeam: "B",
      winnerTo: { series: "R2M1", slot: "team_a" },
      teams: ["A", "B"],
    };
    const final = { key: "NA-1", id: "R2M1", teamA: "B", teamB: "C", teams: ["B", "C"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Challenger", series: [semi] },
        { name: "Finals", series: [final] },
      ],
    });
    expect(layout.lines[0]).toEqual({ left: 160, top: 56, width: 18, height: 1 });
    expect(layout.lines[1].top).toBe(14);
  });

  it("follows where the winner actually sits over the authored link slot", () => {
    const semi = {
      key: "NA-0",
      id: "R1M1",
      winnerTeam: "A",
      winnerTo: { series: "R2M1", slot: "team_b" },
      teams: ["A", "B"],
    };
    const final = { key: "NA-1", id: "R2M1", teamA: "A", teamB: "C", teams: ["A", "C"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Challenger", series: [semi] },
        { name: "Finals", series: [final] },
      ],
    });
    // A won and sits in team_a, so the connector lands on the top row even though
    // the authored link names team_b.
    expect(layout.lines).toContainEqual({ left: 178, top: 14, width: 18, height: 1 });
    expect(layout.lines).toContainEqual({ left: 178, top: 40, width: 18, height: 1 });
  });

  it("stacks a single round without connectors", () => {
    const semis = [
      { key: "NA-0", winnerTeam: "A", teams: ["A", "B"] },
      { key: "NA-1", winnerTeam: "C", teams: ["C", "D"] },
      { key: "NA-2", winnerTeam: "E", teams: ["E", "F"] },
    ];
    const layout = bracketLayout({ rounds: [{ name: "Challenger", series: semis }] });
    expect(layout.lines).toHaveLength(0);
    expect(layout.cards.map((card) => card.top)).toEqual([0, 76, 152]);
    expect(layout.width).toBe(160);
  });

  it("lays out an authored gauntlet one column per round", () => {
    const qualifier = {
      key: "NA-0",
      id: "R1M1",
      winnerTeam: "A",
      winnerTo: { series: "R2M1", slot: "team_b" },
      teams: ["A", "B"],
    };
    const challenger = {
      key: "NA-1",
      id: "R2M1",
      winnerTeam: "C",
      winnerTo: { series: "R3M1", slot: "team_b" },
      teams: ["C", "A"],
    };
    const final = { key: "NA-2", id: "R3M1", winnerTeam: "C", teams: ["D", "C"] };
    const layout = bracketLayout({
      rounds: [
        { name: "Qualifiers", series: [qualifier] },
        { name: "Challenger", series: [challenger] },
        { name: "Finals", series: [final] },
      ],
    });
    expect(layout.cards.map((card) => card.left)).toEqual([0, 196, 392]);
    expect(layout.cards.map((card) => card.top)).toEqual([0, 0, 0]);
    expect(layout.width).toBe(552);
    expect(layout.lines).toHaveLength(6);
  });
});

describe("buildBrackets", () => {
  const authored = {
    title: "Night Shift",
    week: 23,
    region: "NA",
    format: "gauntlet",
    rounds: [
      { round: 1, name: "Challenger", best_of: 1 },
      { round: 2, name: "Finals", best_of: 3 },
    ],
    series: [
      {
        id: "R1M1",
        round: 1,
        team_a: "No Earnings",
        team_b: "Bunny with Clock",
        winner_to: { series: "R2M1", slot: "team_b" },
        winner: "team_b",
        winner_name: "Bunny with Clock",
        score_a: 0,
        score_b: 1,
        best_of: 1,
        status: "done",
        games: [{ game: 1, match_id: 7, winner: "team_b" }],
      },
      {
        id: "R2M1",
        round: 2,
        team_a: "Melee Creeps",
        team_b: "Bunny with Clock",
        winner: "team_b",
        winner_name: "Bunny with Clock",
        score_a: 0,
        score_b: 2,
        best_of: 3,
        status: "done",
        games: [
          { game: 1, match_id: 8, winner: "team_b" },
          { game: 2, match_id: 9, winner: "team_b" },
        ],
      },
    ],
  };

  const matches = [
    match({ match_id: 7, event_team_a: "No Earnings", event_team_b: "Bunny with Clock" }),
    match({ match_id: 8, event_team_a: "Melee Creeps", event_team_b: "Bunny with Clock" }),
  ];

  it("uses the authored rounds, scores and advancement", () => {
    const [na] = buildBrackets(matches, [authored]);
    expect(na.rounds.map((round) => round.name)).toEqual(["Challenger", "Finals"]);
    expect(na.series.map((series) => series.key)).toEqual(["NA-0", "NA-1"]);
    expect(na.final.id).toBe("R2M1");
    expect(na.champ).toBe("Bunny with Clock");
    expect(na.series[0].scoreB).toBe(1);
    expect(na.series[1].games).toHaveLength(2);
    expect(na.series[1].games[0].match.duration_s).toBe(1800);
    expect(na.teams).toEqual(["No Earnings", "Bunny with Clock", "Melee Creeps"]);
  });

  it("keeps a bracket game whose match is not ingested yet", () => {
    const [na] = buildBrackets(matches, [authored]);
    expect(na.series[1].games.map((game) => game.match.match_id)).toEqual([8, 9]);
    expect(na.series[1].games[1].match.duration_s).toBeUndefined();
  });

  it("drops the BYE slot a gauntlet parks a seed in", () => {
    const [na] = buildBrackets([], [
      {
        ...authored,
        series: [
          {
            ...authored.series[0],
            id: "R2M1",
            round: 2,
            team_a: "BYE",
            team_b: "Melee Creeps",
            winner: "team_b",
            winner_name: "Melee Creeps",
          },
        ],
      },
    ]);
    expect(na.series[0].teams).toEqual(["Melee Creeps"]);
  });

  it("falls back to the match rows when the week has no authored bracket", () => {
    const brackets = buildBrackets(
      [
        match({ match_id: 1, event_subtitle: "Challenger" }),
        match({
          match_id: 2,
          event_subtitle: "Finals",
          event_team_a: "Melee Creeps",
          event_team_b: "Pulsar Esports",
        }),
      ],
      [],
    );
    expect(brackets[0].authored).toBeUndefined();
    expect(roundColumns(brackets)).toEqual(["Challenger", "Finals"]);
  });
});

describe("regionOutcome", () => {
  const bracket = {
    series: [],
    champ: "Melee Creeps",
    final: { teams: ["Melee Creeps", "Pulsar Esports"] },
  };
  bracket.series = [
    { teams: ["Pulsar Esports", "Vanguard"] },
    { teams: ["Melee Creeps", "Pulsar Esports"] },
  ];

  it("labels the champion, the runner-up and the semifinalists", () => {
    expect(regionOutcome(bracket, "Melee Creeps")).toBe("Champion");
    expect(regionOutcome(bracket, "Pulsar Esports")).toBe("Runner-up");
    expect(regionOutcome(bracket, "Vanguard")).toBe("Semifinal");
  });

  it("returns null for a team that did not play", () => {
    expect(regionOutcome(bracket, "Nobody")).toBeNull();
  });
});

describe("scopeSeries", () => {
  const series = [
    { key: "NA-0", region: "NA", teamA: "A", teamB: "B" },
    { key: "EU-0", region: "EU", teamA: "C", teamB: "D" },
  ];

  it("scopes to a selected series", () => {
    const scoped = scopeSeries(series, "EU-0", "all");
    expect(scoped.series).toEqual([series[1]]);
    expect(scoped.scopeLabel).toContain("C v D · EU");
  });

  it("scopes to a region", () => {
    const scoped = scopeSeries(series, null, "na");
    expect(scoped.series).toEqual([series[0]]);
    expect(scoped.scopeLabel).toBe("NA");
  });

  it("falls back to the whole week", () => {
    const scoped = scopeSeries(series, null, "all");
    expect(scoped.series).toHaveLength(2);
    expect(scoped.scopeLabel).toBe("both regions");
  });

  it("ignores a series key that is not in the week", () => {
    expect(scopeSeries(series, "NA-9", "all").series).toHaveLength(2);
  });
});

describe("buildLeaderboard", () => {
  const games = scopeGames([
    {
      key: "NA-0",
      games: [
        {
          match: match({
            match_id: 100,
            players: [
              player({ account_id: 1, kills: 10 }),
              player({ account_id: 2, persona_name: "Rook", kills: 4 }),
            ],
          }),
        },
        {
          match: match({
            match_id: 200,
            players: [
              player({ account_id: 1, kills: 22 }),
              player({ account_id: 2, persona_name: "Rook", kills: 30 }),
            ],
          }),
        },
      ],
    },
  ]);

  it("keeps each player's best single game and ranks descending", () => {
    const { rows, total } = buildLeaderboard(games, "k");
    expect(total).toBe(4);
    expect(rows.map((row) => row.name)).toEqual(["Rook", "Kaizen"]);
    expect(rows[0].value).toBe(30);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].value).toBe(22);
    expect(rows[1].matchId).toBe(200);
  });

  it("switches the measured stat", () => {
    const { rows } = buildLeaderboard(games, "souls");
    expect(rows[0].value).toBe(20000);
  });
});

describe("buildHeroPicks", () => {
  const games = scopeGames([
    {
      key: "NA-0",
      games: [
        {
          match: match({
            winning_team: 0,
            players: [
              player({ account_id: 1, hero_name: "Haze", team: 0 }),
              player({ account_id: 2, hero_name: "Seven", team: 0 }),
              player({ account_id: 3, hero_name: "Haze", team: 1 }),
            ],
          }),
        },
      ],
    },
  ]);

  it("records which games a hero appeared in", () => {
    const scoped = scopeGames([
      {
        key: "NA-0",
        region: "NA",
        roundLabel: "Challenger",
        games: [
          {
            match: match({
              match_id: 42,
              duration_s: 1200,
              winning_team: 0,
              players: [player({ account_id: 1, hero_name: "Haze", team: 0 })],
            }),
          },
          {
            gameNo: 2,
            match: match({
              match_id: 43,
              duration_s: 900,
              winning_team: 1,
              players: [player({ account_id: 1, hero_name: "Haze", team: 0 })],
              bans: [{ hero_name: "Haze" }],
            }),
          },
        ],
      },
    ]);
    const haze = buildHeroPicks(scoped, "picks")
      .board.flatMap((row) => row.heroes)
      .find((entry) => entry.hero === "Haze");
    expect(haze.games).toEqual([
      { matchId: 42, durationS: 1200, outcome: "won", round: "Challenger", region: "NA", gameNo: 1 },
      { matchId: 43, durationS: 900, outcome: "lost", round: "Challenger", region: "NA", gameNo: 2 },
      { matchId: 43, durationS: 900, outcome: "banned", round: "Challenger", region: "NA", gameNo: 2 },
    ]);
  });

  it("counts a won and a lost pick separately", () => {
    const { board, totalGames, anyBans } = buildHeroPicks(games, "picks");
    expect(totalGames).toBe(1);
    expect(anyBans).toBe(false);
    const haze = board.flatMap((row) => row.heroes).find((entry) => entry.hero === "Haze");
    expect(haze).toMatchObject({ won: 1, lost: 1, count: 2 });
    const seven = board.flatMap((row) => row.heroes).find((entry) => entry.hero === "Seven");
    expect(seven).toMatchObject({ won: 1, lost: 0, count: 1 });
  });

  it("counts bans per game and flags the scope as having ban data", () => {
    const banned = scopeGames([
      {
        key: "NA-0",
        games: [
          {
            match: match({
              winning_team: 0,
              players: [player({ account_id: 1, hero_name: "Haze", team: 0 })],
              bans: [
                { hero_name: "Seven", ban_order: 1, team: "team_b" },
                { hero_name: "Haze", ban_order: 2, team: "team_a" },
              ],
            }),
          },
        ],
      },
    ]);
    const { board, anyBans } = buildHeroPicks(banned, "all");
    expect(anyBans).toBe(true);
    const entries = board.flatMap((row) => row.heroes);
    expect(entries.find((entry) => entry.hero === "Haze")).toMatchObject({ won: 1, banned: 1, count: 2 });
    expect(entries.find((entry) => entry.hero === "Seven")).toMatchObject({ won: 0, banned: 1, count: 1 });
  });

  it("counts bans even when a game has no decided winner", () => {
    const undecided = scopeGames([
      {
        key: "NA-0",
        games: [{ match: match({ winning_team: null, players: [], bans: [{ hero_name: "Lash" }] }) }],
      },
    ]);
    const { board } = buildHeroPicks(undecided, "bans");
    expect(board.flatMap((row) => row.heroes).find((entry) => entry.hero === "Lash").count).toBe(1);
  });

  it("shows only bans in bans mode", () => {
    const mixed = scopeGames([
      {
        key: "NA-0",
        games: [
          {
            match: match({
              winning_team: 0,
              players: [player({ account_id: 1, hero_name: "Haze", team: 0 })],
              bans: [{ hero_name: "Seven" }],
            }),
          },
        ],
      },
    ]);
    const { board } = buildHeroPicks(mixed, "bans");
    const byHero = Object.fromEntries(board.flatMap((row) => row.heroes).map((entry) => [entry.hero, entry.count]));
    expect(byHero.Seven).toBe(1);
    expect(byHero.Haze).toBe(0);
  });

  it("ignores games with no decided winner", () => {
    const undecided = scopeGames([
      { key: "NA-0", games: [{ match: match({ winning_team: 9, players: [player()] }) }] },
    ]);
    expect(buildHeroPicks(undecided, "picks").board).toHaveLength(0);
  });

  it("falls back to picks when a week has no ban data", () => {
    const { board, anyBans } = buildHeroPicks(games, "bans");
    expect(anyBans).toBe(false);
    const haze = board.flatMap((row) => row.heroes).find((entry) => entry.hero === "Haze");
    expect(haze.count).toBe(2);
  });
});

describe("patch notes", () => {
  const note = (published) => ({ title: "Minor Update", published_at: published });

  it("labels a note with the date it was posted", () => {
    expect(patchNoteLabel(note("2026-07-01T22:54:00+00:00"))).toBe("Patch notes · Jul 1");
  });

  it("falls back to a plain label without a usable date", () => {
    expect(patchNoteLabel(note(null))).toBe("Patch notes");
    expect(patchNoteLabel(null)).toBeNull();
    expect(patchNoteLabel(undefined)).toBeNull();
  });
});

describe("summarizeIndexWeek", () => {
  it("derives champions and every team's result", () => {
    const summary = summarizeIndexWeek({
      week: 58,
      date: "2026-09-30T18:00:00Z",
      regions: {
        NA: {
          series: [
            {
              round: "CHALLENGER MATCH",
              team_a: "Pulsar Esports",
              team_b: "Vanguard",
              score_a: 1,
              score_b: 0,
            },
            {
              round: "FINALS",
              team_a: "Melee Creeps",
              team_b: "Pulsar Esports",
              score_a: 2,
              score_b: 0,
            },
          ],
        },
      },
    });

    expect(summary.week).toBe(58);
    expect(summary.champions).toEqual({ NA: "Melee Creeps" });
    expect(summary.teamResults["Pulsar Esports"]).toEqual({ region: "NA", result: "Runner-up" });
    expect(summary.teamResults.Vanguard).toEqual({ region: "NA", result: "Semifinal" });
  });
});

describe("formatting helpers", () => {
  it("formats durations as m:ss", () => {
    expect(formatDuration(1800)).toBe("30:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(null)).toBe("—");
  });

  it("builds two-letter team initials", () => {
    expect(teamInitials("Melee Creeps")).toBe("MC");
    expect(teamInitials("Leviathan")).toBe("LE");
    expect(teamInitials("")).toBe("?");
  });
});
