/**
 * The timeline's header: the section title, the scoreline at the current second, the
 * soul lead, the share button -- and the turning points that let a reader jump to the
 * moments the match turned.
 *
 * Kills, souls, alive counts, the lead and the tug bar all read the same second, so
 * scrubbing reads as a scoreboard filling in rather than as a summary of the result.
 * Everything is null-tolerant: a match without soul snapshots loses the souls line,
 * the lead and the tug bar, and the turning-point row explains why.
 *
 * Spoiler-safe is the site-wide spoiler setting, not a separate switch: with it on the
 * turning points stay hidden behind a "Show anyway" button, because a chip naming the
 * team that came back is the result.
 */

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import { clock, matchTimeParam } from "../utils/matchTimeline";
import { EVEN_LEAD_SOULS } from "../utils/matchTimelineModel";
import { formatCompact } from "../utils/format";
import { TEAM_STROKE, TEAM_TEXT } from "../utils/matchTimelineMap";

/** How long the button says "Copied" before going back to offering the link. */
const COPIED_MS = 1600;

/** A turning point stays lit while the playhead is inside it, plus this grace. */
const TURNING_POINT_ACTIVE_GRACE_S = 30;

const LABEL = "font-valve-oracle text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";
const MONO = "tabular-nums";

/** One side of the score row: name, souls + alive, and the kill score. */
function TeamScore({ team, teamName, kills, souls, alive, soulsEnabled = true, align = "left" }) {
  const color = TEAM_TEXT[team];
  const soulsText = souls == null ? "— souls" : `${formatCompact(souls)} souls`;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <span className="truncate text-[15px] font-semibold" style={{ color }}>
        {teamName}
      </span>
      <span className={`text-[12px] text-muted ${MONO}`}>
        {soulsEnabled ? `${soulsText} · ` : ""}
        {alive ?? 0} alive
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-valve-pulp text-[44px] font-bold leading-none" style={{ color }}>
          {kills ?? 0}
        </span>
        <span className={LABEL}>Kills</span>
      </span>
    </div>
  );
}

/**
 * The tug bar: a 240px track whose fill grows from the centre towards the side that is
 * ahead, scaled so the biggest lead in the match fills half the bar.
 */
function TugBar({ lead, scale, teamNames }) {
  const share = Math.min(100, (Math.abs(lead) / Math.max(scale, 1)) * 100);
  const leader = lead > 0 ? 0 : 1;
  return (
    <div
      className="relative h-1.5 w-[240px] overflow-hidden rounded-full bg-panel"
      title={`${teamNames[leader] || (leader === 0 ? "Amber" : "Sapphire")} soul lead`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-border-lighter" />
      <span
        className="absolute inset-y-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none"
        style={{
          width: `${share / 2}%`,
          left: leader === 0 ? `${50 - share / 2}%` : "50%",
          backgroundColor: TEAM_STROKE[leader],
        }}
      />
    </div>
  );
}

/** One turning point: when, how big, and who came out ahead. */
function TurningPointChip({ point, active, teamName, onSelect, onHover }) {
  const color = TEAM_STROKE[point.team] ?? "#94a3b8";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect?.(point)}
      onMouseEnter={onHover ? () => onHover(point) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocus={onHover ? () => onHover(point) : undefined}
      onBlur={onHover ? () => onHover(null) : undefined}
      title={`Soul lead swung ${formatCompact(point.swingSouls)} to ${teamName} between ${clock(point.startS)} and ${clock(point.endS)}`}
      className={`flex h-[30px] items-center gap-2 rounded-full border py-0 pl-2.5 pr-3 text-[12px] transition-colors ${
        active
          ? "border-accent-border-strong bg-accent-bg-strong"
          : "border-border-light bg-card hover:border-border-lighter"
      }`}
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className={`text-muted ${MONO}`}>{clock(point.endS)}</span>
      <span className="font-semibold text-primary">+{formatCompact(point.swingSouls)} swing</span>
      <span className="font-semibold" style={{ color: TEAM_TEXT[point.team] ?? color }}>
        to {teamName}
      </span>
    </button>
  );
}

