/**
 * The timeline's header: the section title, the running scoreline at the current
 * second, and the share button.
 *
 * The kills shown are up to the clock rather than the final result, so scrubbing
 * through a match reads as a scoreboard filling in.
 */

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import { clock, matchTimeParam } from "../utils/matchTimeline";
import { TEAM_STROKE } from "../utils/matchTimelineMap";

/** How long the button says "Copied" before going back to offering the link. */
const COPIED_MS = 1600;

export default function TimelineHeader({
  teamNames = [],
  scores = { 0: 0, 1: 0 },
  t = 0,
  durationS = null,
  className = "",
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("t", matchTimeParam(t));
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      // The clipboard is unavailable over plain http or when the browser denies it.
      // Leave the button alone rather than claiming a copy that did not happen.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}>
      <span className="font-valve-oracle text-[15px] font-semibold uppercase tracking-[0.08em] text-secondary">
        Timeline
      </span>

      <div className="flex items-center gap-2.5 sm:gap-3">
        <span className="text-xs font-semibold" style={{ color: TEAM_STROKE[0] }}>
          {teamNames[0] || "Amber"}
        </span>
        <span className="font-valve-pulp text-[30px] font-bold leading-none" style={{ color: TEAM_STROKE[0] }}>
          {scores[0] ?? 0}
        </span>
        <span className="font-valve-oracle text-[13px] tabular-nums text-dim">
          {clock(t)} / {clock(durationS)}
        </span>
        <span className="font-valve-pulp text-[30px] font-bold leading-none" style={{ color: TEAM_STROKE[1] }}>
          {scores[1] ?? 0}
        </span>
        <span className="text-xs font-semibold" style={{ color: TEAM_STROKE[1] }}>
          {teamNames[1] || "Sapphire"}
        </span>
      </div>

      <Button size="xs" onClick={copyLink} title="Copy a link that opens at this moment">
        {copied ? `Copied ?t=${matchTimeParam(t)}` : `Copy link at ${clock(t)}`}
      </Button>
    </div>
  );
}
