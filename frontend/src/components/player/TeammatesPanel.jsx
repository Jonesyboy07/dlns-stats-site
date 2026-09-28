import React, { useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import PlayerAvatar from "../PlayerAvatar";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { formatPercent } from "../../utils/format";

const ROW = "grid grid-cols-[26px_minmax(0,1fr)_34px_44px] items-center gap-2.5";
const DEFAULT_LIMIT = 6;
/** A win rate worth colouring: comfortable above 55%, worrying below 45%. */
const rateClass = (rate) =>
  rate == null
    ? "text-dim"
    : rate >= 0.55
      ? "text-success"
      : rate < 0.45
        ? "text-danger-text"
        : "text-secondary";

/**
 * Who the player wins with. Rows are ordered by games together, and each one links
 * to that player's page; the team shown is the one they shared most often, because
 * a roster's worth of players move between teams over a season.
 */
export default function TeammatesPanel({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/teammates`, {
    errorMessage: "Could not load teammates",
  });
  const [showAll, setShowAll] = useState(false);

  const teammates = data?.teammates ?? [];
  const shown = showAll ? teammates : teammates.slice(0, DEFAULT_LIMIT);

  return (
    <Panel
      title="Teammates"
      subtitle="Most games together · win rate together"
      action={
        teammates.length > DEFAULT_LIMIT ? (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="text-[12px] text-accent-secondary-light transition-colors hover:text-accent-secondary"
          >
            {showAll ? "Show fewer" : `All ${teammates.length}`}
          </button>
        ) : null
      }
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={5} />
      ) : teammates.length === 0 ? (
        <p className="text-sm text-muted">No teammates on record yet.</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((mate) => (
            <Link
              key={mate.account_id}
              to={`/player/${mate.account_id}`}
              className={`${ROW} min-h-9 border-b border-border transition-colors hover:bg-accent-secondary/[0.06]`}
            >
              <PlayerAvatar
                player={{ persona_name: mate.persona_name, avatar_url: mate.avatar_url }}
                size="h-[26px] w-[26px]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-primary" title={mate.persona_name}>
                  {mate.persona_name}
                </span>
                <span className="truncate text-[11px] text-dim" title={mate.team || "Unknown team"}>
                  {mate.team ?? "—"}
                </span>
              </span>
              <span className="text-right text-[12px] tabular-nums text-muted">{mate.games} g</span>
              <span
                className={`text-right text-[12px] font-bold tabular-nums ${rateClass(mate.win_rate)}`}
                title={`${mate.wins}–${mate.losses} together`}
              >
                {mate.win_rate == null ? "—" : formatPercent(mate.win_rate * 100)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
