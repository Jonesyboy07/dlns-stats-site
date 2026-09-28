import React, { useState } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import { formatDuration } from "../../utils/format";

/** Team names are hand-authored in matches.json, so compare them without case. */
const sameTeam = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/** "GAME 1" -> "Game 1"; anything else is shown as-is. */
const shortGame = (label) => {
  const match = /^game\s*(\w+)$/i.exec((label || "").trim());
  return match ? `Game ${match[1]}` : label || "—";
};

/**
 * Group flat match list into series by (event_team_a, event_team_b, event_title, event_week).
 * Matches arrive newest first, but a series reads far better as game 1 -> N, so
 * each group is re-ordered oldest first (the score chips follow the same order).
 */
function groupIntoSeries(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = [m.event_team_a, m.event_team_b, m.event_title, m.event_week].join("||");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return Array.from(map.values(), (games) => {
    if (games.length < 2) return games;
    if (games.every((m) => m.start_time)) {
      return [...games].sort((a, b) =>
        String(a.start_time).localeCompare(String(b.start_time))
      );
    }
    return [...games].reverse(); // the input list is newest-first
  });
}

/**
 * Fold the series list into weeks. Matches arrive newest first, so walking the
 * list in order keeps the weeks in recency order with each week's series
 * contiguous — that is what makes the dividers meaningful.
 */
function groupIntoWeeks(series) {
  const weeks = new Map();
  for (const games of series) {
    const week = games[0].event_week ?? null;
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(games);
  }
  return Array.from(weeks, ([week, rows]) => ({ week, rows }));
}

/** Win = true, loss = false, null when the side or the winner is unknown. */
function gameResult(match, teamName) {
  const side = match.event_team_a_ingame_side;
  if (side == null || match.winning_team == null) return null;
  const weAreTeamA = sameTeam(match.event_team_a, teamName);
  return weAreTeamA ? match.winning_team === side : match.winning_team !== side;
}

/** Tally game results from the page team's point of view. */
function tally(matchGroups, teamName) {
  let wins = 0;
  let losses = 0;
  for (const games of matchGroups) {
    for (const m of games) {
      const result = gameResult(m, teamName);
      if (result === true) wins++;
      else if (result === false) losses++;
    }
  }
  return { wins, losses, played: wins + losses > 0 };
}

/**
 * Week separator. Deliberately quiet — a hairline rule with the week on the
 * left and that week's game record on the right — so it groups the cards
 * beneath it without competing with them.
 */
function WeekDivider({ week, rows, team_name }) {
  const { wins, losses, played } = tally(rows, team_name);

  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {week != null ? `NS ${week}` : "Pre-season"}
      </span>
      <span className="h-px flex-1 bg-gray-700/60" />
      {played && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-600 tabular-nums">
          {wins}–{losses}
        </span>
      )}
    </div>
  );
}

