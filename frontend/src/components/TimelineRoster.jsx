/**
 * The timeline's rosters: one row per team, six chips each, reading the current second.
 *
 * A chip is the timeline's one selection control -- highlighting a player adds their
 * lane below and narrows the feed and the map, so the roster is where the reader aims
 * the whole panel. Everything on a chip is a value at `t`, not a final stat: K/D come
 * from the kill events, assists and souls from the nearest stats snapshot, and a dead
 * player shows the respawn countdown in place of their souls.
 */

import Button from "./Button";
import HeroIcon from "./HeroIcon";
import { TEAM_STROKE, TEAM_TEXT } from "../utils/matchTimelineMap";
import { formatCompact } from "../utils/format";

/** `12/4/6` -- kills, deaths, assists, or the pair without assists. */
function kdaText(player) {
  const kills = player.kills ?? 0;
  const deaths = player.deaths ?? 0;
  if (player.assists == null) return `${kills}/${deaths}`;
  return `${kills}/${deaths}/${player.assists}`;
}

/** The chip's hover text: state, then the running stats and how they were read. */
function chipTitle(player, heroName) {
  const state = player.dead
    ? `dead, ${player.remainingS}s${player.killerName ? ` (killed by ${player.killerName})` : ""}`
    : "alive";
  const stats = [`${kdaText(player)} K/D/A`];
  if (player.souls != null) stats.push(`~${formatCompact(player.souls)} souls (estimated between snapshots)`);
  if (player.assists != null) stats.push("assists from the last stats snapshot");
  return `${player.persona_name}${heroName(player.hero_id) ? ` (${heroName(player.hero_id)})` : ""} – ${state}\n${stats.join(" · ")}`;
}

function PlayerChip({ player, selected, onToggle, heroName }) {
  const team = Number(player.team) === 1 ? 1 : 0;
  const color = TEAM_STROKE[team] ?? "#94a3b8";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(player.account_id)}
      title={chipTitle(player, heroName)}
      className={`flex min-w-0 items-center gap-2 rounded-lg border py-1.5 pl-1.5 pr-2.5 text-left transition-colors ${
        selected
          ? "border-accent-border-strong bg-accent-bg-strong"
          : "border-border-light bg-card hover:border-border-lighter"
      }`}
    >
      {/* The countdown replaces the value, so the portrait carries the state instead. */}
      <span className="relative shrink-0">
        <span className="block rounded-full p-[2px]" style={{ boxShadow: `0 0 0 2px ${color}` }}>
          <HeroIcon
            name={heroName(player.hero_id)}
            size="h-[26px] w-[26px]"
            className={`rounded-full ${player.dead ? "opacity-40 grayscale" : ""}`}
          />
        </span>
        {player.dead && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-danger-text">
            {player.remainingS}
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className={`truncate text-[12px] font-semibold ${
            selected ? "text-accent-light" : player.dead ? "text-muted" : "text-primary"
          }`}
        >
          {player.persona_name}
        </span>
        {/* K/D/A and the value share the second line so the name gets the full chip width. */}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[11px] tabular-nums text-secondary">{kdaText(player)}</span>
          {/* Without soul snapshots the value is omitted, not dashed: K/D/A and the
              respawn state still read on their own. */}
          {player.dead || player.souls != null ? (
            <span
              className={`ml-auto shrink-0 text-[11px] font-bold tabular-nums ${
                player.dead ? "text-danger-text" : "text-primary"
              }`}
            >
              {player.dead ? "Respawn" : formatCompact(player.souls)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function TeamRow({ side, teamName, selection, onToggle, heroName }) {
  const color = TEAM_STROKE[side.team] ?? "#94a3b8";
  return (
    <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: "96px repeat(6, 1fr)" }}>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[12px] font-semibold" style={{ color: TEAM_TEXT[side.team] ?? color }}>
          {teamName}
        </span>
      </div>
      {side.members.map((player) => (
        <PlayerChip
          key={player.account_id}
          player={player}
          selected={selection.includes(player.account_id)}
          onToggle={onToggle}
          heroName={heroName}
        />
      ))}
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
    <div className={`flex flex-col gap-2 ${className}`}>
      {amber ? (
        <TeamRow
          side={amber}
          teamName={teamNames[0] || "Amber"}
          selection={selection}
          onToggle={onToggle}
          heroName={heroName}
        />
      ) : null}
      {sapphire ? (
        <TeamRow
          side={sapphire}
          teamName={teamNames[1] || "Sapphire"}
          selection={selection}
          onToggle={onToggle}
          heroName={heroName}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pl-[102px]">
        <span className="text-[11px] text-muted">
          {hasSelection
            ? "Selected players have their own lane; their item buys are merged into All events."
            : "Select a player to add their lane and narrow the feed and map to them."}
        </span>
        {hasSelection && onClear ? (
          <Button variant="ghost" size="xs" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
