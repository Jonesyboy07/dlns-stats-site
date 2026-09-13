import React from "react";
import Widget from "./Widget";

/**
 * Format a schedule start time as "Friday, 20:00 UTC".
 * Times are shown in UTC so the label is the same for every visitor.
 */
function formatNextStream(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const day = date.toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${day}, ${time} UTC`;
}

/**
 * StreamWidget — sidebar summary of the Twitch channel.
 *
 * Props:
 *   stream – payload from /db/stream/status, or null while it is still loading.
 */
export default function StreamWidget({ stream }) {
  const live = Boolean(stream?.live);
  const configured = stream ? stream.configured : undefined;
  const channelUrl =
    stream?.channel_url || "https://www.twitch.tv/deadlocknightshift";
  const channelName =
    stream?.display_name || stream?.channel || "DeadlockNightShift";
  const nextStream = formatNextStream(stream?.next_stream?.start_time);
  const statusLabel = live
    ? "Live"
    : configured === false
      ? "Status unavailable"
      : "Offline";

  return (
    <Widget
      title="Stream"
      className={live ? "border-success-border" : undefined}
    >
      <div className="flex items-center gap-2">
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
          {statusLabel}
        </span>
        <span className="text-sm font-semibold text-primary truncate">
          {channelName}
        </span>
      </div>

      {live ? (
        <>
          {stream?.title && (
            <p className="mt-2 text-xs text-muted leading-relaxed line-clamp-2">
              {stream.title}
            </p>
          )}
          {stream?.viewer_count != null && (
            <p className="mt-1 text-xs text-dim">
              {stream.viewer_count.toLocaleString()} viewers
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs text-muted leading-relaxed">
          {configured === false
            ? "Live status isn't connected yet — head over to the channel to see what's on."
            : nextStream
              ? `Next stream ${nextStream}.`
              : "No stream scheduled right now — follow the channel for updates."}
        </p>
      )}

      {!live && configured !== false && nextStream && stream?.next_stream?.title && (
        <p className="mt-1 text-xs text-dim line-clamp-2">
          {stream.next_stream.title}
        </p>
      )}

      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-xs font-semibold text-accent-secondary-light hover:text-accent-secondary transition-colors"
      >
        {live ? "Watch now →" : "Watch channel →"}
      </a>
    </Widget>
  );
}
