import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MatchHeader from "./MatchHeader";
import MatchResultsPanel from "./week/MatchResultsPanel";
import PlayerLeaderboard from "./week/PlayerLeaderboard";
import BracketBoard from "./week/BracketBoard";

const spoilerState = vi.hoisted(() => ({
  current: { enabled: true, revealed: [] },
}));

vi.mock("../spoilers/spoilerStore", () => ({
  useSpoilerState: () => spoilerState.current,
  revealSpoiler: vi.fn(),
  hideSpoiler: vi.fn(),
}));

vi.mock("./ReplayButton", () => ({ default: () => null }));
vi.mock("./TeamLogo", () => ({ default: () => null }));

const renderHeader = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <MatchHeader
        matchId="spoiler-test"
        weekLabel="Test Week"
        date=""
        amberTeamName="Hidden Amber"
        sapphireTeamName="Hidden Sapphire"
        amberSouls={900}
        sapphireSouls={800}
        amberKda={{ k: 71, d: 72, a: 73 }}
        sapphireKda={{ k: 81, d: 82, a: 83 }}
        amberBans={[]}
        sapphireBans={[]}
      />
    </MemoryRouter>,
  );

const renderBracket = () =>
  renderToStaticMarkup(
    <BracketBoard
      layout={{
        lines: [],
        labels: [],
        width: 180,
        height: 50,
        cards: [{
          series: {
            key: "na-0",
            teamA: "Harbor",
            teamB: "Summit",
            scoreA: 91,
            scoreB: 92,
            winner: "a",
            bestOf: 3,
            games: [{ match: { match_id: 345 } }],
          },
          left: 0,
          top: 0,
        }],
      }}
      cardWidth={180}
      selectedSeries={null}
      onSelectSeries={() => {}}
    />,
  );

const renderLeaderboard = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PlayerLeaderboard
        statKey="k"
        onStatChange={() => {}}
        subline="Most kills"
        rows={[{
          accountId: 7,
          rank: 1,
          hero: "Infernus",
          name: "Hidden Player",
          team: "Hidden Team",
          value: 999,
          side: 0,
          matchId: 345,
          durationS: 60,
        }]}
        total={1}
        expanded={false}
        onToggle={() => {}}
      />
    </MemoryRouter>,
  );

const renderMatchResults = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <MatchResultsPanel
        subline="1 game"
        brackets={[{
          name: "NA",
          series: [{
            key: "NA-0",
            teamA: "Harbor",
            teamB: "Summit",
            games: [{
              gameNo: 1,
              match: { match_id: 345, duration_s: 120 },
            }],
          }],
        }]}
      />
    </MemoryRouter>,
  );

describe("MatchHeader spoiler-free results", () => {
  beforeEach(() => {
    spoilerState.current = { enabled: true, revealed: [] };
  });

  it("hides team identities and team statistics until revealed", () => {
    const markup = renderHeader();

    expect(markup).toContain("Match results hidden");
    for (const spoiler of ["Hidden Amber", "Hidden Sapphire", "71", "72", "73", "81", "82", "83"]) {
      expect(markup).not.toContain(spoiler);
    }
  });

  it("shows match details after the match is revealed", () => {
    spoilerState.current = { enabled: true, revealed: ["match:spoiler-test"] };
    const markup = renderHeader();

    expect(markup).toContain("Hidden Amber");
    expect(markup).toContain("Hidden Sapphire");
    expect(markup).toContain("71");
    expect(markup).toContain("83");
    expect(markup).not.toContain("Match results hidden");
  });

  it("hides bracket scores and team identity, including tooltip content", () => {
    const markup = renderBracket();

    expect(markup).toContain("Best of 3");
    for (const spoiler of ["Harbor", "Summit", "91", "92"]) {
      expect(markup).not.toContain(spoiler);
    }
  });

  it("hides player leaderboard names and stats", () => {
    const markup = renderLeaderboard();

    expect(markup).not.toContain("Hidden Player");
    expect(markup).not.toContain("Hidden Team");
    expect(markup).not.toContain("999");
  });

  it("hides team names on the weekly match results panel", () => {
    const markup = renderMatchResults();

    expect(markup).toContain("Match results hidden");
    expect(markup).not.toContain("Harbor");
    expect(markup).not.toContain("Summit");
  });
});
