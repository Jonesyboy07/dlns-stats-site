import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import { formatDuration, formatInteger, formatMatchDate } from "../../utils/format";
import { heroBuildRows, playerBuildRows, winRateColor } from "../../utils/items";

const pct = (value) => `${Number(value).toFixed(1)}%`;
const ROW =
  "grid items-center gap-2 rounded-md border-t border-border px-1.5 text-[13px] text-secondary tabular-nums transition-[background-color,transform] duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:translate-x-1 hover:bg-accent-bg motion-reduce:transition-none";
const HEAD = "text-[11px] tracking-[0.05em] uppercase";

function Empty({ children }) {
  return <p className="py-3 text-[13px] text-dim">{children}</p>;
}

const LIST_SHOWN = 8;

/** The "Show N more" / "Show fewer" footer under a list longer than `shown`. */
function MoreToggle({ total, shown, open, onToggle }) {
  if (total <= shown) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="border-t border-border px-1.5 pt-3 pb-1 text-left text-[13px] text-muted transition-colors hover:text-primary"
    >
      {open ? "Show fewer" : `Show ${total - shown} more`}
    </button>
  );
}

const gamesText = (n) => `${n} game${n === 1 ? "" : "s"}`;

/* ── Top heroes ── */

const HERO_GRID = "grid-cols-[minmax(0,1fr)_48px_64px_56px]";
const HERO_COLUMNS = [
  ["games", "Games", "Sort by games"],
  ["pick", "Pick", "Share of this hero's games where it was built"],
  ["win", "Win %", "Sort by win rate"],
];

