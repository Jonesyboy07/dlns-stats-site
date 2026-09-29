import React from "react";
import HeroIcon from "../HeroIcon";
import ScoreChip from "./ScoreChip";
import { formatPercent } from "../../utils/format";

const DASH = "—";
/** A win rate worth colouring: comfortable above 55%, worrying below 45%. */
const rateClass = (rate) =>
  rate == null ? "text-dim" : rate >= 0.55 ? "text-success" : rate < 0.45 ? "text-danger-text" : "text-secondary";

const MATCHUP_MIN_GAMES = 3;

/**
 * Best and worst enemy heroes, three each. The minimum-games gate exists because
 * one won game against a hero is not evidence, and the note says so out loud.
 */
function MatchupList({ matchups = [], heroName }) {
  const rated = matchups.filter((row) => row.games >= MATCHUP_MIN_GAMES);
  // Order by win differential (wins minus losses), which is the same thing as
  // ordering by win rate here because the games count is fixed per row.
  const byDifferential = (best) =>
    [...rated]
      .sort((a, b) => {
        const diff = b.wins - b.losses - (a.wins - a.losses);
        return (best ? diff : -diff) || b.games - a.games || a.hero_name.localeCompare(b.hero_name);
      })
      .slice(0, 3);

  if (rated.length === 0) {
    return (
      <p className="text-[12px] text-dim">
        Not enough games — matchups need {MATCHUP_MIN_GAMES}+ games against a hero
        {matchups.length > 0 ? ` (${matchups.length} faced, all below that)` : ""}.
      </p>
    );
  }

  const groups = [
    { id: "best", label: "Best", className: "text-success", rows: byDifferential(true) },
    { id: "worst", label: "Worst", className: "text-danger-text", rows: byDifferential(false) },
  ];

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <span className={`text-[10px] uppercase tracking-[.06em] ${group.className}`}>
            {group.label}
          </span>
          {group.rows.map((row) => (
            <div
              key={row.hero_id}
              className="grid min-h-8 grid-cols-[26px_minmax(0,1fr)_44px_40px] items-center gap-2.5 text-[13px]"
            >
              <HeroIcon name={row.hero_name} size="h-[26px] w-[26px]" />
              <span className="truncate text-primary" title={`vs ${row.hero_name}`}>
                vs {row.hero_name}
              </span>
              <ScoreChip
                wins={row.wins}
                losses={row.losses}
                className="justify-end text-[13px]"
                title={`${row.wins}–${row.losses} vs ${row.hero_name} on ${heroName}`}
              />
              <span className="text-right text-[12px] tabular-nums text-muted">
                {formatPercent(((row.wins / row.games) || 0) * 100)}
              </span>
            </div>
          ))}
        </div>
      ))}
      <span className="text-[11px] text-dim">
        Min {MATCHUP_MIN_GAMES} games vs the hero · {rated.length} of {matchups.length} faced qualify.
      </span>
    </div>
  );
}

/**
 * Lane split and the head-to-head record, as one card with a toggle so the trend
 * row beside it stays balanced. A lane the ingest never recorded is its own row,
 * drawn as a dashed outline rather than a colour — never colour alone.
 */
export default function LaneCardBody({ tab, lanes, matchups, heroName }) {
  if (tab === "matchups") {
    return <MatchupList matchups={matchups} heroName={heroName} />;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {lanes.rows.map((row) => (
          <span
            key={row.id ?? "unknown"}
            className={`flex-none ${row.color ? "" : "border border-dashed border-border-lighter"}`}
            style={{
              flex: `${row.games} 0 0`,
              background: row.color ?? "transparent",
              opacity: row.games === 0 ? 0 : 1,
            }}
            title={`${row.name} ${row.games} games`}
          />
        ))}
      </div>

      {lanes.rows.map((row) => (
        <div
          key={row.id ?? "unknown"}
          className="grid grid-cols-[10px_minmax(0,1fr)_30px_40px_52px] items-center gap-2.5 text-[13px]"
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-[2px] ${
              row.color ? "" : "border border-dashed border-border-lighter"
            }`}
            style={{ background: row.color ?? "transparent" }}
          />
          <span className="text-primary">{row.name}</span>
          <span className="text-right tabular-nums text-muted">{row.games}</span>
          <span className="text-right tabular-nums text-dim">
            {row.share == null ? DASH : formatPercent(row.share * 100)}
          </span>
          <span className={`text-right font-bold tabular-nums ${rateClass(row.winRate)}`}>
            {row.winRate == null ? DASH : formatPercent(row.winRate * 100)}
          </span>
        </div>
      ))}

      <span className="text-[11px] text-dim">
        Right column: win rate in that lane. &quot;—&quot; = no decided game there.
      </span>
    </div>
  );
}
