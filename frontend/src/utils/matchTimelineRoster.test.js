import { describe, expect, it } from "vitest";
import { clock, matchTimeParam, parseMatchTime } from "./matchTimeline";
import { aliveCount, buildRoster, playerStates, teamScores } from "./matchTimelineRoster";

const players = [
  { account_id: 101, player_slot: 1, team: 0, hero_id: 11, persona_name: "ABL" },
  { account_id: 102, player_slot: 2, team: 0, hero_id: 12, persona_name: "sanya" },
  { account_id: 107, player_slot: 7, team: 1, hero_id: 22, persona_name: "Zerggy" },
  { account_id: 108, player_slot: 8, team: 1, hero_id: 23, persona_name: "quilt" },
];

const kill = (id, timeS, team, victimAccountId, untilS, extra = {}) => ({
  id, timeS, team, victimAccountId, untilS, killerAccountId: 999, ...extra,
});

describe("parseMatchTime", () => {
  it("reads m:ss", () => {
    expect(parseMatchTime("17:45")).toBe(1065);
    expect(parseMatchTime("0:00")).toBe(0);
  });

  it("reads bare seconds", () => {
    expect(parseMatchTime("1065")).toBe(1065);
    expect(parseMatchTime(1065)).toBe(1065);
  });

  it("round-trips with the clock", () => {
    expect(parseMatchTime(clock(1065))).toBe(1065);
    expect(matchTimeParam(1065)).toBe("17:45");
  });

  it("returns null for anything unusable rather than seeking to zero", () => {
    // Number(null) and Number("") are 0, which would read as the start of the match.
    expect(parseMatchTime(null)).toBeNull();
    expect(parseMatchTime(undefined)).toBeNull();
    expect(parseMatchTime("")).toBeNull();
    expect(parseMatchTime("   ")).toBeNull();
    expect(parseMatchTime("nonsense")).toBeNull();
    expect(parseMatchTime("1:xx")).toBeNull();
  });

  it("never returns a negative time", () => {
    expect(parseMatchTime("-30")).toBe(0);
  });
});

describe("teamScores", () => {
  const kills = [
    kill(0, 100, 0, 107, 130),
    kill(1, 200, 1, 101, 230),
    kill(2, 300, 0, 108, 340),
    kill(3, 400, null, 102, 430),  // no recorded killer
  ];

  it("counts each side's kills up to the clock", () => {
    expect(teamScores(kills, 250)).toEqual({ 0: 1, 1: 1 });
    expect(teamScores(kills, 500)).toEqual({ 0: 2, 1: 1 });
  });

  it("does not credit a death with no killer to either side", () => {
    expect(teamScores(kills, 500)[0] + teamScores(kills, 500)[1]).toBe(3);
  });

  it("counts everything when there is no clock", () => {
    expect(teamScores(kills)).toEqual({ 0: 2, 1: 1 });
  });

  it("is zero with no kills", () => {
    expect(teamScores([], 500)).toEqual({ 0: 0, 1: 0 });
  });
});

describe("playerStates", () => {
  // ABL dies at 600 and is down for 40s.
  const kills = [kill(0, 600, 1, 101, 640)];

  it("marks a player dead inside the respawn window", () => {
    const states = playerStates(players, kills, 620);
    expect(states[0]).toMatchObject({ dead: true, remainingS: 20 });
    expect(states[1].dead).toBe(false);
  });

  it("brings them back when the respawn ends", () => {
    expect(playerStates(players, kills, 640)[0].dead).toBe(false);
  });

  it("is not dead before the death", () => {
    expect(playerStates(players, kills, 599)[0].dead).toBe(false);
  });

  it("rounds a countdown up so it never reads 0s while still dead", () => {
    expect(playerStates(players, kills, 639.5)[0].remainingS).toBe(1);
  });

  it("treats a death with no known respawn as alive", () => {
    const unknown = [kill(0, 600, 1, 101, null)];
    expect(playerStates(players, unknown, 700)[0].dead).toBe(false);
  });

  it("counts the living per side", () => {
    const states = playerStates(players, kills, 620);
    expect(aliveCount(states, 0)).toBe(1);
    expect(aliveCount(states, 1)).toBe(2);
  });

  it("is everyone alive before the first kill", () => {
    const states = playerStates(players, kills, 0);
    expect(states.every((state) => !state.dead)).toBe(true);
  });
});

describe("buildRoster", () => {
  const kills = [kill(0, 600, 1, 101, 640)];

  it("splits the sides in order and counts the living", () => {
    const roster = buildRoster({ players, kills, t: 620 });
    expect(roster.map((side) => side.team)).toEqual([0, 1]);
    expect(roster[0].members.map((member) => member.persona_name)).toEqual(["ABL", "sanya"]);
    expect(roster[0].alive).toBe(1);
    expect(roster[1].alive).toBe(2);
  });

  it("orders members by their in-game slot", () => {
    const shuffled = [players[3], players[2]];
    const roster = buildRoster({ players: shuffled, kills, t: 0 });
    expect(roster[1].members.map((member) => member.player_slot)).toEqual([7, 8]);
  });

  it("carries the killer's name for the countdown tooltip", () => {
    const roster = buildRoster({ players, kills, t: 620 });
    expect(roster[0].members[0].killerName).toBeNull();  // the fixture records no name
  });

  it("handles an empty call", () => {
    const roster = buildRoster();
    expect(roster).toHaveLength(2);
    expect(roster[0].members).toEqual([]);
    expect(roster[0].alive).toBe(0);
  });
});
