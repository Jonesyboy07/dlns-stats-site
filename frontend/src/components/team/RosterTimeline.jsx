import React, { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  isActivePlayer,
  lineupsByWeek,
  orderTimelineRows,
  playedWeeks,
  spanPercentages,
  toSegments,
} from "../../utils/timeline";

/**
 * Column width limits, in px.
 *
 * MIN is the base width: it keeps a long history compact and scrollable. A team
 * whose history is short stretches its columns up to MAX so the timeline reads as
 * zoomed in and fills the space, rather than sitting as a narrow strip with dead
 * space beside it.
 */
const MIN_COLUMN_PX = 26;
const MAX_COLUMN_PX = 72;

/** Fixed tooltip width, used to keep it from spilling outside the track. */
const TOOLTIP_WIDTH = 208;

/** Matches the thin scrollbar treatment used by the hero usage matrix. */
const SCROLLBAR =
  "[scrollbar-color:rgb(75_85_99)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-600";

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-purple-500/80" />
        active
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-gray-600" />
        departed
      </span>
      <span className="text-gray-600">
        {"hover a week for the lineup \u00b7 hover a bar for the weeks played \u00b7 click for the player page"}
      </span>
    </div>
  );
}

/**
 * Lineup for a single week, shown while hovering that week's column header.
 * The caller renders this OUTSIDE the scrolling track: the track uses
 * overflow-x-auto, which would clip anything positioned above it.
 */
