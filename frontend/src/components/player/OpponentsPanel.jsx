import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import ScoreChip from "./ScoreChip";
import SegmentedControl from "./SegmentedControl";
import usePanelData from "./usePanelData";
import { formatPercent } from "../../utils/format";

const MODES = [
  { id: "players", label: "Players" },
  { id: "teams", label: "Teams" },
];
/** One win against a hero is not evidence, so a record needs this many games. */
const MIN_GAMES = 3;
const GROUP_SIZE = 3;
const ROW = "grid grid-cols-[minmax(0,1fr)_44px_40px] items-center gap-2";

/**
 * Who the player beats and who they lose to, by player and by team.
 *
 * The two groups are ordered by win differential, which is the same thing as win
 * rate because each row's games count is fixed. Rows are never shown twice: when
 * fewer than six records qualify, the worst group only takes what the best group
 * left over, and if nothing qualifies the panel says why instead of inventing a
 * ranking from one-game samples.
 */
export default function OpponentsPanel({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/opponents`, {
    errorMessage: "Could not load opponents",
  });
  const [mode, setMode] = useState("players");

  const rows = mode === "players" ? (data?.players ?? []) : (data?.teams ?? []);

  const groups = useMemo(() => {
    const rated = rows.filter((row) => row.games >= MIN_GAMES);
    const byDifferential = (best, pool) =>
      [...pool]
        .sort((a, b) => {
          const diff = b.wins - b.losses - (a.wins - a.losses);
          return (best ? diff : -diff) || b.games - a.games || a.name.localeCompare(b.name);
        })
        .slice(0, GROUP_SIZE);

    const best = byDifferential(true, rated);
    const bestIds = new Set(best.map((row) => row.name));
    const worst = byDifferential(
      false,
      rated.filter((row) => !bestIds.has(row.name)),
    );
    return { best, worst, rated: rated.length };
  }, [rows]);

  const renderRow = (row) => (
    <Link
      key={row.name}
      to={mode === "players" ? `/player/${row.account_id}` : `/team/${encodeURIComponent(row.name)}`}
      className={`${ROW} min-h-8 text-[13px] transition-colors hover:bg-accent-secondary/[0.06]`}
    >
      <span className="truncate text-primary" title={row.name}>
        {row.name}
      </span>
      <ScoreChip
        wins={row.wins}
        losses={row.losses}
        className="justify-end text-[13px]"
        title={`${row.wins}–${row.losses} against ${row.name}`}
      />
      <span className="text-right text-[12px] tabular-nums text-muted">
        {row.win_rate == null ? "—" : formatPercent(row.win_rate * 100)}
      </span>
    </Link>
  );

  const empty = mode === "players" ? (data?.players ?? []).length === 0 : (data?.teams ?? []).length === 0;

  return (
    <Panel
      title="Opponents"
      subtitle={`Best and worst records · min ${MIN_GAMES} games against`}
      action={<SegmentedControl options={MODES} value={mode} onChange={setMode} label="Opponent type" />}
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={5} />
      ) : empty ? (
        <p className="text-sm text-muted">No opponents on record yet.</p>
      ) : groups.rated === 0 ? (
        <p className="text-[12px] text-dim">
          Not enough games — a record needs {MIN_GAMES}+ games against, and none of the{" "}
          {rows.length} faced qualify yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {[
            { id: "best", label: "Best records", className: "text-success", items: groups.best },
            { id: "worst", label: "Worst records", className: "text-danger-text", items: groups.worst },
          ].map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              <span className={`text-[10px] uppercase tracking-[.06em] ${group.className}`}>
                {group.label}
              </span>
              {group.items.length === 0 ? (
                <span className="text-[12px] text-dim">Nobody left after the best three.</span>
              ) : (
                group.items.map(renderRow)
              )}
            </div>
          ))}

          {mode === "teams" && data?.unresolved_games > 0 && (
            <span className="text-[11px] text-dim">
              {data.unresolved_games} game{data.unresolved_games === 1 ? "" : "s"} had no
              opponent team recorded, so they are in neither list.
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
