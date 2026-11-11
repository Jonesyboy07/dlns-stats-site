import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlayerLeaderboard from "./PlayerLeaderboard";

const spoilerState = vi.hoisted(() => ({
  current: { enabled: false, revealed: [] },
}));

vi.mock("../../spoilers/spoilerStore", () => ({
  useSpoilerState: () => spoilerState.current,
  revealSpoiler: vi.fn(),
  hideSpoiler: vi.fn(),
}));

vi.mock("../HeroIcon", () => ({ default: () => null }));

const renderLeaderboard = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PlayerLeaderboard
        statKey="k"
        onStatChange={() => {}}
        subline="Most kills"
        rows={[
          {
            accountId: 7,
            rank: 1,
            hero: "Infernus",
            name: "Player One",
            team: "Team One",
            value: 15,
            side: 0,
            matchId: 121085991,
            durationS: 2143,
          },
        ]}
        total={1}
        expanded={false}
        onToggle={() => {}}
      />
    </MemoryRouter>,
  );

describe("PlayerLeaderboard", () => {
  beforeEach(() => {
    spoilerState.current = { enabled: false, revealed: [] };
  });

  it("keeps the row grid wrapper when spoiler-free mode is off", () => {
    const markup = renderLeaderboard();

    // The rank must be the first cell of a grid row, not an inline span that
    // stacks above the player name.
    expect(markup).toMatch(/<div class="relative grid[^"]*"><span class="font-valve-pulp/);
    expect(markup).toContain("Player One");
    expect(markup).toContain("15");
    expect(markup).toContain("Game #121085991");
  });

  it("keeps the styled row while the stats are hidden", () => {
    spoilerState.current = { enabled: true, revealed: [] };
    const markup = renderLeaderboard();

    expect(markup).toContain("Player stats hidden");
    expect(markup).toMatch(/<div class="relative grid[^"]*"><div/);
    expect(markup).not.toContain("Player One");
    expect(markup).not.toContain("121085991");
  });
});