function WeekTooltip({ week, lineup, left }) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-gray-700 bg-gray-900/95 p-2 shadow-2xl"
      style={{
        left,
        top: 30,
        width: TOOLTIP_WIDTH,
        transform: "translateX(-50%)",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        NS {week}
        {lineup.length > 0 && (
          <span className="ml-1 font-normal normal-case text-gray-500">
            · {lineup.length} player{lineup.length === 1 ? "" : "s"}
          </span>
        )}
      </p>
      {lineup.length === 0 ? (
        <p className="mt-1 text-xs text-gray-600">
          No players — the team did not play this week.
        </p>
      ) : (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
          {lineup.map((row) => (
            <li
              key={row.player.account_id}
              className={`truncate text-xs ${
                row.active ? "text-gray-200" : "text-gray-500"
              }`}
            >
              {row.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Roster tenure timeline: one row per player ever fielded, with a bar covering
 * the weeks they turned out. Breaks in a bar are real absences, because the axis
 * only contains weeks the league actually ran.
 *
 * Names are a fixed column and the "gp" tally is a fixed column, so both stay
 * readable while the track between them scrolls sideways.
 */
function RosterTimeline({
  players = [],
  weeks = [],
  leagueWeeks = [],
  maxWeek,
}) {
  const axis = weeks ?? [];
  const [hovered, setHovered] = useState(null);
  const [scrollInfo, setScrollInfo] = useState({ left: 0, width: 0 });
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollerRef = useRef(null);

  // Stretch the columns to fill the viewport when the team has few weeks, so a
  // short history reads as zoomed in. Only teams that cover a lot of the axis
  // stay at the base width and scroll.
  const COLUMN_PX =
    viewportWidth > 0 && axis.length > 0
      ? Math.max(
          MIN_COLUMN_PX,
          Math.min(MAX_COLUMN_PX, viewportWidth / axis.length),
        )
      : MIN_COLUMN_PX;

  // Measure the track's viewport. The scroller is `flex-1`, so its width does not
  // depend on the column width — measuring it cannot feed back into itself.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [axis.length]);

  // Track the visible slice so the league ruler can show where the view sits.
  const syncViewport = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setScrollInfo({ left: scroller.scrollLeft, width: scroller.clientWidth });
  };

  // Open on the most recent weeks. A long-running team would otherwise start at
  // its oldest matches, and the interesting end is the current roster. Runs in a
  // layout effect so the track is positioned before the first paint, avoiding a
  // visible jump; keyed on the axis so manual scrolling is not fought.
  //
  // Deliberately right-aligns the TEAM's latest week rather than blindly jumping
  // to the end of the axis. The two are the same today, but if the axis is ever
  // widened past the team's own history, scrolling to the end would leave a
  // disbanded team staring at nothing but empty space.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const lastIndex = maxWeek == null ? axis.length - 1 : axis.indexOf(maxWeek);
    const edge = (lastIndex >= 0 ? lastIndex + 1 : axis.length) * COLUMN_PX;
    scroller.scrollLeft = Math.max(0, edge - scroller.clientWidth);
    setScrollInfo({ left: scroller.scrollLeft, width: scroller.clientWidth });

    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, [axis, maxWeek, COLUMN_PX]);

  if (axis.length === 0 || players.length === 0) {
    return <p className="text-sm text-gray-600">No match data yet.</p>;
  }

  const rows = orderTimelineRows(players, maxWeek).map((player) => {
    const played = playedWeeks(player.weeks ?? [], axis);
    const name = player.persona_name || `Player ${player.account_id}`;
    const gp = player.appearances ?? 0;
    const tooltip = played.length
      ? `${name} \u2014 ${gp} gp\nWeeks played (${played.length}): ${played.join(", ")}`
      : `${name} \u2014 ${gp} gp`;

    return {
      player,
      name,
      gp,
      tooltip,
      played,
      active: isActivePlayer(player, maxWeek),
      segments: toSegments(player.weeks ?? [], axis),
    };
  });

  const lineups = lineupsByWeek(rows);
  const trackWidth = axis.length * COLUMN_PX;

  // League ruler: the team's tenure, and the slice currently on screen, both
  // positioned inside the league's full history. A newcomer's band sits at the
  // right edge, which conveys "this team is new" without naming a start week.
  const tenure = spanPercentages(axis[0], axis[axis.length - 1], leagueWeeks);
  const visibleBox = (() => {
    if (!scrollInfo.width || axis.length === 0) return null;
    const clamp = (index) => Math.max(0, Math.min(axis.length - 1, index));
    const firstWeek = axis[clamp(Math.floor(scrollInfo.left / COLUMN_PX))];
    const lastWeek =
      axis[clamp(Math.ceil((scrollInfo.left + scrollInfo.width) / COLUMN_PX) - 1)];
    return spanPercentages(firstWeek, lastWeek, leagueWeeks);
  })();

  // Anchor the lineup tooltip to the hovered column, clamped to the visible
  // track. The track scrolls, so subtract its scroll offset from the position.
  const showWeekLineup = (index, week) => {
    const half = TOOLTIP_WIDTH / 2;
    const scroller = scrollerRef.current;
    if (!scroller) {
      setHovered({ index, week, left: half });
      return;
    }
    const centre = index * COLUMN_PX + COLUMN_PX / 2 - scroller.scrollLeft;
    const maxLeft = Math.max(half, scroller.clientWidth - half);
    setHovered({ index, week, left: Math.min(Math.max(centre, half), maxLeft) });
  };

  return (
    <div>
      <div className="flex">
        {/* Fixed name column */}
        <div className="flex w-28 shrink-0 flex-col gap-1 pr-2 sm:w-36">
          <span className="h-6" aria-hidden="true" />
          {rows.map((row) => (
            <Link
              key={row.player.account_id}
              to={`/player/${row.player.account_id}`}
              title={row.tooltip}
              className="flex h-9 items-center truncate text-sm text-gray-200 hover:text-white"
            >
              {row.name}
            </Link>
          ))}
        </div>

        {/* Scrolling track: week header + one bar per player. The lineup tooltip
            is rendered as a sibling of this scroller, because overflow-x-auto
            would clip anything positioned inside it. */}
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollerRef}
            onScroll={() => {
              setHovered(null);
              syncViewport();
            }}
            className={`overflow-x-auto pb-1 ${SCROLLBAR}`}
          >
            <div
              className="relative flex flex-col gap-1"
              style={{ width: trackWidth }}
            >
              <div className="flex h-6 items-center">
                {axis.map((week, index) => (
                  <span
                    key={week}
                    onMouseEnter={() => showWeekLineup(index, week)}
                    onMouseLeave={() => setHovered(null)}
                    className={`flex h-6 shrink-0 cursor-help items-center justify-center text-[10px] tabular-nums transition-colors ${
                      hovered?.week === week ? "text-gray-200" : "text-gray-500"
                    }`}
                    style={{ width: COLUMN_PX }}
                  >
                    {week}
                  </span>
                ))}
              </div>

              {/* Highlight the hovered week down the whole track. */}
              {hovered && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 top-7 bg-white/5"
                  style={{ left: hovered.index * COLUMN_PX, width: COLUMN_PX }}
                />
              )}

              {rows.map((row) => (
                <div
                  key={row.player.account_id}
                  className="relative h-9"
                  style={{ width: trackWidth }}
                >
                  {row.segments.map((segment) => (
                    <Link
                      key={segment.start}
                      to={`/player/${row.player.account_id}`}
                      title={row.tooltip}
                      aria-label={`${row.name}: ${row.gp} game${row.gp === 1 ? "" : "s"} played`}
                      className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                        row.active ? "bg-purple-500/80" : "bg-gray-600"
                      }`}
                      style={{
                        left: segment.start * COLUMN_PX + 1,
                        width: segment.span * COLUMN_PX - 2,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {hovered && (
            <WeekTooltip
              week={hovered.week}
              lineup={lineups.get(hovered.week) ?? []}
              left={hovered.left}
            />
          )}

          {/* League ruler: where this team's run sits in the league's history. */}
          {tenure.total > 0 && (
            <div
              className="mt-2"
              title={`Appeared in ${tenure.weeks} of the league's ${tenure.total} weeks.`}
            >
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <span
                  className="absolute inset-y-0 rounded-full bg-purple-500/60"
                  style={{
                    left: `${tenure.startPct}%`,
                    width: `${tenure.widthPct}%`,
                  }}
                />
                {visibleBox && (
                  <span
                    className="absolute inset-y-0 rounded-full border border-gray-500/80 bg-white/10"
                    style={{
                      left: `${visibleBox.startPct}%`,
                      width: `${Math.max(visibleBox.widthPct, 2)}%`,
                    }}
                  />
                )}
              </div>
              <p className="mt-1 text-right text-[10px] tabular-nums text-gray-600">
                {tenure.weeks} / {tenure.total} league weeks
              </p>
            </div>
          )}
        </div>

        {/* Fixed games-played column */}
        <div className="flex w-14 shrink-0 flex-col gap-1 pl-2">
          <span className="h-6" aria-hidden="true" />
          {rows.map((row) => (
            <span
              key={row.player.account_id}
              className="flex h-9 items-center justify-end text-xs tabular-nums text-gray-400"
            >
              {row.gp} gp
            </span>
          ))}
        </div>
      </div>

      <Legend />
    </div>
  );
}

export default RosterTimeline;
