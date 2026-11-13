import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SeriesRow from "./SeriesRow";

vi.mock("../../spoilers/spoilerStore", () => ({
  useSpoilerState: () => ({ enabled: false, revealed: [] }),
  revealSpoiler: vi.fn(),
  hideSpoiler: vi.fn(),
}));

const entry = (overrides = {}) => ({
  eventTitle: "Night Shift",
  week: 61,
  series_title: "Finals",
  team_a: "Abrahams",
  team_b: "Leviathan",
  wins_a: 2,
  wins_b: 0,
  games: [
    { matchId: 900001, game: 1 },
    { matchId: 900002, game: 2 },
  ],
  firstMatchId: 900001,
  vod_url: "",
  ...overrides,
});

const render = (value) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <SeriesRow entry={value} />
    </MemoryRouter>,
  );

describe("SeriesRow links", () => {
  it("points 'View game 1' at the first game", () => {
    const html = render(entry());
    expect(html).toContain("View game 1");
    expect(html).toContain('href="/match/900001"');
  });

  it("links each played game", () => {
    const html = render(entry());
    expect(html).toContain('href="/match/900002"');
    expect(html).toMatch(/title="Open game 2"/);
  });

  /* N/A and forfeit games are filed under negative placeholder IDs, which the
     match routes cannot serve -- a link there would 404. */
  it("sends a series whose game 1 is a placeholder to its week", () => {
    const html = render(
      entry({ games: [{ matchId: -791232009000, game: 1 }], firstMatchId: -791232009000 }),
    );
    expect(html).toContain("View week");
    expect(html).toContain(`href="/week/61?event_title=Night%20Shift"`);
    expect(html).not.toContain('href="/match/-');
  });

  it("shows a placeholder game as a score, not a link", () => {
    const html = render(entry({ games: [{ matchId: -123, game: 1 }, { matchId: 900002, game: 2 }] }));
    expect(html).not.toContain('href="/match/-123"');
    expect(html).toContain('title="Game 1 has no match page"');
    expect(html).toContain('href="/match/900002"');
  });
});
