import { describe, expect, it } from "vitest";
import { PRIMARY_EVENT, compareEvents, eventOf, eventPrefix } from "./events";

describe("eventOf", () => {
  it("treats an untitled match as the main league", () => {
    expect(eventOf(null)).toBe(PRIMARY_EVENT);
    expect(eventOf("")).toBe(PRIMARY_EVENT);
    expect(eventOf("Fight Night")).toBe("Fight Night");
  });
});

describe("eventPrefix", () => {
  it("uses the known short names", () => {
    expect(eventPrefix("Night Shift")).toBe("NS");
    expect(eventPrefix("Fight Night")).toBe("FN");
    expect(eventPrefix("Night Shift APAC")).toBe("APAC");
    expect(eventPrefix(undefined)).toBe("NS");
  });

  it("falls back to initials, keeping numbers whole", () => {
    expect(eventPrefix("Winter Cup 2")).toBe("WC2");
  });
});

describe("compareEvents", () => {
  it("puts the main league first, then the busiest event", () => {
    const games = { "Fight Night": 3, "Night Shift APAC": 9, "Night Shift": 1 };
    const order = Object.keys(games).sort((a, b) => compareEvents(a, b, games));
    expect(order).toEqual(["Night Shift", "Night Shift APAC", "Fight Night"]);
  });
});
