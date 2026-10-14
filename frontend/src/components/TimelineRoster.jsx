/**
 * The timeline's team rosters: who is on each side right now, and who is down.
 *
 * A pill is the timeline's one selection control -- highlighting a player adds their
 * lane below and narrows the feed and the map, so the roster is where the reader aims
 * the whole panel. The second team's panel is mirrored, which is what makes the two
 * sides read as opposing columns rather than one list under another.
 */

import Button from "./Button";
import HeroIcon from "./HeroIcon";
import { TEAM_STROKE } from "../utils/matchTimelineMap";

function PlayerPill({ player, selected, onToggle, heroName }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(player.account_id)}
      title={`${player.persona_name} – ${
        player.dead ? `dead, ${player.remainingS}s` : "alive"
      }`}
      className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition-colors ${
        selected
          ? "border-accent-border-strong bg-accent-bg-strong"
          : "border-border-light bg-badge-bg hover:border-border-lighter"
      }`}
    >
      {/* Only the portrait and the name dim while down: the countdown is the point. */}
      <HeroIcon
        name={heroName(player.hero_id)}
        size="h-5 w-5"
        className={`rounded-full ${player.dead ? "opacity-45 grayscale" : ""}`}
      />
      <span className={`${selected ? "text-accent-light" : "text-secondary"} ${
        player.dead ? "opacity-45" : ""
      }`}>
        {player.persona_name}
      </span>
      {player.dead && (
        <span className="text-[11px] font-semibold tabular-nums text-danger-text">
          {player.remainingS}s
        </span>
      )}
    </button>
  );
}

function TeamPanel({ side, teamName, mirrored, selection, onToggle, heroName }) {
  const color = TEAM_STROKE[side.team] ?? "#94a3b8";
  return (
    <div className="rounded-xl border border-border bg-table px-3 py-2.5">
      <div className={`flex items-center gap-2 ${mirrored ? "flex-row-reverse" : ""}`}>
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-xs font-semibold" style={{ color }}>
          {teamName}
        </span>
        <span className={`shrink-0 text-xs text-dim ${mirrored ? "mr-auto" : "ml-auto"}`}>
          {side.alive} alive
        </span>
      </div>
      <div className={`mt-2 flex flex-wrap gap-1.5 ${mirrored ? "justify-end" : ""}`}>
        {side.members.map((player) => (
          <PlayerPill
            key={player.account_id}
            player={player}
            selected={selection.includes(player.account_id)}
            onToggle={onToggle}
            heroName={heroName}
          />
        ))}
      </div>
    </div>
  );
}

export default function TimelineRoster({
  roster = [],
  selection = [],
  teamNames = [],
  onToggle = () => {},
  onClear = null,
  heroName = () => null,
  className = "",
}) {
  const [amber, sapphire] = roster;
  const hasSelection = selection.length > 0;

  return (
    <div className={`grid items-start gap-4 md:grid-cols-[1fr_auto_1fr] ${className}`}>
      {amber ? (
        <TeamPanel
          side={amber}
          teamName={teamNames[0] || "Amber"}
          mirrored={false}
          selection={selection}
          onToggle={onToggle}
          heroName={heroName}
        />
      ) : (
        <div />
      )}

      <div className="flex items-center justify-center">
        {hasSelection && onClear && (
          <Button variant="ghost" size="xs" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      {sapphire ? (
        <TeamPanel
          side={sapphire}
          teamName={teamNames[1] || "Sapphire"}
          mirrored
          selection={selection}
          onToggle={onToggle}
          heroName={heroName}
        />
      ) : (
        <div />
      )}
    </div>
  );
}
