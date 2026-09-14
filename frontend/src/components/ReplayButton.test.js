import { describe, expect, it } from "vitest";
import { resolveReplayOpenUrl } from "./ReplayButton";

describe("resolveReplayOpenUrl", () => {
  it("prefers the direct download URL", () => {
    expect(
      resolveReplayOpenUrl({
        download_url: "https://files.dlns-stats.co.uk/api/public/dl/hash/path",
        share_url: "https://files.dlns-stats.co.uk/share/hash/path/",
      }),
    ).toBe("https://files.dlns-stats.co.uk/api/public/dl/hash/path");
  });

  it("falls back to share URL for legacy payloads", () => {
    expect(
      resolveReplayOpenUrl({
        share_url: "https://files.dlns-stats.co.uk/share/hash/path/",
      }),
    ).toBe("https://files.dlns-stats.co.uk/share/hash/path/");
  });
});
