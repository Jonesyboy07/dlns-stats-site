import React, { useMemo } from "react";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { formatCompact, formatPercent } from "../../utils/format";
import { SOUL_SOURCES } from "../../utils/soulSources";

const DASH = "—";
/**
 * Sources at or below this share are folded into one Miscellaneous row: at 1% a
 * source is a rounding error in the bar chart, and five of them turn the list into
 * a wall of near-identical rows. The row keeps its real total and share, and its
 * tooltip names every source that went into it.
 */
const FOLD_AT_SHARE = 0.01;
/** A lone small source keeps its name — folding one row saves nothing. */
const MIN_FOLDED = 2;

/** All 13 sources are present in the payload, even at zero, so the profile stays
 * comparable between players; the tail is folded for readability. */
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
        share: row?.share,
      };
    }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [data]);

  const { visible, misc } = useMemo(() => {
    const tail = rows.filter((row) => (row.share ?? 0) <= FOLD_AT_SHARE);
    if (tail.length < MIN_FOLDED) return { visible: rows, misc: null };
    const folded = tail.map((row) => ({ ...row, share: row.share ?? 0 }));
    const total = folded.reduce((sum, row) => sum + row.total, 0);
    const games = data?.games ?? 0;
    return {
      visible: rows.filter((row) => !tail.includes(row)),
      misc: {
        id: "miscellaneous",
        label: "Miscellaneous",
        total,
        perGame: games > 0 ? total / games : null,
        share: folded.reduce((sum, row) => sum + row.share, 0),
        sources: folded,
      },
    };
  }, [rows, data]);

  const list = misc ? [...visible, misc] : visible;
  const max = Math.max(1, ...list.map((row) => row.perGame ?? 0));
  const totalPerGame = data?.total_per_game ?? null;
  const games = data?.games ?? 0;
  const coverage =
    games > 0 && data?.total_games > games ? `${games} of ${data.total_games} games` : null;

  const miscTitle = (row) =>
    [
      `${row.sources.length} smallest sources · ${formatCompact(row.perGame)} / game`,
      ...row.sources.map(
        (source) => `${source.label} — ${formatCompact(source.perGame)} / game`,
      ),
    ].join("\n");

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
          {list.map((row, index) => {
            const width = row.perGame == null ? 0 : (row.perGame / max) * 100;
            const barClass = index < 3 ? "bg-accent-secondary" : "bg-accent-secondary/50";
            const title = row.sources ? miscTitle(row) : row.label;
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_44px_36px] items-center gap-2.5 text-[12px]"
              >
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <span
                    className={`truncate ${row.sources ? "text-muted" : "text-secondary"}`}
                    title={title}
                  >
                    {row.label}
                  </span>
                  <span className="h-1 rounded-full bg-table" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${barClass}`}
                      style={{ width: `${width.toFixed(1)}%` }}
                    />
                  </span>
                </div>
                <span
                  className={`text-right tabular-nums ${row.sources ? "text-muted" : "text-primary"}`}
                  title={title}
                >
                  {row.perGame == null ? DASH : formatCompact(row.perGame)}
                </span>
                <span className="text-right tabular-nums text-dim" title={title}>
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