function SeriesCard({ team_name, games }) {
  const [open, setOpen] = useState(false);

  const first = games[0];
  const opponent = sameTeam(first.event_team_a, team_name)
    ? first.event_team_b
    : first.event_team_a;

  const { wins, losses, played } = tally([games], team_name);
  const seriesWon = played && wins > losses;
  const seriesLost = played && losses > wins;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800/40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-3 py-3 text-left transition-colors hover:bg-gray-700/50"
      >
        {/* Result bar: green won, red lost, gray when the result is unknown. */}
        <div
          aria-hidden="true"
          className={`w-1 shrink-0 self-stretch rounded-full ${
            seriesWon ? "bg-green-500" : seriesLost ? "bg-red-500" : "bg-gray-600"
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-gray-100">
              vs {opponent || "Unknown"}
            </span>

            {/* Score, page team first. Only the number that decided the series
                carries a colour — the other stays white. */}
            {played && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                  seriesWon
                    ? "bg-green-700/40"
                    : seriesLost
                    ? "bg-red-700/40"
                    : "bg-gray-700"
                }`}
              >
                <span className={seriesWon ? "text-green-400" : "text-green-500"}>
                  {wins}
                </span>
                <span className="text-gray-500">–</span>
                <span className={seriesLost ? "text-red-400" : "text-red-400"}>
                  {losses}
                </span>
              </span>
            )}

            <span className="shrink-0 text-xs text-gray-500">
              {games.length} game{games.length !== 1 ? "s" : ""}
            </span>
          </div>

          <p className="mt-0.5 truncate text-xs text-gray-500">
            {first.event_title && `${first.event_title} · `}
            {first.event_week != null && `Week ${first.event_week} · `}
            {formatDate(first.start_time)}
          </p>
        </div>

        {/* Chevron */}
        <span
          className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-700/60 px-3 py-2">
          {/* Hero rows and the two-colour ladder are wide; scroll rather than squeeze. */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">

              <div className="divide-y divide-gray-700/40">
                {/* Column labels. The nesting mirrors a game row exactly
                    (flex-1 group + trailing VOD slot) so the labels sit over
                    the columns they describe. */}
                <div className="flex items-center gap-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-[4.5rem] shrink-0">Game</span>
                    <span className="min-w-0 flex-1 truncate">
                      {team_name} — hero icons
                    </span>
                    <span className="w-6 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      Opponent — hero icons
                    </span>
                    <span className="w-12 shrink-0 text-right">Length</span>
                  </div>
                  <span className="w-14 shrink-0 text-right">VOD</span>
                </div>

                {games.map((m) => {
                  const result = gameResult(m, team_name);
                  const weAreTeamA = sameTeam(m.event_team_a, team_name);
                  const ours = (weAreTeamA ? m.heroes_a : m.heroes_b) || [];
                  const theirs = (weAreTeamA ? m.heroes_b : m.heroes_a) || [];

                  return (
                    <div
                      key={m.match_id}
                      className="flex items-center gap-3 py-1.5 transition-colors hover:bg-gray-700/30"
                    >
                      <Link
                        to={`/match/${m.match_id}`}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <span className="flex w-[4.5rem] shrink-0 items-center gap-2">
                          <span className="whitespace-nowrap text-[11px] font-semibold text-gray-400">
                            {shortGame(m.event_game)}
                          </span>
                          {result != null && (
                            <span
                              className={`rounded px-1 py-px text-[10px] font-semibold ${
                                result
                                  ? "bg-green-700/40 text-green-400"
                                  : "bg-red-700/40 text-red-400"
                              }`}
                            >
                              {result ? "W" : "L"}
                            </span>
                          )}
                        </span>

                        <span className="flex min-w-0 flex-1 items-center gap-0.5">
                          {ours.map((hero, i) => (
                            <HeroIcon key={`a${i}`} name={hero.hero_name} size="h-8 w-8" />
                          ))}
                        </span>

                        <span className="w-6 shrink-0 text-center text-[10px] font-semibold uppercase text-gray-600">
                          vs
                        </span>

                        <span className="flex min-w-0 flex-1 items-center gap-0.5">
                          {theirs.map((hero, i) => (
                            <HeroIcon key={`b${i}`} name={hero.hero_name} size="h-8 w-8" />
                          ))}
                        </span>

                        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
                          {formatDuration(m.duration_s)}
                        </span>
                      </Link>

                      <span className="w-14 shrink-0 text-right">
                        {m.match_vod ? (
                          <a
                            href={m.match_vod}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300 transition-colors hover:bg-purple-500/25"
                          >
                            VOD
                          </a>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSeriesTab({ team_name, matches }) {
  const series = groupIntoSeries(matches);

  if (series.length === 0)
    return <p className="text-gray-600 text-sm">No series recorded.</p>;

  const weeks = groupIntoWeeks(series);

  return (
    <div className="space-y-6">
      {weeks.map(({ week, rows }) => (
        <div key={week ?? "preseason"} className="space-y-2">
          <WeekDivider week={week} rows={rows} team_name={team_name} />
          {rows.map((games, i) => (
            <SeriesCard key={i} team_name={team_name} games={games} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default TeamSeriesTab;
