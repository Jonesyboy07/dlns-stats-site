import React from "react";
import Badge from "../Badge";
import SectionCard from "../SectionCard";
import { formatDuration } from "../../utils/format";
import { formatSignedDuration, formatSignedNumber } from "../../utils/statsPeriod";

const METRICS = [
  { key: "matches", label: "Matches" },
  { key: "length", label: "Avg match length" },
  { key: "split", label: "Side win split" },
  { key: "heroes", label: "Unique heroes" },
  { key: "players", label: "Unique players" },
];

const HATCH = "repeating-linear-gradient(135deg, transparent 0 6px, oklch(100% 0 none / .03) 6px 12px)";
const SAPPHIRE_TEXT = "oklch(0.7 0.17 261.44)";

function value(metric, summary) {
  switch (metric) {
    case "matches":
      return summary.matches.toLocaleString("en-GB");
    case "length":
      return formatDuration(summary.avg_duration) ?? "—";
    case "heroes":
      return summary.unique_heroes.toLocaleString("en-GB");
    case "players":
      return summary.unique_players.toLocaleString("en-GB");
    default:
      return null;
  }
}

function change(metric, latest, previous) {
  const diff = (key) => formatSignedNumber(latest[key] - previous[key]);
  switch (metric) {
    case "matches":
      return diff("matches");
    case "length":
      return latest.avg_duration != null && previous.avg_duration != null
        ? formatSignedDuration(latest.avg_duration - previous.avg_duration)
        : "—";
    case "split":
      return `Amber ${diff("amber_wins")}, Sapphire ${diff("sapphire_wins")}`;
    case "heroes":
      return diff("unique_heroes");
    default:
      return diff("unique_players");
  }
}

/** One cell's content, or the empty / no-games-last-week states. */
function cellFor(metric, block, { latestWeek, previousWeek }) {
  if (!block?.range) {
    return { empty: true, note: "No games in range", quiet: true };
  }
  const base = metric === "split"
    ? { split: [block.range.amber_wins, block.range.sapphire_wins] }
    : { text: value(metric, block.range) };
  if (!block.latest) return { ...base, note: "No games last week", quiet: true, hatched: true };
  if (!block.previous) return { ...base, note: `No games in wk ${previousWeek}`, quiet: true };
  return { ...base, note: change(metric, block.latest, block.previous) };
}

function Split({ amber, sapphire, size }) {
  return (
    <div
      className={`flex items-baseline gap-1.5 font-valve-oracle font-bold leading-[1.1] tabular-nums ${size}`}
    >
      <span className="text-team-amber">{amber.toLocaleString("en-GB")}</span>
      <span className="text-[16px] text-dim">–</span>
      <span style={{ color: SAPPHIRE_TEXT }}>{sapphire.toLocaleString("en-GB")}</span>
    </div>
  );
}

function Cell({ cell, desktop }) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-center border-t border-l border-border ${
        desktop ? "gap-[5px] px-4 py-3.5" : "gap-1 px-2.5 py-3"
      }`}
      style={cell.hatched ? { backgroundImage: HATCH } : undefined}
    >
      {cell.split ? (
        <Split amber={cell.split[0]} sapphire={cell.split[1]} size={desktop ? "text-[30px]" : "text-[22px]"} />
      ) : (
        <span
          className={`font-valve-pulp leading-none text-primary tabular-nums ${desktop ? "text-[32px]" : "text-[24px]"}`}
        >
          {cell.empty ? "—" : cell.text}
        </span>
      )}
      <span
        className={`text-[12px] ${desktop ? "truncate" : "leading-[1.3]"} ${
          cell.quiet ? "italic text-dim" : "text-secondary"
        }`}
      >
        {cell.note}
      </span>
    </div>
  );
}

function RegionHead({ row, latestWeek, size }) {
  return (
    <>
      <span className={`font-valve-oracle font-semibold leading-none text-primary ${size}`}>{row.region}</span>
      <span className="text-[12px] text-dim">
        {(row.block?.range?.matches ?? 0).toLocaleString("en-GB")} games
      </span>
      {row.block?.range && !row.block.latest && <Badge tone="warning">None in wk {latestWeek}</Badge>}
    </>
  );
}

function HeadlineSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={`h-20 animate-pulse rounded-xl border border-border-light bg-card ${i > 1 ? "hidden md:block" : ""}`}
        />
      ))}
    </div>
  );
}

/**
 * The headline "Strip": five numbers per region over the selected weeks, each
 * with the change from the previous week to the range's last week. Region = All
 * shows one row per region. Phones get the same table transposed: metrics down,
 * regions across.
 */
export default function HeadlineStrip({ summary, regionRows, weeksText, loading }) {
  const latestWeek = summary?.latest_week;
  const previousWeek = summary?.previous_week;
  const rows = regionRows.map((region) => ({ region, block: summary?.headline?.[region] }));
  const weeks = { latestWeek, previousWeek };

  return (
    <section className="flex flex-col gap-2.5" aria-label="Headline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-valve-oracle text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          Headline
        </h2>
        {summary?.range && (
          <span className="text-[12px] text-dim">
            Totals for {weeksText.charAt(0).toLowerCase() + weeksText.slice(1)} · change = week {latestWeek} vs
            week {previousWeek}
          </span>
        )}
      </div>

      {loading ? (
        <HeadlineSkeleton />
      ) : !summary?.range ? (
        <SectionCard>
          <p className="text-[13px] text-dim">No Night Shift games yet.</p>
        </SectionCard>
      ) : (
        <SectionCard className="px-4! py-3! md:px-5!">
          {/* Desktop: regions down, metrics across. */}
          <div className="scroll-thin -mx-2.5 hidden overflow-x-auto md:block">
            <div className="grid min-w-[680px] grid-cols-[130px_repeat(5,minmax(0,1fr))]">
              <span />
              {METRICS.map((metric) => (
                <span
                  key={metric.key}
                  className="truncate border-l border-border px-4 pt-1 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-dim"
                >
                  {metric.label}
                </span>
              ))}
              {rows.map((row) => (
                <React.Fragment key={row.region}>
                  <div className="flex flex-col items-start justify-center gap-1 border-t border-border px-2.5 py-3.5">
                    <RegionHead row={row} latestWeek={latestWeek} size="text-[22px]" />
                  </div>
                  {METRICS.map((metric) => (
                    <Cell key={metric.key} cell={cellFor(metric.key, row.block, weeks)} desktop />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Phone: metrics down, regions across. */}
          <div
            className="-mx-1.5 grid md:hidden"
            style={{ gridTemplateColumns: `minmax(0,.9fr) repeat(${rows.length}, minmax(0,1fr))` }}
          >
            <span />
            {rows.map((row) => (
              <div key={row.region} className="flex min-w-0 flex-col gap-[3px] border-l border-border px-2.5 pt-0.5 pb-2.5">
                <RegionHead row={row} latestWeek={latestWeek} size="text-[20px]" />
              </div>
            ))}
            {METRICS.map((metric) => (
              <React.Fragment key={metric.key}>
                <span className="flex items-center border-t border-border py-3 pr-2.5 pl-1.5 text-[11px] font-semibold uppercase leading-[1.3] tracking-[0.05em] text-dim">
                  {metric.label}
                </span>
                {rows.map((row) => (
                  <Cell key={row.region} cell={cellFor(metric.key, row.block, weeks)} />
                ))}
              </React.Fragment>
            ))}
          </div>
        </SectionCard>
      )}
    </section>
  );
}
