import React, { useState } from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import { RESULT_CHIP_CLASS, resultGlyph } from "../player/resultStyles";
import { formatMatchDate } from "../../utils/format";
import { formatPercent } from "../../utils/heroPages";

const DASH = "—";
const TEAM_COLOR = ["var(--color-team-amber)", "var(--color-team-sapphire)"];
const TEAM_LABEL = ["Hidden King", "Archmother"];
/** AP cost of an ability's 1st / 2nd / 3rd upgrade — the design's 1 / 2 / 5. */
const AP_COST = { 1: 1, 2: 2, 3: 5 };

/**
 * The meta trend's window. A hero gets ~3 games a week (median 2 decided) and a
 * third of all hero-weeks have no picks at all, so a WEEKLY rate is pure noise —
 * measured, 100% of weekly points sit under 10 games. The line pools the trailing
 * 8 weeks instead and is only drawn where that window holds 10+ decided games.
 */
const TREND_WINDOW = 8;
const TREND_MIN_DECIDED = 10;
const TREND_TICKS = [0, 25, 50, 75, 100];

/** Win % over the trailing `window` weeks, or null while the window is too thin. */
function rollingWinRate(weekly, window = TREND_WINDOW, minDecided = TREND_MIN_DECIDED) {
  return weekly.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    let wins = 0;
    let decided = 0;
    for (let step = from; step <= index; step += 1) {
      wins += weekly[step].wins ?? 0;
      decided += weekly[step].decided ?? 0;
    }
    return { decided, winRate: decided >= minDecided ? wins / decided : null };
  });
}

/**
 * Runs of consecutive drawable points. A gated week BREAKS the line rather than
 * being drawn, so a thin window never reads as a 0% or a 100%.
 */
function trendSegments(points, total) {
  const segments = [];
  let run = [];
  points.forEach((point, index) => {
    if (point.winRate == null) {
      if (run.length) segments.push(run);
      run = [];
      return;
    }
    run.push({ x: ((index + 0.5) / total) * 100, y: 100 - point.winRate * 100 });
  });
  if (run.length) segments.push(run);
  return segments;
}

const trendPath = (points) =>
  points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

/**
 * Picks per week as bars, with the 8-week rolling win rate drawn over them.
 *
 * The bars carry the volume signal, which is always honest (a count), and render
 * the weeks the hero was not picked as empty — that is what explains the gaps in
 * the line. The line is pooled over the trailing 8 weeks and skipped wherever the
 * window holds fewer than 10 decided games. The ban segment stacks on top once ban
 * drafts are recorded (hasBans).
 */
