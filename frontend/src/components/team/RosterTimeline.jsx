import React, { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { axisLabels, tenureCells, tenureSummary } from "../../utils/team";
import {
  isActivePlayer,
  lineupsByWeek,
  orderTimelineRows,
  playedWeeks,
} from "../../utils/timeline";

/**
 * Fixed cell geometry, in px.
 *
 * Every week box is the same size no matter how long the team's history is: a
 * league-spanning team would otherwise squeeze 57 columns into a few pixels each.
 * The track scrolls instead, which is also what lets the week axis be hoverable —
 * a hit target needs a predictable size to sit under the cursor.
 */
const CELL_W = 22;
const CELL_H = 18;
const X_GAP = 2;
const Y_GAP = 6;
const PITCH = CELL_W + X_GAP;

/** Fixed tooltip width, used to keep it from spilling outside the track. */
const TOOLTIP_WIDTH = 208;

/** Matches the thin scrollbar treatment used by the hero usage matrix. */
const SCROLLBAR =
  "[scrollbar-color:rgb(75_85_99)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-600";

const ROW_GAP = { gap: Y_GAP };

const colWidth = {
  width: CELL_W,
  flex: `0 0 ${CELL_W}px`,
};

/**
 * Lineup for one week, shown while the cursor is anywhere over that week's column
 * — the axis box or any player's cell in it. Rendered as a SIBLING of the scroller:
 * the track uses overflow-x-auto, which would clip anything positioned inside it.
 *
 * Anchored just BELOW the axis, so it reads as belonging to the top of the column
 * rather than following the cursor around and covering the rows it describes.
 */
function WeekTooltip({ week, lineup, left }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 rounded-lg border border-border bg-card p-2 shadow-2xl"
      style={{ left, top: 30, width: TOOLTIP_WIDTH, transform: "translateX(-50%)" }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-muted">
        NS {week}
        {lineup.length > 0 && (
          <span className="ml-1 font-normal normal-case text-dim">
            · {lineup.length} player{lineup.length === 1 ? "" : "s"}
          </span>
        )}
      </p>
      {lineup.length === 0 ? (
        <p className="mt-1 text-[12px] text-dim">
          No players — the team did not play this week.
        </p>
      ) : (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
          {lineup.map((row) => (
            <li
              key={row.player.account_id}
              className={`truncate text-[12px] ${row.active ? "text-secondary" : "text-dim"}`}
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
 * Roster Timeline: one cell per league week for every player who ever turned out.
 *
 * The axis is the weeks the LEAGUE ran, clipped to the team's own span, so a break
 * in a row always means "the team played and this player did not" — never "the
 * league took a week off". Names and summaries are their own fixed columns and only
 * the week track scrolls, so a row stays identifiable however far right you are.
 *
 * Who is still on the roster is carried by the NAME alone — bold white for the
 * current roster, grey for everyone who has moved on — rather than a badge, which
 * cost a column of width in every row to say something a weight change says for
 * free. A cell still means "rostered in this week", independent of that.
 */
function RosterTimeline({ players = [], weeks = [], maxWeek }) {
  const axis = weeks ?? [];
  const [hovered, setHovered] = useState(null);
  const scrollerRef = useRef(null);

  // Open on the most recent weeks: the current roster is the interesting end, and
  // a 57-week team would otherwise start 30 weeks in the past. Runs in a layout
  // effect so the track is positioned before the first paint, and is keyed on the
  // axis so manual scrolling is not fought.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const lastIndex = maxWeek == null ? axis.length - 1 : axis.indexOf(maxWeek);
    const edge = (lastIndex >= 0 ? lastIndex + 1 : axis.length) * PITCH;
    scroller.scrollLeft = Math.max(0, edge - scroller.clientWidth);
  }, [axis, maxWeek]);

  if (axis.length === 0 || players.length === 0) {
    return <p className="text-[13px] text-dim">No match data yet.</p>;
  }

  const labels = axisLabels(axis);
  const rows = orderTimelineRows(players, maxWeek).map((player) => {
    const played = playedWeeks(player.weeks ?? [], axis);
    const name = player.persona_name || `Player ${player.account_id}`;

    return {
      player,
      name,
      active: isActivePlayer(player, maxWeek),
      played,
      cells: tenureCells(player.weeks ?? [], axis),
      summary: tenureSummary({
        first: player.first_week ?? played[0],
        last: player.last_week ?? played[played.length - 1],
        games: player.appearances ?? 0,
      }),
    };
  });

  const lineups = lineupsByWeek(rows);
  const trackWidth = axis.length * PITCH - X_GAP;

  // Hover the WHOLE column, not just its axis box: the cursor is usually sitting on
  // a player's cell, and that is exactly when "which week is this and who played it"
  // is the question. One delegated move handler on the track does that without a
  // listener on each of the ~1,300 cells.
  //
  // `currentTarget` is the track's inner wrapper, so its rect already accounts for
  // the horizontal scroll — no scrollLeft subtraction needed here.
  const handleColumnHover = (event) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left) / PITCH);
    if (index < 0 || index >= axis.length) {
      setHovered((current) => (current === null ? current : null));
      return;
    }

    // Anchor the tooltip to the hovered column, clamped to the visible track.
    const half = TOOLTIP_WIDTH / 2;
    const centre = index * PITCH + CELL_W / 2 - scroller.scrollLeft;
    const maxLeft = Math.max(half, scroller.clientWidth - half);
    const left = Math.min(Math.max(centre, half), maxLeft);

    // A mousemove fires constantly, so keep the SAME state object while the cursor
    // stays in one column and React skips the re-render.
    setHovered((current) =>
      current && current.index === index ? current : { index, week: axis[index], left },
    );
  };

  return (
    <div className="flex">
      {/* Fixed name column. The leading spacer sits where the week axis runs, so
          every row keeps the same 24px rhythm as the track. */}
      <div className="flex w-[140px] shrink-0 flex-col pr-2 sm:w-[180px]" style={ROW_GAP}>
        <span style={{ height: CELL_H }} aria-hidden="true" />
        {rows.map((row) => (
          <Link
            key={row.player.account_id}
            to={`/player/${row.player.account_id}`}
            title={row.name}
            className={`min-w-0 truncate text-[14px] transition-colors hover:text-accent-secondary-light ${
              row.active ? "font-bold text-primary" : "font-medium text-dim"
            }`}
            style={{ height: CELL_H, lineHeight: `${CELL_H}px` }}
          >
            {row.name}
          </Link>
        ))}
      </div>

      {/* Scrolling week track. The lineup tooltip is a sibling of this scroller,
          because overflow-x-auto would clip anything positioned inside it. */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={() => setHovered(null)}
          className={`overflow-x-auto pb-1 ${SCROLLBAR}`}
        >
          <div
            className="flex cursor-help flex-col"
            style={{ ...ROW_GAP, width: trackWidth }}
            onMouseMove={handleColumnHover}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Week axis on TOP: every third week plus the last one is labelled.
                Every box in the grid is a hover target, so the lineup is one mouse
                move away wherever the cursor happens to be. */}
            <div className="flex" style={{ gap: X_GAP }}>
              {axis.map((week) => (
                <span
                  key={week}
                  className={`text-center text-[11px] tabular-nums transition-colors ${
                    hovered?.week === week ? "text-secondary" : "text-dim"
                  }`}
                  style={colWidth}
                >
                  {labels.has(week) ? week : ""}
                </span>
              ))}
            </div>

            {/* Player rows, with the hovered week highlighted down the whole track. */}
            <div className="relative flex flex-col" style={ROW_GAP}>
              {rows.map((row) => (
                <div key={row.player.account_id} className="flex" style={{ height: CELL_H, gap: X_GAP }}>
                  {row.cells.map((cell) => (
                    <span
                      key={cell.week}
                      className={`rounded-[2px] ${cell.rostered ? "bg-accent-secondary" : "bg-table"}`}
                      style={colWidth}
                    />
                  ))}
                </div>
              ))}

              {hovered && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 bg-white/5"
                  style={{ left: hovered.index * PITCH - X_GAP / 2, width: PITCH }}
                />
              )}
            </div>
          </div>
        </div>

        {hovered && (
          <WeekTooltip
            week={hovered.week}
            lineup={lineups.get(hovered.week) ?? []}
            left={hovered.left}
          />
        )}
      </div>

      {/* Fixed summary column, with the same leading spacer as the names. */}
      <div className="flex w-[100px] shrink-0 flex-col pl-2" style={ROW_GAP}>
        <span style={{ height: CELL_H }} aria-hidden="true" />
        {rows.map((row) => (
          <span
            key={row.player.account_id}
            className="whitespace-nowrap text-right text-[13px] tabular-nums text-muted"
            style={{ height: CELL_H }}
          >
            {row.summary}
          </span>
        ))}
      </div>
    </div>
  );
}

export default RosterTimeline;
