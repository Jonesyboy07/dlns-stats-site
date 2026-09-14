import { describe, expect, it } from "vitest";
import { resolveReplayLookupState, resolveReplayOpenUrl } from "./ReplayButton";

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

  it("returns undefined when no link exists", () => {
    expect(resolveReplayOpenUrl({})).toBeUndefined();
    expect(resolveReplayOpenUrl()).toBeUndefined();
  });
});

describe("resolveReplayLookupState", () => {
  it("returns an available replay state for successful preloads", () => {
    expect(
      resolveReplayLookupState(
        { ok: true, status: 200 },
        {
          ok: true,
          replay: {
            name: "123.zip",
            download_url: "https://files.example/123.zip",
          },
        },
      ),
    ).toEqual({
      status: "available",
      message: "Replay ready: 123.zip",
      openUrl: "https://files.example/123.zip",
    });
  });

  it("returns a notfound state when the replay is missing", () => {
    expect(
      resolveReplayLookupState(
        { ok: false, status: 404 },
        {
          ok: false,
          found: false,
          message: "Replay was not found in replay_storage for this match ID.",
        },
      ),
    ).toEqual({
      status: "notfound",
      message: "Replay was not found in replay_storage for this match ID.",
      openUrl: "",
    });
  });

  it("returns a configuration error state for 503 responses", () => {
    expect(resolveReplayLookupState({ ok: false, status: 503 }, null)).toEqual({
      status: "error",
      message: "Replay storage is not configured.",
      openUrl: "",
    });
  });

  it("returns an opened replay state for successful clicks", () => {
    expect(
      resolveReplayLookupState(
        { ok: true, status: 200 },
        {
          ok: true,
          replay: {
            name: "123.zip",
            download_url: "https://files.example/123.zip",
          },
        },
        { opened: true },
      ),
    ).toEqual({
      status: "opened",
      message: "Started download for 123.zip",
      openUrl: "https://files.example/123.zip",
    });
  });

  it("returns a generic error state for other failures", () => {
    expect(
      resolveReplayLookupState(
        { ok: false, status: 500 },
        {
          ok: false,
          message: "Replay lookup exploded.",
        },
      ),
    ).toEqual({
      status: "error",
      message: "Replay lookup exploded.",
      openUrl: "",
    });
  });
});
