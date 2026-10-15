/**
 * The laning tab's transport: play/pause, the scrubber with its kill markers, the clock
 * and the speed buttons.
 *
 * The clock itself lives in `LaningTab` -- this bar only reports what the reader asked
 * for, so the map, the feed and the build table can never disagree with the scrubber.
 * Dragging continues outside the bar (the pointer is followed on the window) because a
 * scrub that stops the moment the cursor leaves a 6px track is unusable.
 */

import { useEffect, useRef, useState } from "react";
import Button from "../Button";
import { clock } from "../../utils/matchTimeline";
import { LANING_SPEEDS, laningPercent, laningScrubTime } from "../../utils/laningTab";

const TEAM_FILL = {
  0: "var(--color-team-amber)",
  1: "var(--color-team-sapphire)",
};

export default function LaningPlaybackBar({
  time = 0,
  endS,
  playing = false,
  speed = 1,
  ticks = [],
  onTogglePlay = null,
  onSeek = null,
  onSpeed = null,
  className = "",
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const seekRef = useRef(null);

  const seekTo = (clientX) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;
    onSeek?.(laningScrubTime((clientX - rect.left) / rect.width, endS));
  };
  seekRef.current = seekTo;

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event) => seekRef.current?.(event.clientX);
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging]);

  const played = laningPercent(time, endS);

  return (
    <div
      className={`flex flex-wrap items-center gap-5 rounded-xl border border-border-light bg-card px-5 py-3 shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] ${className}`}
    >
      <Button onClick={onTogglePlay} disabled={!endS}>
        {playing ? "Pause" : "Play"}
      </Button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Laning time"
        aria-valuemin={0}
        aria-valuemax={Math.round(endS ?? 0)}
        aria-valuenow={Math.round(time ?? 0)}
        aria-valuetext={clock(time)}
        onPointerDown={(event) => {
          setDragging(true);
          seekTo(event.clientX);
        }}
        onKeyDown={(event) => {
          // Arrow keys step a second at a time, so the bar works without a pointer too.
          const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          if (!step) return;
          event.preventDefault();
          onSeek?.(Math.min(Math.max((time ?? 0) + step, 0), endS ?? 0));
        }}
        className="relative flex h-7 min-w-[140px] flex-1 cursor-pointer touch-none items-center"
      >
        <div className="relative h-1.5 w-full rounded-full bg-hover">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${played}%` }}
          />
          {ticks.map((tick) => (
            <span
              key={tick.id}
              aria-hidden="true"
              className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 rounded-[1px]"
              style={{
                left: `${tick.left}%`,
                backgroundColor: TEAM_FILL[tick.team] ?? "#94a3b8",
                opacity: tick.inLane ? 0.9 : 0.2,
              }}
            />
          ))}
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent-light shadow-[0_0_0_1px_var(--color-accent-border-strong)]"
          style={{ left: `${played}%` }}
        />
      </div>

      <span className="min-w-[92px] text-right font-valve-oracle text-[13px] font-semibold tabular-nums text-muted">
        {clock(time)} / {clock(endS)}
      </span>

      <div className="flex gap-1.5">
        {LANING_SPEEDS.map((rate) => (
          <Button
            key={rate}
            size="xs"
            variant={rate === speed ? "accent" : "primary"}
            aria-pressed={rate === speed}
            onClick={() => onSpeed?.(rate)}
          >
            {rate}×
          </Button>
        ))}
      </div>
    </div>
  );
}
