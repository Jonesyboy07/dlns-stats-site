import React from "react";

const TONE = {
  win: "bg-success",
  loss: "bg-danger",
  unknown: "border border-dashed border-muted bg-transparent",
};

/**
 * Player × Hero trend body: one bar per game, oldest → newest, plotted against the
 * tallest game with a dashed average line across it.
 *
 * A game with no data for the metric (the oldest matches carry no snapshot) keeps a
 * thin placeholder bar rather than a zero-height one, so "no data" can never look
 * like "played badly". The bars are labelled with their value and coloured by
 * result, and the legend repeats the colours in words.
 */
const CHART_HEIGHT = 130;

export default function TrendChart({ trend, metric }) {
  const max = Math.max(1, (trend.max ?? 1) * 1.1);
  const position = (value) => (value == null ? 0 : (value / max) * CHART_HEIGHT);
  const heightFor = (value) => (value == null ? 3 : Math.max(3, position(value)));
  const average = trend.average;
  const averageLabel =
    average == null ? null : `avg ${metric === "spm" ? Math.round(average) : average.toFixed(2)}`;

  const formatValue = (value) => {
    if (value == null) return "—";
    return metric === "spm" ? String(Math.round(value)) : value.toFixed(1);
  };

  if (trend.points.length === 0) {
    return <p className="text-sm text-muted">No games on this hero yet.</p>;
  }

  // Twenty bars in a half-width panel leaves ~30px per bar, which a "30.0" label
  // does not fit in — so past a dozen games every other bar carries its value and
  // the rest tell it on hover.
  const labelEvery = trend.points.length > 12 ? 2 : 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative pt-4">
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 border-t border-dashed border-muted"
          style={{ bottom: `${position(average)}px` }}
        />
        {averageLabel && (
          <span
            className="absolute right-0 bg-card px-1 text-[10px] text-muted"
            style={{ bottom: `${position(average)}px`, transform: "translateY(-100%)" }}
          >
            {averageLabel}
          </span>
        )}
        <div
          className="grid items-end gap-1 border-b border-border-lighter"
          style={{
            gridTemplateColumns: `repeat(${trend.points.length}, minmax(0, 1fr))`,
            height: `${CHART_HEIGHT + 16}px`,
          }}
        >
          {trend.points.map((point, index) => {
            const outcome = point.outcome === "W" ? "win" : point.outcome === "L" ? "loss" : "unknown";
            return (
              <span
                key={point.match.match_id ?? index}
                className="flex h-full min-w-0 flex-col items-center justify-end gap-0.5"
                title={`${point.label} · ${outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Unknown"} · ${
                  metric === "spm" ? "souls/min" : "KDA"
                } ${formatValue(point.value)}`}
              >
                <span className="whitespace-nowrap text-[9px] tabular-nums text-muted">
                  {index % labelEvery === 0 || index === trend.points.length - 1
                    ? formatValue(point.value)
                    : ""}
                </span>
                <span
                  className={`w-full rounded-t-[3px] ${TONE[outcome]}`}
                  style={{ height: `${heightFor(point.value)}px` }}
                />
              </span>
            );
          })}
        </div>

        <div
          className="mt-1 grid gap-1 text-center text-[9px] text-dim"
          style={{ gridTemplateColumns: `repeat(${trend.points.length}, minmax(0, 1fr))` }}
        >
          {trend.points.map((point, index) => (
            <span key={point.match.match_id ?? index}>
              {index % 3 === 0 || index === trend.points.length - 1 ? (point.week ?? "") : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-success" />
          Win
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-danger" />
          Loss
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[2px] border border-dashed border-muted"
          />
          Unknown
        </span>
        <span className="ml-auto text-[11px] text-dim">
          {trend.points.length} games · {trend.games} with data
        </span>
      </div>
    </div>
  );
}
