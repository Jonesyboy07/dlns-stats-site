import React from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import { formatPercent } from "../../utils/heroPages";

const BAN_SLOTS = [1, 2, 3, 4];

/**
 * Bans: how often this hero is banned in games with a recorded ban draft
 * (bans are entered in the bracket editor, so older games have none).
 */
function HeroBansPanel({ data, failed }) {
  const subtitle = data?.drafted_games
    ? `Across ${data.drafted_games} game${data.drafted_games === 1 ? "" : "s"} with a ban draft`
    : "Games with a recorded ban draft";

  return (
    <Panel title="Bans" subtitle={subtitle}>
      {failed && <p className="text-[13px] text-dim">Couldn't load ban stats.</p>}
      {!failed && !data && <p className="text-[13px] text-dim">Loading…</p>}
      {data && data.drafted_games === 0 && <p className="text-[13px] text-dim">No ban drafts recorded yet.</p>}
      {data && data.drafted_games > 0 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Ban rate", formatPercent(data.ban_rate), `${data.bans} ban${data.bans === 1 ? "" : "s"}`],
              ["Presence", formatPercent(data.presence), `${data.picks} pick${data.picks === 1 ? "" : "s"} + bans`],
              [
                "Banning team won",
                data.banner_win_rate == null ? "–" : formatPercent(data.banner_win_rate),
                `${data.banner_wins} of ${data.bans}`,
              ],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded border border-border px-2.5 py-2">
                <div className="text-[11px] uppercase tracking-[.05em] text-dim">{label}</div>
                <div className="font-valve-oracle text-[20px] font-semibold text-primary">{value}</div>
                <div className="text-[12px] text-muted">{note}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[.05em] text-dim">By ban slot</div>
            <div className="grid grid-cols-4 gap-2">
              {BAN_SLOTS.map((slot) => (
                <div key={slot} className="rounded border border-border px-2 py-1.5 text-center">
                  <div className="text-[11px] text-dim">Ban {slot}</div>
                  <div className="text-[15px] font-semibold text-primary">{data.by_order?.[slot] ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          {data.teams.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[.05em] text-dim">Banned most by</div>
              {data.teams.map((t) => (
                <div key={t.team} className="flex justify-between border-t border-border py-1.5 text-[13px]">
                  <Link to={`/team/${encodeURIComponent(t.team)}`} className="truncate no-underline">
                    {t.team}
                  </Link>
                  <span className="text-muted">{t.bans}</span>
                </div>
              ))}
            </div>
          )}

          {data.recent.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[.05em] text-dim">Recent bans</div>
              {data.recent.map((r) => (
                <div key={`${r.match_id}-${r.order}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-border py-1.5 text-[13px]">
                  <span className="truncate">
                    <span className="text-primary">{r.team_name}</span>
                    <span className="text-muted">
                      {r.against ? ` vs ${r.against}` : ""} · ban {r.order}
                      {r.event_week != null ? ` · week ${r.event_week}` : ""}
                    </span>
                  </span>
                  <Link to={`/match/${r.match_id}`} className="whitespace-nowrap no-underline">
                    #{r.match_id} →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export default HeroBansPanel;
