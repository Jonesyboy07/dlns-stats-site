import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("published CDN assets", () => {
  it("uses hashed image URLs and retains the legacy fallback", async () => {
    vi.stubGlobal("window", {
      DLNS_SITE_ASSETS: { "images/logo.png": "https://cdn.example/logo.hash.png" },
    });
    const { cdnImage, IMAGE_CDN_BASE } = await import("./cdn");
    expect(cdnImage("logo.png")).toBe("https://cdn.example/logo.hash.png");
    expect(cdnImage("missing.png")).toBe(`${IMAGE_CDN_BASE}/missing.png`);
  });

  it("uses a published crest only when no custom crest host is configured", async () => {
    vi.stubGlobal("window", {
      DLNS_TEAM_LOGO_BASE: "https://cdn.dlns-stats.co.uk/public/images/teamLogos",
      DLNS_SITE_ASSETS: { "images/teamLogos/meleecreeps.png": "https://cdn.example/crest.hash.png" },
    });
    const { teamLogoUrl } = await import("./teamLogos");
    expect(teamLogoUrl("MELEE CREEPS")).toBe("https://cdn.example/crest.hash.png");
  });

  it("preserves an explicitly configured crest host", async () => {
    vi.stubGlobal("window", {
      DLNS_TEAM_LOGO_BASE: "https://custom.example/crests",
      DLNS_SITE_ASSETS: {
        "images/teamLogos/meleecreeps.png": "https://cdn.example/crest.hash.png",
        "images/teamLogos/default.jpg": "https://cdn.example/default.hash.jpg",
      },
    });
    const { teamLogoUrl, TEAM_LOGO_FALLBACK } = await import("./teamLogos");
    expect(teamLogoUrl("MELEE CREEPS")).toBe("https://custom.example/crests/meleecreeps.png");
    expect(TEAM_LOGO_FALLBACK).toBe("https://custom.example/crests/default.jpg");
  });
});
