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
 * P1-5: one row per team the player appeared for, one cell per league week.
 *
 * A filled cell means the player turned out that week; an empty one means they
 * did not. The axis is the LEAGUE's week list, so a gap reads in context — the
 * lookup (`/db/team/<name>/weeks`, weeks only — the full team payload is 145 KB)
 * degrades to the player's own span if it fails.
 */
export default function TenureTimeline({ matches = [] }) {
  const tenure = useMemo(() => playedTeams(matches), [matches]);
  const teams = tenure.teams;
  const teamKey = teams.map((entry) => entry.team).join("|");

  const [leagueWeeks, setLeagueWeeks] = useState(null);

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
      if (!alive) return;
      const axis = results.find((result) => result?.league_weeks?.length);
      setLeagueWeeks(axis?.league_weeks ?? null);
    });

    return () => {
      alive = false;
    };
  }, [teamKey]);

  /** The league axis, or the player's own span when the lookup came back empty. */
  const axis = useMemo(() => {
    if (leagueWeeks?.length) return leagueWeeks;
    const weeks = new Set();
    for (const entry of teams) {
      for (const week of entry.weeks) weeks.add(week);
    }
    return [...weeks].sort((a, b) => a - b);
  }, [leagueWeeks, teams]);

  const ticks = useMemo(() => {
    if (axis.length === 0) return [];
    const last = axis[axis.length - 1];
    const wanted = new Set([axis[0], last]);
    for (let week = 10; week <= last; week += 10) wanted.add(week);
    return axis
      .map((week, index) => ({ week, index }))
      .filter(({ week }) => wanted.has(week))
      .map(({ week, index }) => ({ week, left: `${((index + 0.5) / axis.length) * 100}%` }));
  }, [axis]);

  if (teams.length === 0 || axis.length === 0) {
    return (
      <Panel title="Team Tenure">
        <p className="text-sm text-muted">
          No team weeks to show yet — this player has no league games on record.
        </p>
      </Panel>
    );
  }

  const template = { gridTemplateColumns: `repeat(${axis.length}, minmax(0, 1fr))` };

  return (
    <Panel
      title="Team Tenure"
      subtitle={`NS ${axis[0]} – NS ${axis[axis.length - 1]} · one cell per week`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          {teams.map((entry) => {
            const played = new Set(entry.weeks);
            const isCurrent = tenure.current === entry.team;
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
                        title={didPlay ? `NS ${week}: played` : `NS ${week}: did not play`}
                        className={didPlay ? CELL_PLAYED : CELL_IDLE}
                      />
                    );
                  })}
                </span>

                <span className="text-right text-[12px] tabular-nums text-muted">
                  {first != null && last != null
                    ? `NS ${first}–${last} · ${entry.weeks.length} wk · ${entry.games} g`
                    : `${entry.games} g`}
                </span>
              </div>
            );
          })}
        </div>

        <div className={NAME_COLUMN}>
          <span />
          <div className="relative h-3.5 text-[10px] text-dim">
            {ticks.map((tick) => (
              <span
                key={tick.week}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: tick.left }}
              >
                NS {tick.week}
              </span>
            ))}
          </div>
          <span />
        </div>
      </div>
    </Panel>
  );
}