export default function TimelineHeader({
  teamNames = [],
  scores = { 0: 0, 1: 0 },
  souls = null,
  lead = null,
  maxLead = 0,
  alive = [0, 0],
  t = 0,
  durationS = null,
  meta = null,
  turningPoints = [],
  spoilerSafe = false,
  onToggleSpoiler = null,
  onSelectTurningPoint = null,
  onHoverTurningPoint = null,
  soulsEnabled = true,
  className = "",
}) {
  const [copied, setCopied] = useState(false);
  const [chipsRevealed, setChipsRevealed] = useState(false);
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

  const teamName = (team) => teamNames[team] || (team === 0 ? "Amber" : "Sapphire");

  // The bar is scaled to the biggest lead the match ever had, so a chip and the bar
  // agree about what "a big swing" means.
  const scale = Math.max(maxLead, 1);
  const even = lead == null || Math.abs(lead) < EVEN_LEAD_SOULS;
  const leader = even ? null : lead > 0 ? 0 : 1;
  const chipsHidden = spoilerSafe && !chipsRevealed;
  // With souls switched off (TIMELINE_SOULS_ENABLED) the souls, the lead, the tug bar and
  // the turning points -- all derived from souls -- are left blank rather than explained.
  const showTurningPoints = soulsEnabled && (turningPoints.length > 0 || souls == null);

  return (
    <div className={`rounded-lg border border-border bg-table px-4 py-3.5 ${className}`}>
      {/* Section label, match meta and the two actions. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={LABEL}>Timeline</span>
        {meta ? <span className={`text-[12px] text-muted ${MONO}`}>{meta}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {onToggleSpoiler ? (
            <Button
              size="xs"
              variant="ghost"
              aria-pressed={spoilerSafe}
              onClick={() => onToggleSpoiler(!spoilerSafe)}
              title={
                spoilerSafe
                  ? "Spoiler-safe is on: turning points stay hidden until revealed"
                  : "Turn spoiler-safe on to hide results while you watch the match play out"
              }
            >
              Spoiler-safe: {spoilerSafe ? "on" : "off"}
            </Button>
          ) : null}
          <Button size="xs" onClick={copyLink} title="Copy a link that opens at this moment">
            {copied ? `Copied ?t=${matchTimeParam(t)}` : `Copy link at ${clock(t)}`}
          </Button>
        </div>
      </div>

      {/* The scoreline, the lead and the tug bar. */}
      <div className="mt-3 grid items-center gap-5" style={{ gridTemplateColumns: "1fr 300px 1fr" }}>
        <TeamScore
          team={0}
          teamName={teamName(0)}
          kills={scores?.[0]}
          souls={souls?.[0]}
          alive={alive[0]}
          soulsEnabled={soulsEnabled}
        />

        <div className="flex flex-col items-center gap-1.5">
          <span className={`font-valve-oracle text-[13px] font-bold text-secondary ${MONO}`}>
            {clock(t)} / {clock(durationS)}
          </span>
          {!soulsEnabled ? null : lead == null ? (
            <span className="text-[12px] text-muted">No soul data for this match</span>
          ) : (
            <>
              <span
                className="font-valve-pulp text-[26px] font-bold leading-none"
                style={{ color: leader == null ? "var(--color-muted)" : TEAM_TEXT[leader] }}
              >
                {even ? "Even" : formatCompact(Math.abs(lead))}
              </span>
              <span className="text-[11px] text-muted">
                {even ? "Souls level" : `${teamName(leader)} soul lead`}
              </span>
              <TugBar lead={lead} scale={scale} teamNames={teamNames} />
            </>
          )}
        </div>

        <TeamScore
          team={1}
          teamName={teamName(1)}
          kills={scores?.[1]}
          souls={souls?.[1]}
          alive={alive[1]}
          soulsEnabled={soulsEnabled}
          align="right"
        />
      </div>

      {/* Turning points: the biggest lead swings, or why there are none. */}
      {showTurningPoints ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
          <span className={LABEL}>Turning points</span>
          {souls == null ? (
            <span className="text-[12px] text-muted">
              Turning points need soul snapshots, which weren't recorded for this match.
            </span>
          ) : chipsHidden ? (
            <>
              <span className="text-[12px] text-muted">Hidden while spoiler-safe is on.</span>
              <Button size="xs" variant="ghost" onClick={() => setChipsRevealed(true)}>
                Show anyway
              </Button>
            </>
          ) : (
            turningPoints.map((point) => (
              <TurningPointChip
                key={point.startS}
                point={point}
                teamName={teamName(point.team)}
                active={t >= point.startS && t <= point.endS + TURNING_POINT_ACTIVE_GRACE_S}
                onSelect={onSelectTurningPoint}
                onHover={onHoverTurningPoint}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