export function HeroMetaTrendPanel({ weekly = [], hasBans = false }) {
  const rows = weekly ?? [];
  const rolling = rollingWinRate(rows);
  const segments = trendSegments(rolling, rows.length);
  const totalGames = rows.reduce((sum, row) => sum + (row.games ?? 0), 0);
  const maxCount = Math.max(1, ...rows.map((row) => (row.games ?? 0) + (row.bans ?? 0)));

  let lastIndex = -1;
  rolling.forEach((point, index) => {
    if (point.winRate != null) lastIndex = index;
  });

  if (rows.length === 0 || lastIndex === -1) {
    return (
      <Panel title="Meta Trend" subtitle="Picks per week · 8-week rolling win rate">
        <p className="text-[13px] text-dim">
          {rows.length === 0 ? "Adding Soon" : "Not enough games for a trend yet"}
        </p>
      </Panel>
    );
  }

  const last = rolling[lastIndex];
  const earlier = lastIndex - TREND_WINDOW >= 0 ? rolling[lastIndex - TREND_WINDOW] : null;
  const delta =
    earlier && earlier.winRate != null ? (last.winRate - earlier.winRate) * 100 : null;

  return (
    <Panel title="Meta Trend" subtitle="Picks per week · 8-week rolling win rate">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-3.5 rounded bg-accent-secondary" />
            Win %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-sm border border-border-light bg-accent/30" />
            Picks
          </span>
          <span
            className={`flex items-center gap-1.5 ${hasBans ? "" : "text-dim"}`}
            title={hasBans ? "Bans per week, from recorded ban drafts" : "No ban drafts recorded yet"}
          >
            <span className="h-2.5 w-3 rounded-sm border border-border-light bg-danger/40" />
            {hasBans ? "Bans" : "Bans · none yet"}
          </span>
          {delta != null && (
            <span
              className={`ml-auto font-semibold ${delta >= 0 ? "text-success" : "text-danger-text"}`}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} pts over {TREND_WINDOW} weeks
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative h-[190px] w-[34px] shrink-0 text-[11px] text-dim">
            {TREND_TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${100 - tick}%` }}
              >
                {tick}%
              </span>
            ))}
          </div>

          <div className="relative h-[190px] flex-1 min-w-0">
            {TREND_TICKS.map((tick) => (
              <div
                key={tick}
                className={`absolute left-0 right-0 border-t ${
                  tick === 50 ? "border-dashed border-muted" : "border-border-light"
                }`}
                style={{ top: `${100 - tick}%` }}
              />
            ))}

            {/* Bars sit behind the line and use their own scale, so the counts are
                readable without stealing the percentage axis. */}
            <div className="absolute inset-0 flex items-end">
              {rows.map((row) => (
                <div
                  key={row.week}
                  className="flex h-full flex-1 flex-col justify-end px-[1px]"
                  title={`NS ${row.week}: ${row.games ?? 0} picks${row.bans ? `, ${row.bans} bans` : ""}`}
                >
                  <div
                    className="w-full rounded-t-sm bg-danger/40"
                    style={{ height: `${((row.bans ?? 0) / maxCount) * 100}%` }}
                  />
                  <div
                    className="w-full rounded-t-sm bg-accent/30"
                    style={{ height: `${((row.games ?? 0) / maxCount) * 100}%` }}
                  />
                </div>
              ))}
            </div>

            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              {segments.map((segment, index) => (
                <path
                  key={index}
                  d={trendPath(segment)}
                  fill="none"
                  className="stroke-accent-secondary"
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            </svg>

            <span
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent-secondary"
              style={{
                left: `${((lastIndex + 0.5) / rows.length) * 100}%`,
                top: `${100 - last.winRate * 100}%`,
              }}
            />
            <span
              className="absolute right-1 -translate-y-[150%] text-[12px] font-bold text-accent-secondary"
              style={{ top: `${100 - last.winRate * 100}%` }}
            >
              {formatPercent(last.winRate)}
            </span>
          </div>
        </div>

        {/* Positioned at the bar centres rather than inside a column, so a label is
            never clipped to "W" by an 11px-wide cell. The final week gets a label
            only when it is at least 3 bars clear of the last six-week one. */}
        <div className="relative h-4 pl-[42px] text-[11px] text-dim">
          {rows.map((row, index) => {
            const lastRow = rows.length - 1;
            const labelled = index % 6 === 0 || (index === lastRow && lastRow % 6 >= 3);
            if (!labelled) return null;
            return (
              <span
                key={row.week}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((index + 0.5) / rows.length) * 100}%` }}
              >
                W{row.week}
              </span>
            );
          })}
        </div>

        <p className="m-0 text-[13px] text-muted">
          The line is the rolling {TREND_WINDOW}-week win rate, drawn only where that window
          holds {TREND_MIN_DECIDED}+ decided games — weekly samples here are far too small to
          plot on their own. Bars are picks per week ({totalGames} in the league).
          {last && ` Latest: ${formatPercent(last.winRate)} over ${last.decided} games.`}
        </p>
      </div>
    </Panel>
  );
}

/** Side dot styling, exactly as the player page's match table shows it. */
const SIDE_DOT_CLASS = { 0: "bg-team-amber", 1: "bg-team-sapphire" };
/**
 * One template for the header and every row. The player and the matchup share a
 * column, stacked, so the panel reads on a narrow column without truncating the
 * team names to nothing.
 */
const RECENT_GRID = "grid grid-cols-[52px_minmax(0,1fr)_84px_78px_72px_18px] items-center gap-2";

