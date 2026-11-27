/**
 * The replay timeline: fixed tracks (soul lead, fights, kills, objectives) plus one lane per
 * highlighted player showing when they were dead and what they bought.
 *
 * All the geometry comes from `buildLaneView`; this file positions it and handles the
 * gestures -- click a lane to jump, click a fight band to focus it, hover a kill or a fight
 * to light it in every panel. The playhead is drawn once across the whole stack rather than
 * per lane, so the tracks can never drift out of step with each other.
 *
 * Per the Timeline v3 handoff: the soul-lead track is 56px on a symmetric scale labelled at
 * its top and bottom, turning-point windows show as faint dashed bands, and with
 * spoiler-safe on the chart past the playhead is hatched over. Fights, kills, objectives
 * and player lanes always show the whole match -- only the soul-lead chart is masked.
 */

import { useId } from "react";
import HeroIcon from "./HeroIcon";
import ItemIcon from "./ItemIcon";
import { clock } from "../utils/matchTimeline";
import { formatCompact } from "../utils/format";
import {
  LANE_MIN_BAND_PX,
  SOUL_LEAD_VIEW,
  percentOf,
  seekTime,
  soulLeadAt,
  spoilerMask,
} from "../utils/matchTimelineLanes";
import { EVEN_LEAD_SOULS } from "../utils/matchTimelineModel";
import { TEAM_STROKE, TEAM_TEXT } from "../utils/matchTimelineMap";
import { staticImagePathToCdn } from "../utils/cdn";

const LANE_HEIGHTS = { souls: SOUL_LEAD_VIEW.height, fights: 26, kills: 26, objectives: 24, player: 28 };

const LABEL = "font-valve-oracle text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";

/** The kill track's tick: resting in its team's half, a full-height white bar on hover. */
const TICK = { width: 2, hoverWidth: 3, height: 9, amberTop: 2, sapphireTop: 13, hitWidth: 8 };

/** The hatch spoiler-safe lays over the unplayed part of the soul-lead chart. */
const HATCH =
  "repeating-linear-gradient(135deg, var(--color-table) 0 5px, color-mix(in oklch, var(--color-card) 85%, transparent) 5px 10px)";

/** A hatched span narrower than this has no room for its caption. */
const HATCH_CAPTION_MIN_PCT = 14;

