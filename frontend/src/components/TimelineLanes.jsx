/**
 * The replay timeline: three fixed tracks (fights, kills, objectives) plus one lane per
 * highlighted player showing when they were dead and what they bought.
 *
 * All the geometry comes from `buildLaneView`; this file positions it and handles the
 * gestures -- click a lane to jump, click a fight band to focus it, drag the slider.
 * The playhead is drawn once across the whole stack rather than per lane, so the
 * tracks can never drift out of step with each other.
 */

import HeroIcon from "./HeroIcon";
import ItemIcon from "./ItemIcon";
import { clock } from "../utils/matchTimeline";
import { LANE_MIN_BAND_PX, percentOf, seekTime } from "../utils/matchTimelineLanes";
import { TEAM_STROKE } from "../utils/matchTimelineMap";
import { staticImagePathToCdn } from "../utils/cdn";

const LANE_HEIGHTS = { fights: 26, kills: 26, objectives: 24, player: 28 };

const LABEL = "font-valve-oracle text-[11px] font-semibold uppercase tracking-[0.04em] text-dim";

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
  heroName = () => null,
  className = "",
}) {
  const tracks = view?.tracks ?? { fights: [], kills: [], objectives: [] };
  const lanes = view?.players ?? [];
  const axis = view?.axis ?? [];
  const playhead = percentOf(t, durationS);

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

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* The transport lives under the map; this only says what the lanes themselves
          respond to, where a reader would look before clicking. */}
      <p className="text-xs text-dim">
        Click anywhere on the lanes to jump · click a fight band to focus it
      </p>

      <div className="grid grid-cols-[130px_1fr] gap-1">
        <div className="flex flex-col gap-1">
          <LaneLabel height={LANE_HEIGHTS.fights}>Fights</LaneLabel>
          <LaneLabel height={LANE_HEIGHTS.kills}>Kills</LaneLabel>
          <LaneLabel height={LANE_HEIGHTS.objectives}>Objectives</LaneLabel>
          {lanes.map((lane) => (
            <div
              key={lane.accountId}
              style={{ height: LANE_HEIGHTS.player }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <HeroIcon name={heroName(lane.heroId)} size="h-[18px] w-[18px]" />
              <span className="truncate text-xs font-medium text-secondary">{lane.name}</span>
            </div>
          ))}
        </div>

        <div className="relative flex flex-col gap-1">
          <Lane height={LANE_HEIGHTS.fights} onSeek={seekFrom}>
            {tracks.fights.map((band) => (
              <button
                key={band.index}
                type="button"
                title={`Fight ${band.index + 1} · ${clock(band.timeS)} · ${band.score}`}
                onClick={(event) => focusFight(event, band.index)}
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
                  borderColor:
                    focusedFight?.index === band.index
                      ? "var(--color-accent-light)"
                      : "var(--color-border-lighter)",
                }}
                className="absolute inset-y-0 flex items-center justify-center rounded border px-1 font-valve-pulp text-[10px] font-bold text-primary"
              >
                <span className="truncate">{band.score}</span>
              </button>
            ))}
          </Lane>

          <Lane height={LANE_HEIGHTS.kills} onSeek={seekFrom}>
            {tracks.kills.map((tick) => (
              <span
                key={tick.killId}
                aria-hidden="true"
                style={{
                  left: `${tick.left}%`,
                  width: 2,
                  // Each kill sits in the half of the lane its killer's team owns.
                  top: tick.team === 1 ? 13 : 2,
                  backgroundColor:
                    tick.team == null
                      ? "var(--color-dim)"
                      : TEAM_STROKE[tick.team],
                  opacity: tick.involved === null ? 0.75 : tick.involved ? 1 : 0.15,
                }}
                className="absolute h-[9px] rounded-sm"
              />
            ))}
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
              {lane.killMarks.map((mark) => (
                <span
                  key={mark.key}
                  title={`${clock(mark.timeS)} — killed ${mark.victimName ?? "an enemy"}`}
                  style={{ left: `${mark.left}%`, backgroundColor: TEAM_STROKE[mark.team] }}
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                />
              ))}
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
              className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent"
            />
          )}
        </div>
      </div>

      {lanes.length === 0 && (
        <p className="text-xs text-dim">
          Highlight players to add their lanes — dead time and key item purchases.
        </p>
      )}

      <div className="grid grid-cols-[130px_1fr] gap-1">
        <div />
        <div className="relative h-4">
          {axis.map((tick) => (
            <span
              key={tick.timeS}
              style={{ left: `${tick.left}%` }}
              className="absolute -translate-x-1/2 text-[10px] tabular-nums text-dim"
            >
              {clock(tick.timeS)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
