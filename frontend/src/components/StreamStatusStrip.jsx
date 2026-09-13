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
  let message = "Checking stream status…";

  if (configured === false) {
    label = "Status unavailable";
    message = `${channelName} on Twitch`;
  } else if (stream && live) {
    label = "Live";
    message = `${channelName} is streaming now`;
  } else if (stream) {
    message = `${channelName} isn't streaming right now.`;
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-border bg-white/[0.02] px-4 py-2 text-xs sm:text-sm ${className}`}
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

      <span className="text-muted">{message}</span>

      {live && stream?.viewer_count != null && (
        <span className="hidden sm:inline text-dim">
          · {stream.viewer_count.toLocaleString()} viewers
        </span>
      )}

      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`shrink-0 font-semibold transition-colors ${
          live
            ? "text-accent-light hover:text-accent"
            : "text-accent-secondary-light hover:text-accent-secondary"
        }`}
      >
        {live ? "Watch now →" : "Visit the channel →"}
      </a>
    </div>
  );
}
