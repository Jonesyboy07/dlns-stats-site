import React, { useMemo } from "react";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { formatCompact, formatPercent } from "../../utils/format";
import { SOUL_SOURCES } from "../../utils/soulSources";

const DASH = "—";

/** All 13 sources are listed, even at zero, so the profile is comparable. */
export default function SoulsProfile({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/souls`, {
    errorMessage: "Could not load the souls profile",
  });

  const rows = useMemo(() => {
    const bySource = new Map((data?.sources ?? []).map((row) => [row.source, row]));
    return SOUL_SOURCES.map(({ id, label }) => {
      const row = bySource.get(id);
      return {
        id,
        label,
        total: row?.total ?? 0,
        perGame: row?.per_game ?? null,
        share: row?.share ?? null,
      };
    }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [data]);

  const max = Math.max(1, ...rows.map((row) => row.perGame ?? 0));
  const totalPerGame = data?.total_per_game ?? null;
  const games = data?.games ?? 0;
  const coverage =
    games > 0 && data?.total_games > games ? `${games} of ${data.total_games} games` : null;

  return (
    <Panel
      title="Souls Profile"
      subtitle={
        coverage
          ? `Where the souls come from · avg per game · ${coverage}`
          : "Where the souls come from · avg per game"
      }
      action={
        <span className="text-[12px] tabular-nums text-muted">
          {totalPerGame == null ? DASH : `${formatCompact(totalPerGame)} / game`}
        </span>
      }
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={6} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, index) => {
            const width = row.perGame == null ? 0 : (row.perGame / max) * 100;
            const barClass = index < 3 ? "bg-accent-secondary" : "bg-accent-secondary/50";
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_44px_36px] items-center gap-2.5 text-[12px]"
              >
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <span className="truncate text-secondary" title={row.label}>
                    {row.label}
                  </span>
                  <span className="h-1 rounded-full bg-table" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${barClass}`}
                      style={{ width: `${width.toFixed(1)}%` }}
                    />
                  </span>
                </div>
                <span className="text-right tabular-nums text-primary">
                  {row.perGame == null ? DASH : formatCompact(row.perGame)}
                </span>
                <span className="text-right tabular-nums text-dim">
                  {row.share == null ? DASH : formatPercent(row.share * 100)}
                </span>
              </div>
            );
          })}

          {games === 0 && (
            <p className="mt-1 text-[11px] text-dim">
              No soul data for this player yet — the oldest matches have no snapshot data.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
