/**
 * The laning tab's map card: the minimap with its kill dots on the left, and the lane
 * filter, head-to-head and kill feed on the right.
 *
 * Everything on the card reads the same lane filter and the same clock, which is what
 * makes the dots, the tally and the feed tell one story. The kill feed is the map's
 * other half: hovering a row lights its dot and hovering a dot lights its row.
 */

import Button from "../Button";
import { cdnImage } from "../../utils/cdn";
import { clock } from "../../utils/matchTimeline";
import { formatCompact } from "../../utils/format";
import { BACKDROP_RATIO, MAP_ART_FILTER, mapVersionConfig } from "../../utils/matchMap";
import { LANING_LANE_OPTIONS } from "../../utils/laningTab";

const TEAM_FILL = {
  0: "var(--color-team-amber)",
  1: "var(--color-team-sapphire)",
};

const TEAM_TEXT = {
  0: "text-team-amber",
  1: "text-blue-300",
};

const TEAM_RING = {
  0: "oklch(0.8016 0.1705 73.27 / .45)",
  1: "oklch(0.5542 0.2465 261.44 / .6)",
};

const ROW_GRID = "grid grid-cols-[56px_minmax(0,1fr)_120px_minmax(0,1fr)_56px] items-center gap-2.5";
const FEED_GRID = "grid grid-cols-[44px_minmax(0,1fr)_20px_minmax(0,1fr)_16px] items-center gap-2.5";

/** A head-to-head value: compact thousands for souls and damage, plain for kills. */
function formatValue(value, format) {
  if (value === null) return "—";
  return format === "count" ? String(value) : formatCompact(value);
}

/** How a side of a bar row is drawn: the leader is lit, the trailer is dimmed. */
function sideTone(row, side) {
  if (!row.known) return { text: "text-dim", opacity: 0.45 };
  const losing = row.leader !== null && row.leader !== "tie" && row.leader !== side;
  return {
    text: losing ? "text-dim" : side === "left" ? TEAM_TEXT[0] : TEAM_TEXT[1],
    opacity: losing ? 0.45 : 1,
  };
}

