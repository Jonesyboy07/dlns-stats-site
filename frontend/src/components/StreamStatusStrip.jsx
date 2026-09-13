import React from "react";

/**
 * StreamStatusStrip — slim live/offline banner rendered beneath the site
 * header on every page.
 *
 * Props:
 *   stream    – payload from /db/stream/status. `undefined` while loading,
 *               `null` when the request failed (the strip renders nothing so
 *               it never claims a stream state it does not know).
 *   className – extra wrapper classes; spacing is owned by the caller.
 *
 * When the backend has no Twitch credentials (`configured: false`) this
 * degrades to a neutral "status unavailable" strip rather than claiming the
 * channel is offline.
 */
export default function StreamStatusStrip({ stream, className = "" }) {
  const live = Boolean(stream?.live);
  const configured = stream ? stream.configured : undefined;

  if (stream === null) return null;
  const channelUrl =
    stream?.channel_url || "https://www.twitch.tv/deadlocknightshift";
  const channelName =
    stream?.display_name || stream?.channel || "DeadlockNightShift";

  let label = "Offline";
  // Kept apart from the channel name so the name can be set larger below.
  let statusSuffix = null;
  let message = "Checking stream status…";

  if (configured === false) {
    label = "Status unavailable";
    statusSuffix = "on Twitch";
  } else if (stream && live) {
    label = "Live";
    statusSuffix = "is streaming now";
  } else if (stream) {
    statusSuffix = "isn't streaming right now.";
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-border bg-black/[0.25] px-4 py-2 text-xs sm:text-sm ${className}`}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            live ? "bg-success animate-pulse" : "bg-dim"
          }`}
        />
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-[.12em] ${
            live ? "text-success" : "text-dim"
          }`}
        >
          {label}
        </span>
      </span>

      {statusSuffix ? (
        <span className="flex flex-row items-end text-[12px] gap-x-1 text-muted">
          <a
            href={channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm font-semibold transition-colors hover:underline ${
              live
                ? "text-accent-light hover:text-accent"
                : "text-accent-secondary-light hover:text-accent-secondary"
            }`}
          >
            {channelName}
          </a>{" "}
          {statusSuffix}
                {/* External-link glyph — the conventional "opens in a new tab" sign. */}
      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={
          live
            ? "Watch the stream in a new tab"
            : "Open the Twitch channel in a new tab"
        }
        aria-label={
          live
            ? "Watch the stream on Twitch (opens in a new tab)"
            : "Open the Twitch channel (opens in a new tab)"
        }
        className={`shrink-0 self-center transition-colors ${
          live
            ? "text-accent-light hover:text-accent"
            : "text-accent-secondary-light hover:text-accent-secondary"
        }`}
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 "
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Box with an arrow escaping the top-right corner */}
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
      </a>
        </span>
      ) : (
        <span className="text-[12px] text-muted">{message}</span>
      )}
      

      {live && stream?.viewer_count != null && (
        <span className="hidden sm:inline text-dim">
          · {stream.viewer_count.toLocaleString()} viewers
        </span>
      )}

    </div>
  );
}
