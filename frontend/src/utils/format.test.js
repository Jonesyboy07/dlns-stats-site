import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatDurationDelta,
  formatKda,
  formatPercent,
  formatRecord,
} from "./format";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(1873)).toBe("31:13");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("pads the seconds component", () => {
    expect(formatDuration(2465)).toBe("41:05");
  });

  it("returns null for unknown values", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });
});

describe("formatDurationDelta", () => {
  it("adds a plus sign when the team is faster than the baseline", () => {
    expect(formatDurationDelta(580)).toBe("+9:40");
  });

  it("keeps the minus sign when the team is slower", () => {
    expect(formatDurationDelta(-125)).toBe("-2:05");
  });

  it("returns null for unknown values", () => {
    expect(formatDurationDelta(null)).toBeNull();
  });
});

describe("formatRecord", () => {
  it("renders wins-losses", () => {
    expect(formatRecord(15, 4)).toBe("15-4");
    expect(formatRecord(0, 0)).toBe("0-0");
  });

  it("treats missing values as zero", () => {
    expect(formatRecord(undefined, undefined)).toBe("0-0");
  });
});

describe("formatPercent", () => {
  it("rounds to whole numbers by default", () => {
    expect(formatPercent(78)).toBe("78%");
    expect(formatPercent(77.6)).toBe("78%");
  });

  it("supports decimal places", () => {
    expect(formatPercent(32.14, 1)).toBe("32.1%");
  });

  it("returns null when there is no value", () => {
    expect(formatPercent(null)).toBeNull();
  });
});

describe("formatKda", () => {
  it("always shows two decimals", () => {
    expect(formatKda(11.41)).toBe("11.41");
    expect(formatKda(4)).toBe("4.00");
  });

  it("returns null when there is no value", () => {
    expect(formatKda(null)).toBeNull();
  });
});
