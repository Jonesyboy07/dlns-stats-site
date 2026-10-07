import React from "react";
import { Link } from "react-router-dom";
import { formatDuration, roundName } from "../../utils/weekData";

/**
 * MatchResultsPanel — every game in scope as a pill linking to its match page.
 * Scores and winners are deliberately absent: the bracket already shows them.
 *
 * Props:
 *   brackets – per-region brackets (already narrowed to the scope)
 *   subline  – "8 games · Week #58 · both regions"
 */
export default function MatchResultsPanel({ brackets, subline }) {
  const visible = (brackets || []).filter((bracket) => bracket.series.length > 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border-light bg-card shadow">
      <header className="flex flex-col gap-[3px] px-4 py-3.5 md:gap-1 md:px-5 md:py-4">
        <h2 className="font-valve-oracle text-[18px] text-primary md:text-[20px]">Match Results</h2>
        <span className="text-[12px] text-muted md:text-[13px]">{subline}</span>
      </header>

      {visible.length === 0 && (
        <p className="px-5 pb-6 text-[13px] text-muted">No games in this scope.</p>
      )}

      {visible.map((bracket) => (
        <div
          key={bracket.name}
          className="flex flex-col gap-3.5 border-t border-border px-4 pt-3.5 pb-4 md:gap-3 md:px-5 md:pt-4 md:pb-5"
        >
          <span className="font-valve-pulp text-[22px] leading-none tracking-[.04em] text-primary">
            {bracket.name}
          </span>

          {bracket.series.map((series) => (
            <div key={series.key} className="flex min-w-0 flex-col gap-1.5">
              <span className="font-semibold text-[11px] tracking-[.06em] text-dim uppercase">
                {roundName(series)}
              </span>
              <span className="truncate text-[14px] text-secondary md:text-[13px]">
                {series.teamA} <span className="text-dim">vs</span> {series.teamB}
              </span>
              <div className="flex flex-wrap gap-2 md:gap-1.5">
                {series.games.map((game, index) => (
                  <GamePill key={game.match?.match_id ?? index} game={game} index={index} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

const PILL =
  "flex min-h-11 items-center gap-2 rounded-full border border-border-light bg-panel px-3.5 text-[13px] text-muted md:min-h-[30px] md:px-2.5 md:text-[12px]";

/** One game as a link to its match page, or a plain pill when it is not ingested. */
function GamePill({ game, index }) {
  const number = game.gameNo ?? index + 1;
  const duration = formatDuration(game.match?.duration_s);
  const ingested = Number.isFinite(game.match?.match_id) && game.match?.duration_s != null;
  const title = `Game ${number} · ${duration}`;
  const body = (
    <>
      <span className="font-bold text-secondary">G{number}</span>
      <span>{duration}</span>
      <span className="text-accent-light">↗</span>
    </>
  );

  if (!ingested) {
    return (
      <span className={`${PILL} opacity-60`} title={`Game ${number} · not ingested yet`}>
        <span className="font-bold text-secondary">G{number}</span>
        <span>—</span>
      </span>
    );
  }
  return (
    <Link to={`/match/${game.match.match_id}`} title={title} className={`${PILL} transition-colors hover:border-accent-border-strong hover:bg-accent-bg hover:text-secondary active:border-accent-border-strong active:bg-accent-bg active:text-secondary`}>
      {body}
    </Link>
  );
}