export function ItemHeroesPanel({ heroes, minGames }) {
  const [sortKey, setSortKey] = useState("games");
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => heroBuildRows(heroes, sortKey, minGames), [heroes, sortKey, minGames]);
  return (
    <SectionCard title="Top Heroes" subtitle="Heroes who build it" className="pb-2.5">
      {rows.length === 0 ? (
        <Empty>No hero built it under these filters.</Empty>
      ) : (
        <div className="-mt-1 flex flex-col">
          <div className={`grid ${HERO_GRID} gap-2 px-1.5 pb-2`}>
            <span className={`${HEAD} text-dim`}>Hero</span>
            {HERO_COLUMNS.map(([key, label, title]) => (
              <button
                key={key}
                type="button"
                title={title}
                onClick={() => setSortKey(key)}
                aria-pressed={sortKey === key}
                className={`${HEAD} text-right whitespace-nowrap transition-colors hover:text-secondary ${
                  sortKey === key ? "text-accent-light" : "text-dim"
                }`}
              >
                {label}
                {sortKey === key ? " ↓" : ""}
              </button>
            ))}
          </div>
          {(open ? rows : rows.slice(0, LIST_SHOWN)).map((hero) => (
            <Link
              key={hero.hero_id}
              to={`/hero/${hero.hero_id}`}
              title={`${hero.name}: ${hero.wins} wins in ${gamesText(hero.games)}${hero.low ? " · low sample" : ""}`}
              className={`${ROW} ${HERO_GRID} py-[7px] ${hero.low ? "opacity-50" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <HeroIcon name={hero.name} size="h-[30px] w-[30px]" className="rounded-md" />
                <span className="truncate font-semibold text-primary">{hero.name}</span>
              </span>
              <span className="text-right">{hero.games}</span>
              <span className="text-right">{pct(hero.pick)}</span>
              <span className="text-right font-semibold" style={{ color: winRateColor(hero.win, hero.low) }}>
                {pct(hero.win)}
              </span>
            </Link>
          ))}
          <MoreToggle total={rows.length} shown={LIST_SHOWN} open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      )}
    </SectionCard>
  );
}

/* ── Top players ── */

const initials = (name) => String(name || "?").slice(0, 2).toUpperCase();

export function ItemPlayersPanel({ players, minGames }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => playerBuildRows(players, minGames), [players, minGames]);
  return (
    <SectionCard title="Top Players" subtitle="Players who build it most" className="pb-2.5">
      {rows.length === 0 ? (
        <Empty>No player built it under these filters.</Empty>
      ) : (
        <div className="-mt-1 flex flex-col">
          {(open ? rows : rows.slice(0, LIST_SHOWN)).map((player) => (
            <Link
              key={player.account_id}
              to={`/player/${player.account_id}`}
              title={`${player.name || "Unknown player"}: ${player.wins} wins in ${gamesText(player.games)}`}
              className={`${ROW} grid-cols-[22px_minmax(0,1fr)_auto_56px] py-[7px] ${player.low ? "opacity-50" : ""}`}
            >
              <span className="font-bold text-dim">{player.rank ?? "–"}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-hover text-[11px] font-bold text-muted">
                  {initials(player.name)}
                </span>
                <span className="truncate font-semibold text-primary">{player.name || "Unknown player"}</span>
                {player.signature && (
                  <span
                    title="Built in at least half of this player's games"
                    className="shrink-0 rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[11px] font-semibold text-accent-light"
                  >
                    Signature
                  </span>
                )}
              </span>
              <span className="text-right text-muted">{gamesText(player.games)}</span>
              <span className="text-right font-semibold" style={{ color: winRateColor(player.win, player.low) }}>
                {pct(player.win)}
              </span>
            </Link>
          ))}
          <MoreToggle total={rows.length} shown={LIST_SHOWN} open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      )}
    </SectionCard>
  );
}

/* ── Recent matches ── */

const MATCH_GRID = "grid-cols-[62px_minmax(0,1fr)_60px_52px] sm:grid-cols-[70px_minmax(0,1.2fr)_minmax(0,1fr)_64px_56px]";
const SHOWN = 6;

function ResultPill({ won }) {
  return (
    <span
      className="justify-self-start rounded-full px-2.5 py-[3px] text-[11px] font-bold text-white"
      style={{
        background: won ? "linear-gradient(135deg,#10b981,#059669)" : "linear-gradient(135deg,#ef4444,#dc2626)",
      }}
    >
      {won ? "WIN" : "LOSS"}
    </span>
  );
}

export function ItemRecentMatchesPanel({ matches }) {
  const [all, setAll] = useState(false);
  const shown = all ? matches : matches.slice(0, SHOWN);
  return (
    <SectionCard title="Recent Matches" subtitle="Latest games where it was built" className="pb-2">
      {matches.length === 0 ? (
        <Empty>Not built in any match under these filters.</Empty>
      ) : (
        <div className="-mt-1 flex flex-col">
          <div className={`grid ${MATCH_GRID} gap-2.5 px-1.5 pb-2 ${HEAD} text-dim`}>
            <span>Date</span>
            <span>Hero</span>
            <span className="hidden sm:block">Player</span>
            <span>Result</span>
            <span className="text-right">Bought</span>
          </div>
          {shown.map((match) => (
            <Link
              key={`${match.match_id}-${match.account_id}`}
              to={`/match/${match.match_id}`}
              className={`${ROW} ${MATCH_GRID} gap-2.5 py-2`}
            >
              <span className="flex flex-col">
                <span>{formatMatchDate(match.start_time)?.replace(/ \d{4}$/, "") ?? "—"}</span>
                <span className="text-[11px] text-dim">#{match.match_id}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <HeroIcon name={match.hero_name} size="h-[26px] w-[26px]" className="rounded-md" />
                <span className="truncate font-semibold text-primary">{match.hero_name}</span>
              </span>
              <span className="hidden truncate sm:block">{match.player_name || "Unknown player"}</span>
              <ResultPill won={match.won} />
              <span className="text-right">{formatDuration(match.buy_s) ?? "—"}</span>
            </Link>
          ))}
          <MoreToggle total={matches.length} shown={SHOWN} open={all} onToggle={() => setAll((v) => !v)} />
        </div>
      )}
    </SectionCard>
  );
}

/* ── Item damage ── */

export function ItemDamagePanel({ damage, itemName }) {
  if (!damage) return null;
  const cell = "flex flex-col gap-1 rounded-lg border border-border bg-table px-3.5 py-3";
  return (
    <SectionCard title="Item Damage" subtitle={`Hero damage dealt by ${itemName}`}>
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className={cell}>
            <span className="text-[12px] tracking-[0.05em] text-muted uppercase">Total</span>
            <span className="font-valve-oracle text-[28px] leading-none text-primary">{formatInteger(damage.total)}</span>
          </div>
          <div className={cell}>
            <span className="text-[12px] tracking-[0.05em] text-muted uppercase">Per game</span>
            <span className="font-valve-oracle text-[28px] leading-none text-primary">{formatInteger(damage.per_game)}</span>
          </div>
        </div>
        {damage.share != null && (
          <span className="text-[12px] text-dim">{pct(damage.share * 100)} of the builder's hero damage, on average</span>
        )}
      </div>
    </SectionCard>
  );
}