export default function LaningMapCard({
  dots = [],
  tally = { total: 0, amber: 0, sapphire: 0 },
  time = 0,
  endS = 600,
  lane = null,
  laneName = null,
  onLaneChange = () => {},
  headToHead = { title: "", lead: null, players: { left: [], right: [] }, rows: [] },
  feed = [],
  hoverKillId = null,
  onHoverKill = () => {},
  version = null,
  heroIcon = null,
  heroName = () => null,
  teamNames = [],
  className = "",
}) {
  const config = mapVersionConfig(version);
  const teamLabel = (side) => teamNames[side] || (side === 0 ? "Amber" : "Sapphire");
  const leadText =
    headToHead.lead === null
      ? "—"
      : `${teamLabel(headToHead.lead >= 0 ? 0 : 1)} +${formatCompact(Math.abs(headToHead.lead))}`;
  const leadTone = headToHead.lead === null ? "text-dim" : headToHead.lead >= 0 ? TEAM_TEXT[0] : TEAM_TEXT[1];

  const playerChip = (player, mirror) => (
    <span key={player.account_id} className="flex items-center gap-1.5 text-primary">
      {mirror ? null : (
        <img
          src={heroIcon?.(player.hero_id)}
          alt=""
          className="h-6 w-6 shrink-0 rounded-md object-cover"
          style={{ border: `1px solid ${TEAM_RING[Number(player.team) === 1 ? 1 : 0]}` }}
        />
      )}
      <span className="truncate text-[13px] font-semibold">{player.persona_name || "Anonymous"}</span>
      {mirror ? (
        <img
          src={heroIcon?.(player.hero_id)}
          alt=""
          className="h-6 w-6 shrink-0 rounded-md object-cover"
          style={{ border: `1px solid ${TEAM_RING[Number(player.team) === 1 ? 1 : 0]}` }}
        />
      ) : null}
    </span>
  );

  return (
    <div
      className={`grid gap-0 overflow-hidden rounded-xl border border-border-light bg-card shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] xl:grid-cols-[420px_minmax(0,1fr)] ${className}`}
    >
      {/* ---- Map ---- */}
      <div className="flex flex-col items-center gap-3.5 border-b border-border-light bg-table p-6 xl:border-b-0 xl:border-r">
        <div
          className="relative aspect-square w-full max-w-[372px] overflow-hidden rounded-full border border-border-lighter bg-card"
          onMouseLeave={() => onHoverKill(null)}
        >
          <img
            src={cdnImage(config.background)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full max-w-none"
            style={{ transform: `scale(${BACKDROP_RATIO})` }}
          />
          <img
            src={cdnImage(config.overlay)}
            alt={`${config.label} minimap`}
            className="absolute inset-0 h-full w-full"
            style={{ filter: MAP_ART_FILTER }}
          />
          {dots.map((dot) => (
            <span
              key={dot.id}
              onMouseEnter={() => onHoverKill(dot.id)}
              onMouseLeave={() => onHoverKill(null)}
              title={`${clock(dot.timeS)} — ${dot.killerName ?? "unknown"} killed ${dot.victimName ?? "unknown"}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full transition-all duration-200 motion-reduce:transition-none"
              style={{
                left: `${dot.point?.left ?? 50}%`,
                top: `${dot.point?.top ?? 50}%`,
                width: dot.size,
                height: dot.size,
                backgroundColor: TEAM_FILL[dot.team] ?? "#94a3b8",
                border: "2px solid var(--color-card)",
                opacity: dot.opacity,
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-4 text-[13px] font-semibold">
          <span className="text-muted">
            {tally.total} death{tally.total === 1 ? "" : "s"} by {clock(time)}
            {lane === null ? "" : ` in ${laneName}`}
          </span>
          <span className="text-team-amber">
            {teamLabel(0)} {tally.amber}
          </span>
          <span className="text-blue-300">
            {teamLabel(1)} {tally.sapphire}
          </span>
        </div>
      </div>

      {/* ---- Filter, head-to-head, feed ---- */}
      <div className="flex min-w-0 flex-col gap-5 p-6">
        <div className="flex flex-wrap gap-2">
          {LANING_LANE_OPTIONS.map((option) => (
            <Button
              key={option.name}
              size="sm"
              variant={option.id === lane ? "primary" : "ghost"}
              aria-pressed={option.id === lane}
              onClick={() => onLaneChange(option.id)}
            >
              {option.name}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-valve-oracle text-[14px] font-semibold uppercase tracking-[.08em] text-muted">
              {headToHead.title}
            </span>
            <span className={`text-[13px] font-bold ${leadTone}`}>{leadText}</span>
          </div>

          {(headToHead.players.left.length > 0 || headToHead.players.right.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-wrap justify-end gap-3.5">
                {headToHead.players.left.map((player) => playerChip(player, true))}
              </div>
              <div className="flex flex-wrap gap-3.5">
                {headToHead.players.right.map((player) => playerChip(player, false))}
              </div>
            </div>
          )}

          {headToHead.rows.map((row) => {
            const left = sideTone(row, "left");
            const right = sideTone(row, "right");
            if (row.kind === "guardian") {
              // No bar: a guardian's fall is a moment, not a share of anything.
              const value = (side) => (side.standing ? "standing" : clock(side.timeS));
              return (
                <div key={row.key} className={`${ROW_GRID} text-[13px] font-bold`}>
                  <span className="text-right tabular-nums text-team-amber">{value(row.left)}</span>
                  <span />
                  <span className="text-center text-[11px] font-semibold uppercase tracking-[.08em] text-dim">
                    {row.label}
                  </span>
                  <span />
                  <span className="tabular-nums text-blue-300">{value(row.right)}</span>
                </div>
              );
            }
            return (
              <div key={row.key} className={`${ROW_GRID} text-[13px] font-bold`}>
                <span className={`text-right tabular-nums ${left.text}`}>
                  {formatValue(row.left.value, row.format)}
                </span>
                <div className="flex h-2.5 justify-end overflow-hidden rounded bg-table">
                  <span
                    className="bg-team-amber transition-[width] duration-300 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none"
                    style={{ width: `${row.left.ratio * 100}%`, opacity: left.opacity }}
                  />
                </div>
                <span className="text-center text-[11px] font-semibold uppercase tracking-[.08em] text-dim">
                  {row.label}
                </span>
                <div className="flex h-2.5 overflow-hidden rounded bg-table">
                  <span
                    className="bg-team-sapphire transition-[width] duration-300 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none"
                    style={{ width: `${row.right.ratio * 100}%`, opacity: right.opacity }}
                  />
                </div>
                <span className={`tabular-nums ${right.text}`}>
                  {formatValue(row.right.value, row.format)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex max-h-[300px] flex-col overflow-y-auto border-t border-border-light">
          {feed.length === 0 ? (
            <p className="py-3 text-[13px] text-dim">
              No deaths recorded {lane === null ? "" : `in ${laneName} `}in the first {clock(endS)}.
            </p>
          ) : (
            feed.map((row) => (
              <div
                key={row.id}
                onMouseEnter={() => onHoverKill(row.id)}
                onMouseLeave={() => onHoverKill(null)}
                className={`${FEED_GRID} border-b border-border px-2.5 py-[7px] text-[13px] font-semibold transition-colors duration-200 motion-reduce:transition-none ${
                  row.hovered ? "bg-accent-bg" : ""
                }`}
                style={{ opacity: row.past ? 1 : 0.3 }}
              >
                <span className="tabular-nums text-dim">{clock(row.timeS)}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <img
                    src={heroIcon?.(row.killerHeroId)}
                    alt=""
                    title={heroName(row.killerHeroId)}
                    className="h-[22px] w-[22px] shrink-0 rounded-md object-cover"
                    style={{ border: `1px solid ${TEAM_RING[row.team === 1 ? 1 : 0]}` }}
                  />
                  <span className={`truncate ${TEAM_TEXT[row.team === 1 ? 1 : 0]}`}>
                    {row.killerName || "Unknown"}
                  </span>
                </div>
                <span className="text-center text-dim">›</span>
                <div className="flex min-w-0 items-center gap-2">
                  <img
                    src={heroIcon?.(row.victimHeroId)}
                    alt=""
                    title={heroName(row.victimHeroId)}
                    className="h-[22px] w-[22px] shrink-0 rounded-md object-cover"
                    style={{ filter: "grayscale(.8)", opacity: 0.8 }}
                  />
                  <span className="truncate text-muted">{row.victimName || "Unknown"}</span>
                </div>
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: row.laneColor ?? "var(--color-dim)" }}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
