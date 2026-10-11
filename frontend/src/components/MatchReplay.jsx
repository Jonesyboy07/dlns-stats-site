/**
 * The map replay: a playback clock over the per-player trails, so a match can be
 * watched as movement instead of read as a list. P1 puts one dot per player on the map
 * with a transport to play, scrub and change speed; trails behind each dot and the
 * events that appear as the clock reaches them come next.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import MatchMap from "./MatchMap";
import { clock } from "../utils/matchTimeline";
import { mapVersionConfig } from "../utils/matchMap";
import {
  REPLAY_SPEEDS,
  decodeTrail,
  elapsedRows,
  nextTime,
  playerMarkersAt,
  replayDuration,
} from "../utils/replay";

export default function MatchReplay({
  players = [],
  durationS = null,
  version = null,
  rows = [],
  className = "",
}) {
  const trails = useMemo(() => players.map(decodeTrail).filter(Boolean), [players]);
  const endS = useMemo(() => replayDuration(trails, durationS), [trails, durationS]);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const frameRef = useRef(0);

  // The clock advances by real elapsed time rather than a fixed step, so playback keeps
  // pace with the wall clock whatever the frame rate does.
  useEffect(() => {
    if (!playing || endS <= 0) return undefined;
    let previous = null;
    const step = (now) => {
      if (previous !== null) {
        const delta = (now - previous) / 1000;
        setTime((current) => nextTime(current, delta, speed, endS));
      }
      previous = now;
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing, speed, endS]);

  // Stop at the end so the transport offers Play again rather than sitting on pause.
  useEffect(() => {
    if (playing && (endS <= 0 || time >= endS)) setPlaying(false);
  }, [playing, time, endS]);

  if (trails.length === 0) {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        <MatchMap rows={rows} version={version} className="w-full" />
        <p className="text-sm text-dim">Position trails have not been recorded for this match yet.</p>
      </div>
    );
  }

  const markers = playerMarkersAt(trails, time);
  const config = mapVersionConfig(version);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Pressing play at the end replays from the start.
    setTime((current) => (current >= endS ? 0 : current));
    setPlaying(true);
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <MatchMap
        rows={elapsedRows(rows, time)}
        version={version}
        className="w-full"
        caption={
          <p className="text-xs text-dim">
            {config.label} · {trails.length} player{trails.length === 1 ? "" : "s"} tracked
          </p>
        }
      >
        {markers.map((marker) => (
          <span
            key={marker.key}
            title={marker.name}
            aria-label={marker.name}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white/70 shadow-[0_0_6px_rgb(0_0_0/0.9)]"
            style={{
              left: `${marker.left}%`,
              top: `${marker.top}%`,
              backgroundColor:
                marker.team === 1 ? "var(--color-team-sapphire)" : "var(--color-team-amber)",
            }}
          />
        ))}
      </MatchMap>

      <div className="flex w-full max-w-[520px] flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={endS <= 0}
          className="rounded-md border border-border-light bg-card px-3 py-1.5 font-valve-oracle text-sm font-semibold text-primary transition-colors hover:border-accent-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <input
          type="range"
          min={0}
          max={endS}
          step={0.5}
          value={Math.min(time, endS)}
          onChange={(event) => setTime(Number(event.target.value))}
          aria-label="Playback position"
          className="h-1.5 min-w-[140px] flex-1 cursor-pointer"
          style={{ accentColor: "var(--color-accent)" }}
        />

        <span className="font-valve-oracle text-[13px] tabular-nums text-dim">
          {clock(time)} / {clock(endS)}
        </span>

        <span className="flex items-center gap-1">
          {REPLAY_SPEEDS.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => setSpeed(rate)}
              aria-pressed={speed === rate}
              className={`rounded-md px-2 py-1 font-valve-oracle text-[13px] font-semibold tabular-nums transition-colors ${
                speed === rate ? "bg-accent text-white" : "text-dim hover:text-secondary"
              }`}
            >
              {rate}×
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
