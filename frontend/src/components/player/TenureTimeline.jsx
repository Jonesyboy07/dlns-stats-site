import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Panel from "./Panel";
import { playedTeams } from "../../utils/playerStats";

/** 16px tall cells, 1px apart — the team roster timeline's visual grammar. */
const CELL_BASE = "h-4 rounded-[1px]";
const CELL_PLAYED = `${CELL_BASE} bg-accent-secondary`;
const CELL_IDLE = `${CELL_BASE} bg-table`;

const NAME_COLUMN = "grid grid-cols-[150px_minmax(0,1fr)_150px] items-center gap-x-3.5";

/**
 * Merge the per-event league axes from every `/db/team/<name>/weeks` response.
 * League weeks are league-wide, so the teams agree; the union only guards
 * against one lookup failing. Returns `{ [event_title]: number[] }`.
 */
export function leagueAxesByEvent(results = []) {
  const axes = {};
  for (const result of results) {
    for (const entry of result?.events ?? []) {
      if (!entry?.event_title || !entry.league_weeks?.length) continue;
      const weeks = (axes[entry.event_title] ??= new Set());
      for (const week of entry.league_weeks) weeks.add(week);
    }
  }
  return Object.fromEntries(
    Object.entries(axes).map(([event, weeks]) => [event, [...weeks].sort((a, b) => a - b)]),
  );
}

/** The event's league axis, or the player's own weeks in it when the lookup failed. */
function axisFor(group, leagueAxes) {
  const league = leagueAxes?.[group.event];
  if (league?.length) return league;
  const weeks = new Set();
  for (const entry of group.teams) {
    for (const week of entry.weeks) weeks.add(week);
  }
  return [...weeks].sort((a, b) => a - b);
}

function axisTicks(axis) {
  if (axis.length === 0) return [];
  const last = axis[axis.length - 1];
  const wanted = new Set([axis[0], last]);
  for (let week = 10; week <= last; week += 10) wanted.add(week);
  return axis
    .map((week, index) => ({ week, index }))
    .filter(({ week }) => wanted.has(week))
    .map(({ week, index }) => ({ week, left: `${((index + 0.5) / axis.length) * 100}%` }));
}

/** One event's strip: a row per team, one cell per week of THAT event. */
function EventTenure({ group, axis, current, showHeading }) {
  const ticks = useMemo(() => axisTicks(axis), [axis]);
  const template = { gridTemplateColumns: `repeat(${axis.length}, minmax(0, 1fr))` };
  const { prefix } = group;

  return (
    <div className="flex flex-col gap-1.5">
      {showHeading && (
        <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-muted">
          {group.event}
          <span className="ml-1 font-normal normal-case text-dim">
            · {prefix} {axis[0]} – {prefix} {axis[axis.length - 1]}
          </span>
        </p>
      )}

      {group.teams.map((entry) => {
        const played = new Set(entry.weeks);
        const isCurrent = current === entry.team;
        const first = entry.weeks[0] ?? null;
        const last = entry.weeks[entry.weeks.length - 1] ?? null;

        return (
          <div key={entry.team} className={NAME_COLUMN}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Link
                to={`/team/${encodeURIComponent(entry.team)}`}
                title={entry.team}
                className="truncate text-[13px] font-semibold text-primary transition-colors hover:text-accent-secondary-light"
              >
                {entry.team}
              </Link>
              {isCurrent && (
                <span className="shrink-0 rounded-full border border-accent-secondary-border bg-accent-secondary-bg px-1.5 py-px text-[10px] font-semibold text-accent-secondary-light">
                  Current
                </span>
              )}
            </span>

            <span className="grid h-4 gap-px" style={template}>
              {axis.map((week) => {
                const didPlay = played.has(week);
                return (
                  <span
                    key={week}
                    title={didPlay ? `${prefix} ${week}: played` : `${prefix} ${week}: did not play`}
                    className={didPlay ? CELL_PLAYED : CELL_IDLE}
                  />
                );
              })}
            </span>

            <span className="text-right text-[12px] tabular-nums text-muted">
              {first != null && last != null
                ? `${prefix} ${first}–${last} · ${entry.weeks.length} wk · ${entry.games} g`
                : `${entry.games} g`}
            </span>
          </div>
        );
      })}

      <div className={NAME_COLUMN}>
        <span />
        <div className="relative h-3.5 text-[10px] text-dim">
          {ticks.map((tick) => (
            <span
              key={tick.week}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: tick.left }}
            >
              {prefix} {tick.week}
            </span>
          ))}
        </div>
        <span />
      </div>
    </div>
  );
}

/**
 * P1-5: one row per team the player appeared for, one cell per league week.
 *
 * Week numbers restart in every event (Fight Night week 5 is not Night Shift
 * week 5), so each event gets its own strip on its own axis, main league first.
 * A filled cell means the player turned out that week; an empty one means they
 * did not. The axis is the EVENT's week list, so a gap reads in context — the
 * lookup (`/db/team/<name>/weeks`, weeks only — the full team payload is 145 KB)
 * degrades to the player's own span if it fails.
 */
export default function TenureTimeline({ matches = [] }) {
  const tenure = useMemo(() => playedTeams(matches), [matches]);
  const teamKey = tenure.teams.map((entry) => entry.team).join("|");

  const [leagueAxes, setLeagueAxes] = useState(null);

  useEffect(() => {
    let alive = true;
    const names = teamKey ? teamKey.split("|") : [];
    if (names.length === 0) return undefined;

    Promise.all(
      names.map((name) =>
        fetch(`/db/team/${encodeURIComponent(name)}/weeks`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (alive) setLeagueAxes(leagueAxesByEvent(results));
    });

    return () => {
      alive = false;
    };
  }, [teamKey]);

  const groups = useMemo(
    () =>
      tenure.events
        .map((group) => ({ group, axis: axisFor(group, leagueAxes) }))
        .filter(({ axis }) => axis.length > 0),
    [tenure.events, leagueAxes],
  );

  if (groups.length === 0) {
    return (
      <Panel title="Team Tenure">
        <p className="text-sm text-muted">
          No team weeks to show yet — this player has no league games on record.
        </p>
      </Panel>
    );
  }

  const [lead] = groups;
  const subtitle =
    groups.length === 1
      ? `${lead.group.prefix} ${lead.axis[0]} – ${lead.group.prefix} ${lead.axis[lead.axis.length - 1]} · one cell per week`
      : "one strip per event · one cell per week";

  return (
    <Panel title="Team Tenure" subtitle={subtitle}>
      <div className="flex flex-col gap-5">
        {groups.map(({ group, axis }) => (
          <EventTenure
            key={group.event}
            group={group}
            axis={axis}
            current={tenure.currentEvent === group.event ? tenure.current : null}
            showHeading={groups.length > 1}
          />
        ))}
      </div>
    </Panel>
  );
}