/**
 * The last eight league games on this hero, by anyone, newest first. Mirrors the
 * player page's match table: the same Win/Loss chip and side dot, the same date
 * and `NS 57 · G2` week link, plus the team-vs-team matchup. The match id is a
 * small link icon instead of a number.
 */
export function HeroRecentGamesPanel({ recent = [] }) {
  return (
    <Panel title="Recent Games" subtitle="Last 8 league games">
      {recent.length === 0 ? (
        <p className="text-[13px] text-dim">Adding Soon</p>
      ) : (
        <div className="flex flex-col">
          <div className={`${RECENT_GRID} px-2 pb-2 text-[11px] uppercase tracking-[.05em] text-dim`}>
            <span>Result</span>
            <span>Player / Matchup</span>
            <span className="text-right">K / D / A</span>
            <span className="text-right">Date</span>
            <span className="text-right">Week</span>
            <span />
          </div>
          {recent.map((game) => {
            const outcome = game.result === true ? "W" : game.result === false ? "L" : "U";
            const side = game.side ?? null;
            const date = formatMatchDate(game.played);
            return (
              <div
                key={game.match_id}
                className={`${RECENT_GRID} rounded-md border-t border-border px-2 py-2 transition-colors hover:bg-accent-secondary-bg`}
              >
                <span className="flex items-center gap-1.5">
                  <Link
                    to={`/match/${game.match_id}`}
                    title={`Open match ${game.match_id}`}
                    className={`inline-flex min-w-11 justify-center rounded border px-1.5 py-0.5 text-[11px] font-bold ${RESULT_CHIP_CLASS[outcome]}`}
                  >
                    {resultGlyph(outcome, { long: true })}
                  </Link>
                  <span
                    title={side == null ? "Side unknown" : TEAM_LABEL[side]}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      side == null ? "bg-dim" : SIDE_DOT_CLASS[side]
                    }`}
                  />
                </span>

                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    to={`/player/${game.account_id}`}
                    title={game.persona_name ?? "Unknown"}
                    className="truncate text-[13px] text-primary no-underline transition-colors hover:text-accent-secondary-light"
                  >
                    {game.persona_name ?? "Unknown"}
                  </Link>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                    {game.team_a && game.team_b ? (
                      <>
                        <Link
                          to={`/team/${encodeURIComponent(game.team_a)}`}
                          title={`${game.team_a} team page`}
                          className="truncate text-secondary no-underline transition-colors hover:text-accent-secondary-light"
                        >
                          {game.team_a}
                        </Link>
                        <span className="shrink-0 text-dim">vs</span>
                        <Link
                          to={`/team/${encodeURIComponent(game.team_b)}`}
                          title={`${game.team_b} team page`}
                          className="truncate text-secondary no-underline transition-colors hover:text-accent-secondary-light"
                        >
                          {game.team_b}
                        </Link>
                      </>
                    ) : (
                      <span className="text-dim" title="Teams not recorded">
                        {DASH}
                      </span>
                    )}
                  </span>
                </span>

                <span className="text-right text-[13px] whitespace-nowrap tabular-nums text-secondary">
                  {game.kills} / {game.deaths} / {game.assists}
                </span>
                <span className="text-right text-[12px] tabular-nums text-muted">{date ?? DASH}</span>
                <span className="text-right text-[12px]">
                  {game.event_week != null ? (
                    <Link
                      to={`/week/${game.event_week}`}
                      title={`Night Shift ${game.event_week}`}
                      className="text-dim no-underline transition-colors hover:text-secondary"
                    >
                      NS {game.event_week}
                      {game.event_game ? ` · ${game.event_game.replace(/^game\s*/i, "G")}` : ""}
                    </Link>
                  ) : (
                    <span className="text-dim">Preseason</span>
                  )}
                </span>
                <span className="flex justify-end">
                  <Link
                    to={`/match/${game.match_id}`}
                    title={`Open match ${game.match_id}`}
                    aria-label={`Open match ${game.match_id}`}
                    className="text-dim transition-colors hover:text-accent-secondary-light"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6.5 3.5h6v6" />
                      <path d="M12.5 3.5 3.5 12.5" />
                    </svg>
                  </Link>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** The three most common ability orders, as a 16-step grid. */
export function HeroAbilityBuildPanel({ abilityBuilds, heroName }) {
  const [active, setActive] = useState(0);
  const builds = abilityBuilds?.builds ?? [];
  const abilities = abilityBuilds?.abilities ?? [];

  if (builds.length === 0) {
    return (
      <Panel title="Ability Build" subtitle={`Ability point order on ${heroName}`}>
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }

  const build = builds[Math.min(active, builds.length - 1)];
  const steps = build.steps ?? [];
  const opens = build.unlock_order ?? [];
  const maxOrder = build.max_order ?? [];

  return (
    <Panel
      title="Ability Build"
      subtitle={`Ability point order on ${heroName} · one column per unlock or upgrade, in order`}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-wrap gap-1 self-start rounded-full border border-border bg-table p-[3px]">
          {builds.map((entry, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActive(index)}
              aria-pressed={active === index}
              className={`flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                active === index
                  ? "bg-accent-secondary-bg-strong text-accent-secondary-light"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Build {index + 1}
              <span className={`text-[11px] font-medium ${active === index ? "text-secondary" : "text-dim"}`}>
                {formatPercent(entry.share)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 text-[13px] text-muted">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
            <span>
              <strong className="text-primary">{build.games}</strong> of {abilityBuilds.games} games ·{" "}
              <strong className="text-primary">{formatPercent(build.share)}</strong>
            </span>
            <span>
              <strong className="text-success">{build.wins}</strong>{" "}
              <span className="text-dim">–</span>{" "}
              <strong className="text-danger-text">{build.losses}</strong>
              <span className="ml-1">{formatPercent(build.win_rate)} win rate</span>
            </span>
            <span>
              Opens: <strong className="text-secondary">{opens.join(" → ")}</strong>
            </span>
          </div>
          <span>
            Max order: <strong className="text-secondary">{maxOrder.join(" → ") || DASH}</strong>
          </span>
        </div>

        <div className="scroll-thin min-w-0 overflow-x-auto">
          <div className="flex min-w-[620px] flex-col gap-1.5">
            <div className="grid items-center gap-1 text-[11px] text-dim" style={{ gridTemplateColumns: "150px repeat(16, minmax(28px, 1fr))" }}>
              <span className="pl-1 uppercase tracking-[.05em]">Step</span>
              {Array.from({ length: 16 }, (_, index) => (
                <span key={index} className="text-center">
                  {index + 1}
                </span>
              ))}
            </div>

            {abilities.map((ability) => (
              <div
                key={ability.slot}
                className="grid min-h-[40px] items-center gap-1 rounded-lg border border-border bg-table p-1"
                style={{ gridTemplateColumns: "150px repeat(16, minmax(28px, 1fr))" }}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border-[1.5px] border-dashed border-border-lighter text-[11px] font-bold text-dim">
                    {ability.slot}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-primary" title={ability.name}>
                    {ability.name}
                  </span>
                </div>
                {Array.from({ length: 16 }, (_, index) => {
                  const step = steps[index];
                  const mine = step && step[0] === ability.slot;
                  const tier = mine ? step[1] : null;
                  return (
                    <div key={index} className="flex h-[30px] items-center justify-center">
                      {mine && tier === 0 && (
                        <span
                          title="Unlock"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-accent-secondary-border-strong bg-accent-secondary-bg-strong"
                        >
                          <span className="h-2.5 w-2.5 rotate-45 rounded-sm bg-accent-secondary-light" />
                        </span>
                      )}
                      {mine && tier > 0 && (
                        <span
                          title={`Upgrade · ${AP_COST[tier]} AP`}
                          className="flex h-7 items-center gap-1 rounded-md border border-border-lighter bg-hover px-1.5 text-[13px] font-bold text-primary"
                        >
                          <span className="text-[9px] text-muted">◆</span>
                          {AP_COST[tier]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[12px] text-muted">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-accent-secondary-border-strong bg-accent-secondary-bg-strong">
              <span className="h-2 w-2 rotate-45 rounded-sm bg-accent-secondary-light" />
            </span>
            Unlock
          </span>
          <span className="flex items-center gap-2">
            <span className="flex h-6 items-center gap-1 rounded-md border border-border-lighter bg-hover px-1.5 text-[12px] font-bold text-primary">
              <span className="text-[8px] text-muted">◆</span>1
            </span>
            Upgrade · number = AP cost (1 / 2 / 5)
          </span>
          <span className="ml-auto text-dim">
            {abilityBuilds.other_games} game{abilityBuilds.other_games === 1 ? "" : "s"} used other orders
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** Net worth over game time, hero vs the league average. */
export function HeroSoulsCurvePanel({ souls, heroName }) {
  const hero = souls?.hero ?? [];
  const league = souls?.league ?? [];
  if (hero.length === 0) {
    return (
      <Panel title="Souls Curve" subtitle="Average net worth over game time vs the league-average hero">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }

  const peak = Math.max(
    1,
    ...hero.map((point) => point.net_worth ?? 0),
    ...league.map((point) => point.net_worth ?? 0),
  );
  const X = (minute) => (Math.min(minute, 40) / 40) * 100;
  const Yv = (value) => 100 - ((value ?? 0) / peak) * 100;
  const path = (rows) =>
    rows.map((row, index) => `${index ? "L" : "M"}${X(row.minute).toFixed(2)} ${Yv(row.net_worth).toFixed(2)}`).join(" ");

  const byMinute = new Map(league.map((row) => [row.minute, row.net_worth]));
  const cross = hero.find((row) => row.net_worth != null && (byMinute.get(row.minute) ?? Infinity) < row.net_worth);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    top: 100 - fraction * 100,
    label: `${Math.round((peak * fraction) / 1000)}k`,
  }));

  return (
    <Panel title="Souls Curve" subtitle="Average net worth over game time vs the league-average hero">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-3.5 rounded bg-accent-secondary" />
            {heroName}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 border-t-2 border-dashed border-muted" />
            League avg
          </span>
          <span className="ml-auto text-muted">
            {cross ? `Overtakes league avg at ~${cross.minute} min` : "Does not overtake the league average"}
          </span>
        </div>

        <div className="flex gap-2">
          <div className="relative h-[170px] w-[30px] shrink-0 text-[11px] text-dim">
            {ticks.map((tick) => (
              <span key={tick.top} className="absolute right-0 -translate-y-1/2" style={{ top: `${tick.top}%` }}>
                {tick.label}
              </span>
            ))}
          </div>
          <div className="relative h-[170px] flex-1 min-w-0">
            {ticks.map((tick) => (
              <div key={tick.top} className="absolute left-0 right-0 border-t border-border" style={{ top: `${tick.top}%` }} />
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <path d={`${path(hero)} L100 100 L0 100 Z`} className="fill-accent-secondary-bg-strong" />
              <path
                d={path(league)}
                fill="none"
                className="stroke-muted"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={path(hero)}
                fill="none"
                className="stroke-accent-secondary"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>

        <div className="flex justify-between pl-[38px] text-[11px] text-dim">
          <span>0</span>
          <span>10 min</span>
          <span>20 min</span>
          <span>30 min</span>
          <span>40 min</span>
        </div>
      </div>
    </Panel>
  );
}

/** Assigned lane vs where the hero actually played. */
export function HeroLanePanel({ lane, laneNames }) {
  const rows = lane?.rows ?? [];
  const total = lane?.total ?? 0;
  if (total === 0) {
    return (
      <Panel title="Lane Profile" subtitle="Assigned lane vs where the hero actually played">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }
  const max = Math.max(1, ...rows.flatMap((row) => [row.assigned, row.actual]));

  return (
    <Panel title="Lane Profile" subtitle="Assigned lane vs where the hero actually played">
      <div className="flex flex-col gap-3.5">
        {rows.map((row) => (
          <div key={row.lane} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px]">
              <span className="font-semibold" style={{ color: laneNames?.[row.lane]?.color }}>
                {laneNames?.[row.lane]?.name ?? `Lane ${row.lane}`}
              </span>
              <span className="text-muted">
                {row.assigned} assigned · {row.actual} actual
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-table">
              <div className="h-full rounded bg-border-lighter" style={{ width: `${(row.assigned / max) * 100}%` }} />
            </div>
            <div className="h-2 overflow-hidden rounded bg-table">
              <div className="h-full rounded bg-accent-secondary" style={{ width: `${(row.actual / max) * 100}%` }} />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3.5 text-[12px] text-dim">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded bg-border-lighter" />
            Assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded bg-accent-secondary" />
            Actual
          </span>
          <span className="ml-auto text-muted">
            Stayed in assigned lane {formatPercent(lane.stayed_share)}
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** Win rate by team side. */
export function HeroSideSplitPanel({ sides = [] }) {
  if (sides.length === 0) {
    return (
      <Panel title="Side Split" subtitle="Win rate by team side">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }
  return (
    <Panel title="Side Split" subtitle="Win rate by team side">
      <div className="grid grid-cols-2 gap-2.5">
        {sides.map((side) => (
          <div
            key={side.team}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-table p-3"
          >
            <span className="flex items-center gap-2 text-[12px] font-semibold text-secondary">
              <span className="h-2 w-2 rounded-full" style={{ background: TEAM_COLOR[side.team] }} />
              {TEAM_LABEL[side.team]}
            </span>
            <span className="font-valve-oracle text-[28px] leading-none text-primary">
              {formatPercent(side.win_rate)}
            </span>
            <span className="text-[12px] text-dim">
              {side.games} games ·{" "}
              <span className={side.wins >= side.games - side.wins ? "text-success" : "text-secondary"}>
                {side.wins}W
              </span>
              –
              <span className={side.games - side.wins > side.wins ? "text-danger-text" : "text-secondary"}>
                {side.games - side.wins}L
              </span>
            </span>
            <div className="h-1.5 overflow-hidden rounded bg-hover">
              <div
                className="h-full"
                style={{ width: `${(side.win_rate ?? 0) * 100}%`, background: TEAM_COLOR[side.team] }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const LENGTH_LABEL = { under25: "< 25 min", mid: "25–35 min", over35: "35+ min" };
const LENGTH_MIN_GAMES = 8;

/** Win rate by game length, with the 8-game gate. */
export function HeroGameLengthPanel({ lengths = [] }) {
  const byBucket = new Map(lengths.map((row) => [row.bucket, row]));
  const buckets = ["under25", "mid", "over35"].map(
    (id) => byBucket.get(id) ?? { bucket: id, games: 0, wins: 0, decided: 0, win_rate: null },
  );

  return (
    <Panel title="Game-Length Profile" subtitle="Win rate by game length">
      <div className="flex flex-col gap-3">
        {buckets.map((bucket) => {
          const enough = bucket.games >= LENGTH_MIN_GAMES;
          const rate = bucket.win_rate ?? 0;
          return (
            <div key={bucket.bucket} className="grid grid-cols-[64px_minmax(0,1fr)_92px] items-center gap-2.5 text-[13px]">
              <span className="font-semibold text-primary">{LENGTH_LABEL[bucket.bucket]}</span>
              {enough ? (
                <div className="relative h-[18px] rounded bg-table">
                  <div
                    className={`absolute inset-y-0 left-0 rounded ${rate >= 0.5 ? "bg-success" : "bg-danger-text"}`}
                    style={{ width: `${rate * 100}%` }}
                  />
                  <div className="absolute -top-[3px] -bottom-[3px] left-1/2 border-l border-dashed border-muted" />
                </div>
              ) : (
                <span className="rounded border border-dashed border-border-lighter px-2 py-[1px] text-[12px] text-dim">
                  Not enough games
                </span>
              )}
              <span className="whitespace-nowrap text-right">
                <span className={`font-bold ${enough ? "text-primary" : "text-dim"}`}>
                  {enough ? formatPercent(bucket.win_rate) : DASH}
                </span>{" "}
                <span className="text-[12px] text-dim">· {bucket.games}g</span>
              </span>
            </div>
          );
        })}
        <span className="text-[12px] text-dim">Dashed line = 50%. Brackets need {LENGTH_MIN_GAMES}+ games.</span>
      </div>
    </Panel>
  );
}
