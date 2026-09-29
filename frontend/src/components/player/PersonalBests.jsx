import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import Panel from "./Panel";
import { formatCompact, formatDuration, formatKda } from "../../utils/format";
import { matchLabel, personalBests } from "../../utils/playerStats";

const DASH = "—";

/**
 * Personal Bests: five single-game records taken from the player's already-loaded
 * matches, so this panel has no request of its own. Each tile links to the game
 * the record was set in, and the record number is the only gold on the page.
 */
export default function PersonalBests({ matches = [] }) {
  const { games, records } = useMemo(() => personalBests(matches), [matches]);

  const tiles = records.map((record) => {
    const hero = record.match?.hero_name || "Unknown hero";
    const label = matchLabel(record.match);
    switch (record.id) {
      case "kda":
        return {
          ...record,
          title: "Best KDA",
          value: formatKda(record.value),
          context: `${hero} · ${record.match.kills}/${record.match.deaths}/${record.match.assists} · ${label}`,
        };
      case "souls":
        return {
          ...record,
          title: "Most souls",
          value: formatCompact(record.value),
          context: `${hero} · ${label}`,
        };
      case "damage":
        return {
          ...record,
          title: "Most hero dmg",
          value: formatCompact(record.value),
          context: `${hero} · ${label}`,
        };
      case "longestWin":
        return {
          ...record,
          title: "Longest win",
          value: formatDuration(record.value),
          context: `${hero} · ${label}`,
        };
      default:
        return {
          ...record,
          title: "Win streak",
          value: String(record.value),
          context: `${matchLabel(record.from)} → ${matchLabel(record.to)}`,
        };
    }
  });

  return (
    <Panel
      title="Personal Bests"
      subtitle={
        games > 0
          ? `League games only · ${games} games · best game in gold`
          : "League games only · best game in gold"
      }
    >
      {tiles.length === 0 ? (
        <p className="text-sm text-muted">No league games on record yet.</p>
      ) : (
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
        >
          {tiles.map((tile) => (
            <Link
              key={tile.id}
              to={`/match/${tile.match.match_id}`}
              className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-border bg-table px-3 py-2.5 transition-colors hover:border-accent-border"
            >
              <span className="text-[10px] uppercase tracking-[.06em] text-dim">
                {tile.title}
              </span>
              <span className="font-valve-oracle text-[26px] leading-none text-warning">
                {tile.value ?? DASH}
              </span>
              <span className="truncate text-[12px] text-muted" title={tile.context}>
                {tile.context}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
