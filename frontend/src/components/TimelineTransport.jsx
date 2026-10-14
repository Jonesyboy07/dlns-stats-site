/**
 * The timeline's playback transport: play/pause, the clock, the speed, and the scrubber.
 *
 * It sits directly under the map because the map is what is being watched while the clock
 * runs. There is only one transport for the whole tab -- the lanes draw their own playhead
 * from the same clock rather than owning a second one, so the two cannot drift.
 */

import Button from "./Button";
import SegmentedControl from "./SegmentedControl";
import { clock } from "../utils/matchTimeline";
import { PLAYBACK_SPEEDS } from "../utils/matchTimelineLanes";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }));

export default function TimelineTransport({
  t = 0,
  durationS = null,
  playing = false,
  speed = 1,
  onTogglePlay = null,
  onSeek = null,
  onSpeed = null,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-border-light bg-card px-3 py-2.5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {onTogglePlay && (
          <Button onClick={onTogglePlay} disabled={!durationS}>
            {playing ? "Pause" : "Play"}
          </Button>
        )}
        <span className="font-valve-oracle text-[13px] tabular-nums text-muted">
          {clock(t)} / {clock(durationS)}
        </span>
        {onSpeed && (
          <SegmentedControl
            className="ml-auto"
            label="Speed"
            options={SPEED_OPTIONS}
            value={speed}
            onChange={onSpeed}
          />
        )}
      </div>

      <input
        type="range"
        min={0}
        max={durationS ?? 0}
        step={1}
        value={Math.round(t ?? 0)}
        onChange={(event) => onSeek?.(Number(event.target.value))}
        aria-label="Match time"
        className="w-full"
        style={{ accentColor: "var(--color-accent)" }}
      />
    </div>
  );
}
