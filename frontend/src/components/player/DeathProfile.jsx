import React from "react";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { formatDuration, formatInteger } from "../../utils/format";

const DASH = "—";
const PHASE_COLOUR = "bg-danger/55";
const MAX_BAR_PX = 52;

/** Deaths, when they happen, and the game phase they fall in. Phase bars, no map heatmap. */
export default function DeathProfile({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/deaths`, {
    errorMessage: "Could not load the death profile",
  });

  const games = data?.games ?? 0;
  const totalTimed =
    (data?.phases ?? []).reduce((sum, phase) => sum + (phase.count ?? 0), 0) || 0;
  const maxShare = Math.max(1, ...(data?.phases ?? []).map((phase) => phase.count ?? 0));
  const deathCoverage =
    data && games > 0 && data.games_with_death_data < games
      ? `from ${data.games_with_death_data} of ${games} games`
      : null;

  const tiles = [
    {
      label: "Deaths / game",
      value: data?.deaths_per_game == null ? DASH : data.deaths_per_game.toFixed(2),
      note: "lower is better",
    },
    {
      label: "Avg death time",
      value: data?.avg_death_time_s == null ? DASH : formatDuration(data.avg_death_time_s),
      note:
        data?.timed_deaths != null && data?.deaths != null && data.timed_deaths < data.deaths
          ? `from ${formatInteger(data.timed_deaths)} of ${formatInteger(data.deaths)} deaths`
          : "time into the game",
    },
    {
      label: "Deaths / min",
      value: data?.deaths_per_min == null ? DASH : data.deaths_per_min.toFixed(2),
      note: "lower is better",
    },
  ];

  return (
    <Panel
      title="Death Profile"
      subtitle={deathCoverage ? `When they die · ${deathCoverage}` : "When they die"}
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="flex flex-col gap-1 rounded-[10px] border border-border bg-table px-3 py-2.5"
              >
                <span className="text-[10px] uppercase tracking-[.06em] text-dim">
                  {tile.label}
                </span>
                <span className="font-valve-oracle text-[22px] font-semibold leading-none text-primary">
                  {tile.value}
                </span>
                <span className="text-[11px] text-dim">{tile.note}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[.05em] text-dim">
              Deaths by game phase
            </span>
            <div className="grid h-[78px] grid-cols-3 items-end gap-2">
              {(data?.phases ?? []).map((phase) => {
                const count = phase.count ?? 0;
                const share = totalTimed > 0 ? count / totalTimed : 0;
                const height = Math.max(2, Math.round((count / maxShare) * MAX_BAR_PX));
                const perGame = games > 0 ? (count / games).toFixed(1) : DASH;
                return (
                  <div key={phase.id} className="flex h-full flex-col justify-end gap-1">
                    <span
                      className="text-center text-[12px] tabular-nums text-primary"
                      title={`${phase.label}: ${count} deaths`}
                    >
                      {perGame} · {Math.round(share * 100)}%
                    </span>
                    <span
                      aria-hidden="true"
                      className={`rounded-t ${PHASE_COLOUR}`}
                      style={{ height: `${height}px` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted">
              {(data?.phases ?? []).map((phase) => (
                <span key={phase.id}>{phase.label}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
