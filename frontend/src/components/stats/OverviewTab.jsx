import React from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import { cdnImage } from "../../utils/cdn";
import { formatDuration } from "../../utils/format";

const SAPPHIRE_TEXT = "oklch(0.7 0.17 261.44)";
const AMBER_LOGO_FILTER =
  "brightness(0) saturate(100%) invert(64%) sepia(14%) saturate(3308%) hue-rotate(1deg) brightness(106%) contrast(103%)";
const SAPPHIRE_LOGO_FILTER =
  "brightness(0) saturate(100%) invert(24%) sepia(96%) saturate(1698%) hue-rotate(203deg) brightness(94%) contrast(115%)";
const SIDE_NAME = { amber: "Amber", sapphire: "Sapphire" };

function Empty({ children = "No games in range." }) {
  return <p className="py-6 text-center text-[13px] text-dim">{children}</p>;
}

function pct(value, digits = 1) {
  return `${Number(value).toFixed(digits)}%`;
}

function vs(game) {
  return game?.team_a && game?.team_b ? `${game.team_a} vs ${game.team_b}` : `Match #${game?.match_id}`;
}

/* ── This week ── */

function WeekCard({ kicker, hero, value, line, sub }) {
  return (
    <SectionCard className="min-w-0">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-light">{kicker}</span>
        <div className="flex min-w-0 items-center gap-2.5">
          {hero && <HeroIcon name={hero} size="h-[34px] w-[34px]" className="rounded-md" />}
          <span className="whitespace-nowrap font-valve-pulp text-[24px] leading-none text-primary md:text-[30px]">
            {value}
          </span>
        </div>
        <span title={line} className="truncate text-[13px] font-medium text-secondary">
          {line}
        </span>
        <span className="text-[12px] leading-[1.4] text-dim">{sub}</span>
      </div>
    </SectionCard>
  );
}

function swingLines(swing) {
  const { week, leader, previous, previous_leader: previousLeader, swung } = swing;
  // "All" is the whole event (no regions recorded yet), so it is left unnamed.
  const region = swing.region === "All" ? "" : `${swing.region} `;
  const line = !leader
    ? `Sides level in ${region}week ${week}`
    : `${SIDE_NAME[leader]} ${swung ? "took" : "led"} ${region}week ${week}`;
  let sub;
  if (!previous) sub = `No ${region}games in week ${week - 1}`;
  else if (!previousLeader) sub = `Level ${previous.amber_wins}–${previous.sapphire_wins} in week ${week - 1}`;
  else {
    const high = Math.max(previous.amber_wins, previous.sapphire_wins);
    const low = Math.min(previous.amber_wins, previous.sapphire_wins);
    sub = `${SIDE_NAME[previousLeader]} led ${region}${high}–${low} in week ${week - 1}`;
  }
  return { line, sub };
}

