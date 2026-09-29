import React from "react";
import ErrorMessage from "../ErrorMessage";
import ItemIcon from "../ItemIcon";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { timelinePositions } from "../../utils/buildTimeline";
import { formatDuration, formatInteger } from "../../utils/format";

const DASH = "—";

/**
 * Signature items (3,200+ souls) and when the build items are typically bought.
 * Each icon sits at its median buy time, alternating rows so neighbouring icons
 * cannot overlap; the numbered list underneath carries the same names in text, so
 * nothing is hover-only.
 */
export default function ItemsBuild({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/items`, {
    errorMessage: "Could not load items",
  });

  const gamesWithItems = data?.games_with_items ?? 0;
  const build = data?.build ?? [];
  const signature = data?.signature ?? [];
  const coverage =
    data && data.games > 0 && gamesWithItems < data.games
      ? `${gamesWithItems} of ${data.games} games`
      : null;

  // The track spans the data (earliest buy to latest, plus a little air) rather
  // than 0..latest, so the icons spread out instead of bunching in the top third.
  const placedLeft = timelinePositions(build.map((item) => item.median_time_s));

  return (
    <Panel
      title="Items & Build"
      subtitle={
        coverage
          ? `Signature items (3,200+ souls), then median buy times · ${coverage}`
          : "Signature items (3,200+ souls), then median buy times"
      }
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : signature.length === 0 && build.length === 0 ? (
        <p className="text-sm text-muted">No item data for this player yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {signature.length > 0 ? (
            <div className="grid grid-cols-3 gap-2.5">
              {signature.map((item) => (
                <div
                  key={item.item_id}
                  className="flex min-w-0 flex-col items-center gap-1 text-center"
                >
                  <ItemIcon icon={item.icon} name={item.item_name} size="h-11 w-11" />
                  <span
                    className="w-full truncate text-[12px] text-secondary"
                    title={`${item.item_name} · tier ${item.tier}`}
                  >
                    {item.item_name}
                  </span>
                  <span className="text-[11px] tabular-nums text-dim">
                    {gamesWithItems > 0
                      ? `${item.games} of ${gamesWithItems}`
                      : formatInteger(item.games)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-dim">
              No 3,200+ soul items bought yet — nothing qualifies as a signature item.
            </p>
          )}

          {build.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <div className="relative h-[62px]">
                <span
                  aria-hidden="true"
                  className="absolute left-0 right-0 top-[30px] h-0.5 bg-border-lighter"
                />
                {build.map((item, index) => (
                  <span
                    key={item.item_id}
                    className="absolute flex -translate-x-1/2 flex-col items-center gap-0.5"
                    style={{ left: `${placedLeft[index]}%`, top: index % 2 ? "18px" : "0px" }}
                  >
                    <ItemIcon icon={item.icon} name={item.item_name} size="h-6 w-6" className="rounded-[5px]" />
                    <span className="whitespace-nowrap text-[10px] tabular-nums text-muted">
                      {formatDuration(item.median_time_s)}
                    </span>
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted">
                {build.map((item, index) => (
                  <span key={item.item_id}>
                    {index + 1}. {item.item_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data?.games == null && (
            <p className="text-[11px] text-dim">{DASH}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
