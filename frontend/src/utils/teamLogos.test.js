import { describe, expect, it } from "vitest";
import {
  TEAM_LOGO_BASE,
  TEAM_LOGO_FALLBACK,
  teamLogoKey,
  teamLogoUrl,
} from "./teamLogos";

describe("teamLogoKey", () => {
  it("lowercases and drops whitespace, so casing variants collapse", () => {
    expect(teamLogoKey("ABRAHAMS")).toBe("abrahams");
    expect(teamLogoKey("Abrahams")).toBe("abrahams");
    expect(teamLogoKey("aBRAHAMS")).toBe("abrahams");
    expect(teamLogoKey("MELEE CREEPS")).toBe("meleecreeps");
    expect(teamLogoKey("Bird With Clock")).toBe("birdwithclock");
  });

  it("spells out ampersands, matching the backend's _icon_key()", () => {
    expect(teamLogoKey("Mo & Krill")).toBe("moandkrill");
  });

  it("drops punctuation the feed uses inconsistently", () => {
    expect(teamLogoKey("ANJOKI'S GOONS")).toBe("anjokisgoons");
    expect(teamLogoKey("POPPERS' PUPILS")).toBe("popperspupils");
    expect(teamLogoKey("Virtus.pro")).toBe("virtuspro");
    expect(teamLogoKey("feelings=off feeding=on")).toBe("feelingsofffeedingon");
    expect(teamLogoKey("VANGUARD GAMING")).toBe("vanguardgaming");
  });

  it("folds the apostrophe split on SLICE N DICE into one file", () => {
    expect(teamLogoKey("SLICE N DICE")).toBe("slicendice");
    expect(teamLogoKey("SLICE 'N DICE")).toBe("slicendice");
  });

  it("keeps leading digits", () => {
    expect(teamLogoKey("1win Team")).toBe("1winteam");
    expect(teamLogoKey("c2")).toBe("c2");
  });

  it("is empty for missing input", () => {
    expect(teamLogoKey(null)).toBe("");
    expect(teamLogoKey(undefined)).toBe("");
    expect(teamLogoKey("")).toBe("");
    expect(teamLogoKey("  ")).toBe("");
  });
});

describe("teamLogoUrl", () => {
  it("joins the base and the key with a .png extension", () => {
    expect(teamLogoUrl("MELEE CREEPS")).toBe(`${TEAM_LOGO_BASE}/meleecreeps.png`);
    expect(teamLogoUrl("KASTALIA")).toBe(`${TEAM_LOGO_BASE}/kastalia.png`);
  });

  it("resolves every spelling of a team to one file", () => {
    const variants = ["ABRAHAMS", "Abrahams", "abrahams", "aBRAHAMS"];
    const urls = new Set(variants.map(teamLogoUrl));
    expect(urls.size).toBe(1);
    expect([...urls][0]).toBe(`${TEAM_LOGO_BASE}/abrahams.png`);
  });

  it("falls back to default.jpg when there is no name to key on", () => {
    expect(teamLogoUrl(null)).toBe(TEAM_LOGO_FALLBACK);
    expect(teamLogoUrl("")).toBe(TEAM_LOGO_FALLBACK);
    expect(teamLogoUrl("   ")).toBe(TEAM_LOGO_FALLBACK);
  });

  it("uses a .jpg fallback, unlike the per-team files", () => {
    expect(TEAM_LOGO_FALLBACK.endsWith("/default.jpg")).toBe(true);
    expect(teamLogoUrl("ABRAHAMS").endsWith(".png")).toBe(true);
  });

  it("never leaves a double slash when the base ends in one", () => {
    expect(TEAM_LOGO_BASE.endsWith("/")).toBe(false);
    // Strip the scheme first — "https://" obviously contains "//".
    const withoutScheme = teamLogoUrl("ABRAHAMS").replace(/^https?:\/\//, "");
    expect(withoutScheme).not.toContain("//");
  });
});