/** The strip a lane draws in. Clicking it seeks the clock to that point. */
function Lane({ height, onSeek, children, className = "", style }) {
  return (
    <div
      onClick={onSeek}
      style={{ height, ...style }}
      className={`relative overflow-hidden rounded-md border border-border-light bg-table ${
        onSeek ? "cursor-pointer" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A soul lead as "2.3k" (the sign is carried by the team colour, not a minus). */
const formatLead = (value) => formatCompact(Math.abs(value));

const teamLabel = (teamNames, team) => teamNames[team] ?? (team === 0 ? "Amber" : "Sapphire");

/**
 * The soul-lead chart: Amber's lead above the zero line, Sapphire's below, on a
 * symmetric scale. One area path is drawn twice, each copy clipped to its own half, so
 * the colour flips exactly where the lead changes hands.
 */
function SoulLeadChart({ souls, teamNames, spoilerSafe }) {
  const id = useId().replace(/:/g, "");
  const { width, height } = SOUL_LEAD_VIEW;
  const { peak } = souls;
  const peakText = (team, entry) =>
    entry.timeS == null
      ? null
      : `${teamLabel(teamNames, team)} peak +${formatLead(entry.lead)} at ${clock(entry.timeS)}`;
  // The peaks name who led by how much and when -- a spoiler while the chart is masked.
  const title = spoilerSafe
    ? "Soul lead"
    : ["Soul lead", peakText(0, peak.amber), peakText(1, peak.sapphire)].filter(Boolean).join(" · ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <clipPath id={`${id}-amber`}>
          <rect x="0" y="0" width={width} height={souls.mid} />
        </clipPath>
        <clipPath id={`${id}-sapphire`}>
          <rect x="0" y={souls.mid} width={width} height={height - souls.mid} />
        </clipPath>
      </defs>
      <line
        x1="0"
        x2={width}
        y1={souls.mid}
        y2={souls.mid}
        stroke="var(--color-border-lighter)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={souls.area}
        clipPath={`url(#${id}-amber)`}
        fill="color-mix(in oklch, var(--color-team-amber) 35%, transparent)"
      />
      <path
        d={souls.area}
        clipPath={`url(#${id}-sapphire)`}
        fill="color-mix(in oklch, var(--color-team-sapphire) 45%, transparent)"
      />
      <polyline
        points={souls.line}
        fill="none"
        stroke="var(--color-team-amber)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        clipPath={`url(#${id}-amber)`}
      />
      <polyline
        points={souls.line}
        fill="none"
        stroke="var(--color-team-sapphire)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        clipPath={`url(#${id}-sapphire)`}
      />
    </svg>
  );
}

/**
 * The whole soul-lead track: the chart, the turning-point bands, the scale labels and,
 * under spoiler-safe, the hatch over everything not yet played. Without snapshots the
 * track keeps its height and says why it is empty.
 */
function SoulLeadTrack({ souls, bands = [], t, durationS, teamNames, spoilerSafe, onSeek }) {
  if (!souls) {
    return (
      <Lane height={LANE_HEIGHTS.souls}>
        <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">
          No soul snapshots recorded for this match
        </span>
      </Lane>
    );
  }

  const mask = spoilerSafe ? spoilerMask(t, durationS) : null;

  return (
    <Lane height={LANE_HEIGHTS.souls} onSeek={onSeek}>
      <SoulLeadChart souls={souls} teamNames={teamNames} spoilerSafe={spoilerSafe} />

      {bands.map((band) => (
        <span
          key={band.key}
          aria-hidden="true"
          title={`Turning point ${clock(band.startS)}–${clock(band.endS)} · to ${teamLabel(teamNames, band.team)}`}
          style={{ left: `${band.left}%`, width: `${band.width}%` }}
          className="absolute inset-y-0 border-x border-dashed border-border-lighter bg-white/[0.04]"
        />
      ))}

      {mask && (
        <span
          style={{ left: `${mask.left}%`, width: `${mask.width}%`, backgroundImage: HATCH }}
          className="absolute inset-y-0 flex items-center justify-center"
        >
          {mask.width >= HATCH_CAPTION_MIN_PCT && (
            <span className="rounded-sm bg-table/80 px-1.5 text-[11px] font-semibold text-muted">
              Hidden until played
            </span>
          )}
        </span>
      )}

      {/* The scale, so the chart's height reads as souls rather than as a shape. */}
      <span
        className="pointer-events-none absolute right-1.5 top-0.5 text-[10px] font-bold tabular-nums leading-none"
        style={{ color: TEAM_TEXT[0] }}
      >
        +{formatLead(souls.scaleSouls)}
      </span>
      <span
        className="pointer-events-none absolute bottom-0.5 right-1.5 text-[10px] font-bold tabular-nums leading-none"
        style={{ color: TEAM_TEXT[1] }}
      >
        +{formatLead(souls.scaleSouls)}
      </span>
    </Lane>
  );
}

function LaneLabel({ height, children }) {
  return (
    <div style={{ height }} className={`flex items-center ${LABEL}`}>
      {children}
    </div>
  );
}

export default function TimelineLanes({
  view,
  t = 0,
  durationS = null,
  onSeek = null,
  onFocusFight = null,
  focusedFight = null,
  fights = [],
  hoveredKillId = null,
  hoveredFightIndex = null,
  onHoverKill = null,
  onHoverFight = null,
  spoilerSafe = false,
  // False while souls are switched off (TIMELINE_SOULS_ENABLED): the row is left out.
  showSoulLead = true,
  heroName = () => null,
  teamNames = [],
  className = "",
}) {
  const tracks = view?.tracks ?? { fights: [], kills: [], objectives: [], turningPoints: [] };
  const lanes = view?.players ?? [];
  const axis = view?.axis ?? [];
  const playhead = percentOf(t, durationS);
  const lead = tracks.souls ? soulLeadAt(view?.soulLead, t) : null;
  // "Even" under the same threshold the header uses, so the two readouts agree.
  const leadTeam = lead == null || Math.abs(lead) < EVEN_LEAD_SOULS ? null : lead > 0 ? 0 : 1;

  // A click anywhere on a lane jumps to that point; the bands and the player lanes sit
  // above the tracks, so a click on one has to stop rather than seek through.
  const seekFrom = (event) => {
    if (!onSeek || !durationS) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(seekTime((event.clientX - rect.left) / rect.width, durationS));
  };

  const focusFight = (event, index) => {
    event.stopPropagation();
    const fight = fights.find((entry) => entry.index === index);
    if (fight) onFocusFight?.(fight);
  };

  const hoverKill = (killId) => (onHoverKill ? () => onHoverKill(killId) : undefined);
  const unhoverKill = onHoverKill ? () => onHoverKill(null) : undefined;
  const hoverFight = (index) => (onHoverFight ? () => onHoverFight(index) : undefined);
  const unhoverFight = onHoverFight ? () => onHoverFight(null) : undefined;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* The transport lives under the map; this only says what the lanes themselves
          respond to, where a reader would look before clicking. */}
      <p className="text-xs text-muted">
        Click anywhere on the lanes to jump · click a fight band to focus it
      </p>

      <div className="grid grid-cols-[130px_1fr] gap-x-2.5">
        <div className="flex flex-col gap-1">
          {showSoulLead && (
            <div style={{ height: LANE_HEIGHTS.souls }} className="flex flex-col justify-center gap-0.5">
              <span className={LABEL}>Soul lead</span>
              <span
                className="truncate pr-2 font-valve-pulp text-xs font-bold tabular-nums"
                style={{
                  color: !tracks.souls || leadTeam == null ? "var(--color-muted)" : TEAM_TEXT[leadTeam],
                }}
              >
                {!tracks.souls
                  ? "No data"
                  : leadTeam == null
                    ? "Even"
                    : `${teamLabel(teamNames, leadTeam)} +${formatLead(lead)}`}
              </span>
            </div>
          )}
          <LaneLabel height={LANE_HEIGHTS.fights}>Fights</LaneLabel>
          <LaneLabel height={LANE_HEIGHTS.kills}>Kills</LaneLabel>
          <LaneLabel height={LANE_HEIGHTS.objectives}>Objectives</LaneLabel>
          {lanes.map((lane) => (
            <div
              key={lane.accountId}
              style={{ height: LANE_HEIGHTS.player }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <HeroIcon name={heroName(lane.heroId)} size="h-[18px] w-[18px]" alt="" />
              <span className="truncate text-xs font-medium text-secondary">{lane.name}</span>
            </div>
          ))}
        </div>

        <div className="relative flex flex-col gap-1">
          {showSoulLead && (
            <SoulLeadTrack
              souls={tracks.souls}
              bands={tracks.turningPoints ?? []}
              t={t}
              durationS={durationS}
              teamNames={teamNames}
              spoilerSafe={spoilerSafe}
              onSeek={seekFrom}
            />
          )}

          <Lane height={LANE_HEIGHTS.fights} onSeek={seekFrom}>
            {tracks.fights.map((band) => {
              const focused = focusedFight?.index === band.index;
              const hovered = hoveredFightIndex === band.index;
              return (
                <button
                  key={band.index}
                  type="button"
                  title={`Fight ${band.index + 1} · ${clock(band.timeS)} · ${band.score}`}
                  aria-label={`Focus fight ${band.index + 1} at ${clock(band.timeS)}, ${band.score}`}
                  aria-pressed={focused}
                  onClick={(event) => focusFight(event, band.index)}
                  onMouseEnter={hoverFight(band.index)}
                  onMouseLeave={unhoverFight}
                  onFocus={hoverFight(band.index)}
                  onBlur={unhoverFight}
                  style={{
                    left: `${band.left}%`,
                    width: `${band.width}%`,
                    minWidth: LANE_MIN_BAND_PX,
                    backgroundColor:
                      band.winner == null
                        ? "var(--color-badge-bg)"
                        : band.winner === 0
                          ? "color-mix(in oklch, var(--color-team-amber) 35%, transparent)"
                          : "color-mix(in oklch, var(--color-team-sapphire) 45%, transparent)",
                    borderColor: focused
                      ? "var(--color-accent-light)"
                      : hovered
                        ? "var(--color-accent-border-strong)"
                        : "var(--color-border-lighter)",
                    borderWidth: focused || hovered ? 2 : 1,
                  }}
                  className="absolute inset-y-0 flex items-center justify-center rounded border px-1 font-valve-pulp text-[10px] font-bold text-primary transition-[border-color] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-secondary-light"
                >
                  <span className="truncate">{band.score}</span>
                </button>
              );
            })}
          </Lane>

          <Lane height={LANE_HEIGHTS.kills} onSeek={seekFrom}>
            {tracks.kills.map((tick) => {
              const hovered = hoveredKillId != null && tick.killId === hoveredKillId;
              return (
                // A 2px tick is too thin to point at, so each sits in a wider hit area.
                <span
                  key={tick.killId}
                  onMouseEnter={hoverKill(tick.killId)}
                  onMouseLeave={unhoverKill}
                  style={{ left: `${tick.left}%`, width: TICK.hitWidth }}
                  className="absolute inset-y-0 -translate-x-1/2"
                >
                  <span
                    aria-hidden="true"
                    style={
                      hovered
                        ? { left: "50%", width: TICK.hoverWidth, top: 0, bottom: 0, backgroundColor: "#fff" }
                        : {
                            left: "50%",
                            width: TICK.width,
                            height: TICK.height,
                            // Each kill sits in the half of the lane its killer's team owns.
                            top: tick.team === 1 ? TICK.sapphireTop : TICK.amberTop,
                            backgroundColor: tick.team == null ? "var(--color-dim)" : TEAM_STROKE[tick.team],
                            opacity: tick.involved === null ? 0.75 : tick.involved ? 1 : 0.15,
                          }
                    }
                    className="absolute -translate-x-1/2 rounded-sm"
                  />
                </span>
              );
            })}
          </Lane>

          <Lane height={LANE_HEIGHTS.objectives} onSeek={seekFrom}>
            {tracks.objectives.map((mark, index) => {
              const big = /Patron|Mid Boss/i.test(mark.label ?? "");
              const size = big ? 12 : 9;
              return (
                <span
                  key={`${mark.timeS}-${index}`}
                  title={`${clock(mark.timeS)} — ${mark.label ?? "objective"}${
                    mark.laneName ? ` · ${mark.laneName}` : ""
                  }`}
                  style={{
                    left: `${mark.left}%`,
                    width: size,
                    height: size,
                    backgroundColor: TEAM_STROKE[mark.team],
                  }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px]"
                />
              );
            })}
          </Lane>

          {lanes.map((lane) => (
            <Lane key={lane.accountId} height={LANE_HEIGHTS.player} onSeek={seekFrom}>
              {lane.deadBars.map((bar) => (
                <span
                  key={bar.key}
                  title={`${clock(bar.timeS)} — dead ${bar.respawnS}s${
                    bar.killerName ? ` (killed by ${bar.killerName})` : ""
                  }`}
                  style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  className="absolute inset-y-2 rounded border border-danger-border bg-danger-bg"
                />
              ))}
              {lane.killMarks.map((mark) => {
                const hovered = hoveredKillId != null && mark.killId === hoveredKillId;
                return (
                  <span
                    key={mark.key}
                    title={`${clock(mark.timeS)} — killed ${mark.victimName ?? "an enemy"}`}
                    onMouseEnter={hoverKill(mark.killId)}
                    onMouseLeave={unhoverKill}
                    style={{
                      left: `${mark.left}%`,
                      backgroundColor: TEAM_STROKE[mark.team],
                      boxShadow: hovered ? "0 0 0 2px #fff" : undefined,
                    }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[width,height] ${
                      hovered ? "z-10 h-3 w-3" : "h-2 w-2"
                    }`}
                  />
                );
              })}
              {lane.itemMarks.map((mark) => (
                <span
                  key={mark.key}
                  title={`${clock(mark.timeS)} — ${mark.item ?? "item"}`}
                  style={{ left: `${mark.left}%` }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-panel"
                >
                  <ItemIcon
                    icon={mark.icon}
                    name={mark.item}
                    itemId={mark.itemId}
                    size="h-[18px] w-[18px]"
                    fallback={staticImagePathToCdn(mark.image || null)}
                  />
                </span>
              ))}
            </Lane>
          ))}

          {playhead !== null && (
            <span
              aria-hidden="true"
              style={{ left: `${playhead}%` }}
              className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-accent"
            />
          )}
        </div>
      </div>

      {lanes.length === 0 && (
        <p className="text-xs text-muted">
          Highlight players to add their lanes — dead time and key item purchases.
        </p>
      )}

      <div className="grid grid-cols-[130px_1fr] gap-x-2.5">
        <div />
        <div className="relative h-4">
          {axis.map((tick) => (
            <span
              key={tick.timeS}
              style={{ left: `${tick.left}%` }}
              className="absolute -translate-x-1/2 text-[10px] font-bold tabular-nums text-muted"
            >
              {clock(tick.timeS)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
