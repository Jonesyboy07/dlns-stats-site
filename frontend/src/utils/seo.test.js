import { describe, expect, it } from "vitest";
import { breadcrumbsForPath, canonicalPathFor, routeMetaFor } from "./seo";

describe("canonicalPathFor", () => {
  it("folds aliases and trailing slashes into the advertised URL", () => {
    expect(canonicalPathFor("/home")).toBe("/");
    expect(canonicalPathFor("/match/123")).toBe("/matches/123");
    expect(canonicalPathFor("/users/42")).toBe("/player/42");
    expect(canonicalPathFor("/stats/")).toBe("/stats/");
    expect(canonicalPathFor("/stats")).toBe("/stats/");
    expect(canonicalPathFor("/interviews")).toBe("/interviews/");
    expect(canonicalPathFor("/")).toBe("/");
  });

  it("leaves already-canonical paths untouched", () => {
    expect(canonicalPathFor("/matches/123")).toBe("/matches/123");
    expect(canonicalPathFor("/player/42/hero/7")).toBe("/player/42/hero/7");
    expect(canonicalPathFor("/team/Melee%20Creeps")).toBe("/team/Melee%20Creeps");
  });
});

describe("routeMetaFor", () => {
  it("returns unique static metadata", () => {
    expect(routeMetaFor("/heroes").title).toContain("Hero Stats");
    expect(routeMetaFor("/players").title).toContain("Player Stats");
    expect(routeMetaFor("/heroes").title).not.toBe(routeMetaFor("/players").title);
  });

  it("marks search and admin routes noindex", () => {
    expect(routeMetaFor("/search").robots).toBe("noindex, follow");
    expect(routeMetaFor("/react-admin").robots).toBe("noindex, follow");
    expect(routeMetaFor("/players").robots).toBe("index, follow");
  });

  it("builds fallbacks for dynamic routes", () => {
    expect(routeMetaFor("/matches/123").canonicalPath).toBe("/matches/123");
    expect(routeMetaFor("/match/123").canonicalPath).toBe("/matches/123");
    expect(routeMetaFor("/player/42/hero/7").title).toBe("Player Hero Stats");
    expect(routeMetaFor("/team/Melee%20Creeps").title).toBe("Melee Creeps Team Stats");
    expect(routeMetaFor("/week/59").title).toBe("Night Shift Week 59");
  });

  it("supplies breadcrumbs for structured data on navigation", () => {
    const player = routeMetaFor("/player/42");
    expect(player.breadcrumbs.map((item) => item.name)).toEqual([
      "Home",
      "Players",
      "Player 42",
    ]);
    expect(player.breadcrumbs.at(-1).path).toBe("/player/42");
    expect(routeMetaFor("/").breadcrumbs).toEqual([]);
  });
});

describe("breadcrumbsForPath", () => {
  it("builds hierarchical trails for detail pages", () => {
    expect(breadcrumbsForPath("/hero/1").map((item) => item.name)).toEqual([
      "Home",
      "Heroes",
      "Hero 1",
    ]);
    expect(breadcrumbsForPath("/week/59").map((item) => item.name)).toEqual([
      "Home",
      "Night Shift weeks",
      "Week 59",
    ]);
    expect(breadcrumbsForPath("/team/Melee%20Creeps").map((item) => item.name)).toEqual([
      "Home",
      "Teams",
      "Melee Creeps",
    ]);
    expect(breadcrumbsForPath("/match/42")[1].path).toBe("/matches/42");
  });
});
