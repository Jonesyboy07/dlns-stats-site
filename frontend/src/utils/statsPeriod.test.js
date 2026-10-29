import { describe, expect, it } from "vitest";
import {
  clampRange,
  defaultRange,
  formatSignedDuration,
  formatSignedNumber,
  formatWeeksParam,
  matchesInRange,
  parseWeeksParam,
  patchLabel,
  periodPresets,
  rangeDetail,
  shortPatchName,
  weeksLabel,
} from "./statsPeriod";

const weeks = [54, 55, 56, 57, 58, 59, 60, 61].map((week) => ({
  week,
  matches: week === 61 ? 7 : 10,
  regions: { EU: week === 61 ? 7 : 6, NA: week === 61 ? 0 : 4 },
}));

const patches = [
  { name: "Gameplay Update 09-17", start_week: 54, end_week: 54 },
  { name: "Gameplay Update 10-02", start_week: 55, end_week: 59 },
  { name: "City Never Sleeps", start_week: 60, end_week: 61 },
];

describe("week param", () => {
  it("parses ranges and single weeks and rejects junk", () => {
    expect(parseWeeksParam("60-61")).toEqual([60, 61]);
    expect(parseWeeksParam("61-60")).toEqual([60, 61]);
    expect(parseWeeksParam("61")).toEqual([61, 61]);
    expect(parseWeeksParam("abc")).toBeNull();
    expect(parseWeeksParam(null)).toBeNull();
  });

  it("round-trips through the URL form", () => {
    expect(formatWeeksParam([60, 61])).toBe("60-61");
    expect(formatWeeksParam([61, 61])).toBe("61");
  });

  it("defaults to the latest two weeks and clamps to the weeks that exist", () => {
    expect(defaultRange(weeks)).toEqual([60, 61]);
    expect(clampRange([1, 99], weeks)).toEqual([54, 61]);
    expect(clampRange(null, weeks)).toEqual([60, 61]);
  });
});

describe("labels", () => {
  it("names the weeks", () => {
    expect(weeksLabel([54, 61], weeks)).toBe("All weeks");
    expect(weeksLabel([61, 61], weeks)).toBe("Week 61");
    expect(weeksLabel([60, 61], weeks)).toBe("Weeks 60–61");
  });

  it("names the patch, a part of one, or a count", () => {
    expect(patchLabel([60, 61], weeks, patches)).toBe("City Never Sleeps");
    expect(patchLabel([61, 61], weeks, patches)).toBe("City Never Sleeps (part)");
    expect(patchLabel([58, 61], weeks, patches)).toBe("2 patches");
    expect(patchLabel([54, 61], weeks, patches)).toBe("All patches");
  });

  it("describes the range in the picker footer", () => {
    expect(rangeDetail([60, 61], patches)).toBe("Exactly the City Never Sleeps patch");
    expect(rangeDetail([56, 57], patches)).toBe("Part of Gameplay Update 10-02 (weeks 55–59)");
    expect(rangeDetail([58, 61], patches)).toBe("Spans 2 patches: Gameplay Update 10-02, City Never Sleeps");
    expect(rangeDetail([61, 61], patches, { pending: true })).toBe(
      "Part of City Never Sleeps (weeks 60–61) · now pick an end week",
    );
    const many = [...patches, { name: "Later", start_week: 62, end_week: 63 }];
    expect(rangeDetail([54, 63], many)).toBe("Spans 4 patches: Gameplay Update 09-17 → Later");
  });

  it("strips the Gameplay Update prefix from band labels only", () => {
    expect(shortPatchName("Gameplay Update 10-02")).toBe("10-02");
    expect(shortPatchName("City Never Sleeps")).toBe("City Never Sleeps");
  });
});

describe("counts and presets", () => {
  it("counts matches overall and per region", () => {
    expect(matchesInRange([60, 61], weeks)).toBe(17);
    expect(matchesInRange([60, 61], weeks, "EU")).toBe(13);
    expect(matchesInRange([61, 61], weeks, "NA")).toBe(0);
  });

  it("offers presets without duplicates", () => {
    expect(periodPresets(weeks).map((p) => [p.label, p.range])).toEqual([
      ["All weeks", [54, 61]],
      ["Latest week", [61, 61]],
      ["Last 4 weeks", [58, 61]],
    ]);
  });
});

describe("signed changes", () => {
  it("uses a real minus sign and ± for no change", () => {
    expect(formatSignedNumber(1)).toBe("+1");
    expect(formatSignedNumber(-24)).toBe("−24");
    expect(formatSignedNumber(0)).toBe("±0");
    expect(formatSignedDuration(223)).toBe("+3:43");
    expect(formatSignedDuration(-65)).toBe("−1:05");
    expect(formatSignedDuration(null)).toBeNull();
  });
});
