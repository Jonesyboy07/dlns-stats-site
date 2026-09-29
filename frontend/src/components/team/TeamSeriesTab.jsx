import React, { useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../SectionCard";
import TeamLogo from "../TeamLogo";
import { formatDuration, formatLongDate } from "../../utils/format";
import { DASH, gameResult, recordOf, seriesGroups } from "../../utils/team";

/**
 * Header and rows share this template so the labels sit over their columns:
 * opponent, score, date, then the trailing 16px chevron.
 */
const GRID =
  "grid grid-cols-[minmax(170px,1.4fr)_64px_96px_16px] items-center gap-4";

/** "GAME 1" -> "Game 1"; anything else is shown as-is. */
const shortGame = (label) => {
  const match = /^game\s*(\w+)$/i.exec((label || "").trim());
  return match ? `Game ${match[1]}` : label || DASH;
};

function ScoreCell({ record }) {
  return (
    <span className="flex items-center justify-center gap-1.5 text-[14px] font-semibold tabular-nums">
      <span className={record.winsTone}>{record.wins}</span>
      <span className="text-dim">–</span>
      <span className={record.lossesTone}>{record.losses}</span>
    </span>
  );
}

/** One matchup inside a week: a table row that opens its games. */
function SeriesRow({ series, teamName, open, onToggle }) {
  const record = recordOf(series.wins, series.losses);
  const date = formatLongDate(series.date);

  return (
    <div className="flex flex-col border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${GRID} px-4 py-3 text-left transition-colors motion-reduce:transition-none ${
          open ? "bg-hover" : "hover:bg-hover"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="text-[13px] text-dim">vs</span>
          {series.opponent ? (
            <TeamLogo name={series.opponent} size="h-6 w-6" rounded="rounded" />
          ) : null}
          <span className="truncate text-[15px] font-bold text-accent-secondary-light">
            {series.opponent || "Unknown"}
          </span>
        </span>

        <ScoreCell record={record} />

        <span className="whitespace-nowrap text-right text-[13px] text-muted">{date}</span>

        <span
          aria-hidden="true"
          className={`text-[11px] text-dim transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="bg-table">
          {series.games.map((game, index) => {
            const result = gameResult(game, teamName);
            return (
              <Link
                key={game.match_id}
                to={`/match/${game.match_id}`}
                className="flex items-center gap-3.5 border-t border-border py-2.5 pl-10 pr-4 text-secondary transition-all motion-reduce:transition-none hover:bg-accent-secondary-bg hover:pl-11"
              >
                <span
                  className={`inline-flex min-w-11 justify-center rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                    result === true
                      ? "border-success-border bg-success-bg text-success"
                      : result === false
                        ? "border-danger-border bg-danger-bg text-danger-text"
                        : "border-border text-dim"
                  }`}
                >
                  {result === true ? "Win" : result === false ? "Loss" : DASH}
                </span>

                <span className="w-16 shrink-0 text-[14px] font-medium text-primary">
                  {shortGame(game.event_game) || `Game ${index + 1}`}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {formatLongDate(game.start_time ?? game.created_at) ?? DASH}
                  {game.duration_s ? ` · ${formatDuration(game.duration_s)}` : ""}
                </span>

                <span className="shrink-0 font-mono text-[12px] text-dim">
                  #{game.match_id}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Week separator: the week on the left, a rule, then what the week holds. */
function WeekDivider({ week, items }) {
  // Deliberately no date: every row below carries its own, so repeating it on
  // the divider was noise.
  return (
    <div className="flex items-center gap-3 px-4 pb-2 pt-5">
      <span className="whitespace-nowrap text-[12px] font-bold uppercase tracking-[.05em] text-muted">
        {week != null ? `NS ${week}` : "Pre-season"}
      </span>
      <span className="h-px flex-1 bg-border" />
      <span className="whitespace-nowrap text-[12px] text-dim">{items.length} series</span>
    </div>
  );
}

function TeamSeriesTab({ team_name, matches = [] }) {
  const weeks = seriesGroups(matches, team_name);
  const seriesCount = weeks.reduce((sum, week) => sum + week.items.length, 0);
  // The newest series opens by default: it is the one being looked for.
  const [openKey, setOpenKey] = useState(() => weeks[0]?.items[0]?.key ?? null);

  if (weeks.length === 0) {
    return (
      <SectionCard title="Series">
        <p className="text-[13px] text-dim">No series recorded.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Series"
      subtitle={`${seriesCount} series · newest first · click a row for its games`}
    >
      <div className="-mx-2 overflow-x-auto">
        <div className="flex min-w-[460px] flex-col">
          <div
            className={`${GRID} border-b border-border px-4 pb-2.5 text-[12px] uppercase tracking-[.05em] text-muted`}
          >
            <span>Opponent</span>
            <span className="text-center">Score</span>
            <span className="text-right">Date</span>
            <span />
          </div>

          {weeks.map((week) => (
            <div key={week.week ?? "preseason"}>
              <WeekDivider week={week.week} items={week.items} />
              {week.items.map((series) => (
                <SeriesRow
                  key={series.key}
                  series={series}
                  teamName={team_name}
                  open={openKey === series.key}
                  onToggle={() => setOpenKey(openKey === series.key ? null : series.key)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

export default TeamSeriesTab;