function ThisWeekCards({ thisWeek }) {
  const { week, riser, record, longest, side_swing: swing } = thisWeek;

  const cards = [
    riser
      ? {
          kicker: "Biggest riser",
          hero: riser.name,
          value: `+${riser.delta.toFixed(1)}`,
          line: riser.name,
          sub: `Pick rate ${pct(riser.pick_pct)}, up from ${pct(riser.prev_pick_pct)}`,
        }
      : { kicker: "Biggest riser", value: "—", line: "No pick rate rose", sub: `Week ${week} vs week ${week - 1}` },
    record
      ? {
          kicker: "Record set",
          hero: record.hero_name,
          value: Number(record.value).toLocaleString("en-GB"),
          line: record.persona_name || "Unknown player",
          sub: `${record.label} · ${record.hero_name ?? "Unknown hero"} · Week ${record.week}`,
        }
      : { kicker: "Record set", value: "—", line: "No new records", sub: `None of the range's records came in week ${week}` },
    longest
      ? {
          kicker: "Longest game",
          value: formatDuration(longest.duration_s),
          line: vs(longest),
          sub: [`Week ${longest.week}`, longest.region].filter(Boolean).join(" · "),
        }
      : { kicker: "Longest game", value: "—", line: "No games", sub: `Week ${week}` },
    swing
      ? {
          kicker: "Side swing",
          value: `${Math.max(swing.amber_wins, swing.sapphire_wins)}–${Math.min(swing.amber_wins, swing.sapphire_wins)}`,
          ...swingLines(swing),
        }
      : { kicker: "Side swing", value: "—", line: "No games", sub: `Week ${week}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <WeekCard key={card.kicker} {...card} />
      ))}
    </div>
  );
}

/* ── Pick rate vs win rate ── */

function ringColor(win) {
  if (win > 52.5) return "var(--color-success)";
  if (win < 47.5) return "var(--color-danger-text)";
  return "var(--color-secondary)";
}

const QUADRANTS = [
  { label: "Popular & winning", className: "top-2.5 right-3 text-success" },
  { label: "Popular & losing", className: "bottom-2.5 right-3 text-danger-text" },
  { label: "Niche & winning", className: "top-2.5 left-3 text-muted" },
  { label: "Niche & losing", className: "bottom-2.5 left-3 text-dim" },
];

function PickWinScatter({ heroes }) {
  const total = heroes?.matches ?? 0;
  const seen = {};
  const points = (heroes?.list ?? []).map((hero) => {
    const pick = total ? (hero.picks / total) * 100 : 0;
    const win = hero.picks ? (hero.wins / hero.picks) * 100 : 0;
    // Heroes on the same spot fan out to the right instead of hiding each other.
    const key = `${pick.toFixed(1)}|${win.toFixed(1)}`;
    const offset = (seen[key] = (seen[key] || 0) + 1) - 1;
    return { ...hero, pick, win, x: Math.min(100, pick + offset * 3.2) };
  });

  return (
    <SectionCard
      title="Pick rate vs win rate"
      subtitle="Each portrait is a hero. Midlines at 50%. Open Heroes for the full table."
    >
      {points.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex gap-2">
          <div className="rotate-180 text-center text-[11px] uppercase tracking-[0.05em] text-dim [writing-mode:vertical-rl]">
            Win %
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="relative h-[300px] overflow-hidden rounded-lg bg-table md:h-[520px]">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border-light" />
              <div className="absolute top-1/2 right-0 left-0 h-px bg-border-light" />
              {QUADRANTS.map((quadrant) => (
                <span
                  key={quadrant.label}
                  className={`absolute text-[11px] font-semibold uppercase tracking-[0.05em] ${quadrant.className}`}
                >
                  {quadrant.label}
                </span>
              ))}
              {points.map((point) => (
                <Link
                  key={point.hero_id}
                  to={`/hero/${point.hero_id}`}
                  title={`${point.name} · pick ${pct(point.pick)} · win ${pct(point.win)}`}
                  aria-label={`${point.name}, pick ${pct(point.pick)}, win ${pct(point.win)}`}
                  className="absolute h-[22px] w-[22px] -translate-x-1/2 translate-y-1/2 overflow-hidden rounded-full border-2 bg-card transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:z-[3] hover:scale-[1.35] motion-reduce:transition-none md:h-[30px] md:w-[30px]"
                  style={{
                    left: `calc(18px + (100% - 36px) * ${point.x / 100})`,
                    bottom: `calc(18px + (100% - 36px) * ${point.win / 100})`,
                    borderColor: ringColor(point.win),
                  }}
                >
                  <HeroIcon name={point.name} size="h-full w-full" className="rounded-none" />
                </Link>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-dim">
              <span>0%</span>
              <span className="uppercase tracking-[0.05em]">Pick %</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ── Side balance ── */

function SideTrend({ trend, range }) {
  const n = trend.length;
  const x = (i) => (n > 1 ? 15 + i * (270 / (n - 1)) : 150);
  // 0–100% maps to y 80–10, so the dashed 50% line sits at y 45.
  const y = (value) => 10 + ((100 - value) / 100) * 70;
  const points = trend.map((t, i) => (t.amber_pct == null ? null : [x(i), y(t.amber_pct)])).filter(Boolean);
  const inRange = trend.map((t, i) => (t.week >= range[0] && t.week <= range[1] ? i : null)).filter((i) => i != null);
  const last = points[points.length - 1];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[12px] text-dim">
        <span>Amber win % by week</span>
        <span>50% line</span>
      </div>
      <div className="relative">
        <svg viewBox="0 0 300 90" className="block h-auto w-full overflow-visible" aria-hidden="true">
          {inRange.length > 0 && (
            <rect
              x={x(inRange[0]) - 14}
              y="0"
              width={x(inRange[inRange.length - 1]) - x(inRange[0]) + 28}
              height="90"
              rx="6"
              fill="var(--color-accent-bg)"
            />
          )}
          <line x1="0" y1="45" x2="300" y2="45" stroke="oklch(100% 0 none / 0.18)" strokeDasharray="3 4" />
          {points.length > 1 && (
            <polyline
              points={points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}
              fill="none"
              stroke="var(--color-team-amber)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {last && (
            <circle cx={last[0]} cy={last[1]} r="4" fill="var(--color-team-amber)" stroke="var(--color-card)" strokeWidth="2" />
          )}
        </svg>
        <div className="relative mt-1 h-4">
          {trend.map((t, i) => (
            <span
              key={t.week}
              className={`absolute -translate-x-1/2 whitespace-nowrap text-[11px] ${
                t.week >= range[0] && t.week <= range[1] ? "text-accent-light" : "text-dim"
              } ${(n - 1 - i) % 2 === 1 ? "hidden md:inline" : ""}`}
              style={{ left: `${x(i) / 3}%` }}
            >
              Wk {t.week}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SideBalanceCard({ side, range, regionText }) {
  const total = side.amber_wins + side.sapphire_wins;
  const amberShare = total ? (side.amber_wins / total) * 100 : 50;

  return (
    <SectionCard title="Side balance" subtitle={`Hidden King vs Archmother · ${regionText}`}>
      {total === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-2.5 md:flex-row md:items-end">
              <img
                src={cdnImage("teamNames/team1_patron_logo_psd.png")}
                alt="Hidden King"
                className="h-[18px] max-w-full md:h-[34px]"
                style={{ filter: AMBER_LOGO_FILTER }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-valve-pulp text-[32px] leading-none text-team-amber">
                  {Math.round(amberShare)}%
                </span>
                <span className="text-[12px] text-muted">{side.amber_wins} wins</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-2.5 text-right md:flex-row-reverse md:items-end">
              <img
                src={cdnImage("teamNames/team2_patron_logo_psd.png")}
                alt="Archmother"
                className="h-[18px] max-w-full md:h-[34px]"
                style={{ filter: SAPPHIRE_LOGO_FILTER }}
              />
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-valve-pulp text-[32px] leading-none" style={{ color: SAPPHIRE_TEXT }}>
                  {Math.round(100 - amberShare)}%
                </span>
                <span className="text-[12px] text-muted">{side.sapphire_wins} wins</span>
              </div>
            </div>
          </div>
          <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full">
            <div className="bg-team-amber" style={{ width: `${amberShare}%` }} />
            <div className="flex-1 bg-team-sapphire" />
          </div>
          {side.trend?.length > 0 && <SideTrend trend={side.trend} range={range} />}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Match length ── */

function MatchLengthCard({ length }) {
  const buckets = length.buckets ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const modal = buckets.findIndex((b) => b.count === max);
  const callouts = [
    { label: "Average", value: formatDuration(length.average), sub: `Across ${length.games} games`, accent: true },
    { label: "Shortest", value: formatDuration(length.shortest?.duration_s), sub: vs(length.shortest) },
    { label: "Longest", value: formatDuration(length.longest?.duration_s), sub: vs(length.longest) },
  ];

  return (
    <SectionCard title="Match length" subtitle={`5-minute buckets · ${length.games} games`}>
      {length.games === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2.5">
            {callouts.map((callout) => (
              <div key={callout.label} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-[0.05em] text-dim">{callout.label}</span>
                <span
                  className={`font-valve-oracle text-[20px] font-bold ${callout.accent ? "text-accent-light" : "text-primary"}`}
                >
                  {callout.value ?? "—"}
                </span>
                <span title={callout.sub} className="truncate text-[11px] text-dim">
                  {callout.sub}
                </span>
              </div>
            ))}
          </div>
          <div className="flex h-[130px] items-end gap-2 border-b border-border-light">
            {buckets.map((bucket, i) => (
              <div key={bucket.start_s} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[12px] font-semibold text-secondary">{bucket.count}</span>
                <div
                  className={`w-full rounded-t-md ${i === modal ? "bg-accent" : "bg-hover"}`}
                  style={{ height: `${(bucket.count / max) * 80}%` }}
                />
              </div>
            ))}
          </div>
          <div className="-mt-2.5 flex gap-2">
            {buckets.map((bucket) => (
              <span key={bucket.start_s} className="flex-1 text-center text-[11px] text-dim">
                {bucket.start_s / 60}–{bucket.end_s / 60}
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[140px] animate-pulse rounded-xl border border-border-light bg-card" />
        ))}
      </div>
      <div className="grid gap-3.5 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="h-[360px] animate-pulse rounded-xl border border-border-light bg-card md:row-span-2 md:h-[600px]" />
        <div className="h-[290px] animate-pulse rounded-xl border border-border-light bg-card" />
        <div className="h-[290px] animate-pulse rounded-xl border border-border-light bg-card" />
      </div>
    </div>
  );
}

/**
 * Overview: "This week" highlights, then pick rate vs win rate beside side
 * balance and match length. Every number is for the filtered weeks and region.
 */
export default function OverviewTab({ summary, loading, range, regionText }) {
  if (loading || !summary) return <OverviewSkeleton />;
  if (!summary.range) return <Empty>No Night Shift games yet.</Empty>;

  return (
    <section className="flex flex-col gap-3.5" aria-label="Overview">
      <ThisWeekCards thisWeek={summary.this_week} />
      <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="min-w-0 md:row-span-2">
          <PickWinScatter heroes={summary.heroes} />
        </div>
        <SideBalanceCard side={summary.side} range={range} regionText={regionText} />
        <MatchLengthCard length={summary.length} />
      </div>
    </section>
  );
}
