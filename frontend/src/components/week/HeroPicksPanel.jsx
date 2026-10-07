import React, { useState } from "react";
import { heroArtUrl, heroInitials } from "../HeroCard";
import { formatDuration } from "../../utils/weekData";

const MODES = [
  { key: "all", label: "Picks + bans" },
  { key: "picks", label: "Picks" },
  { key: "bans", label: "Bans" },
];

const OUTCOME_DOTS = {
  won: "var(--color-success)",
  lost: "var(--color-muted)",
  banned: "var(--color-danger-text)",
};

/**
 * HeroPicksPanel — how often each hero was picked (and banned, when the data has
 * bans at all). One dot per game: green when the picking side won, grey when it
 * lost, red when the hero was banned.
 *
 * Props:
 *   mode         – 'all' | 'picks' | 'bans'
 *   onModeChange – (key) => void
 *   board        – rows from `buildHeroPicks`
 *   anyBans      – whether the scope has any ban data
 *   subline      – "Times picked across 8 games · Week #58 · both regions"
 */
export default function HeroPicksPanel({ mode, onModeChange, board, anyBans, subline }) {
  return (
    <section className="flex flex-col rounded-xl border border-border-light bg-card shadow">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3.5 md:flex-row md:items-center md:gap-4 md:px-5 md:py-4">
        <div className="flex min-w-0 flex-col gap-[3px] md:gap-1">
          <h2 className="font-valve-oracle text-[18px] text-primary md:text-[20px]">
            Hero Picks &amp; Bans
          </h2>
          <span className="text-[12px] text-muted md:text-[13px]">{subline}</span>
        </div>

        {anyBans && (
          <div className="grid grid-cols-3 gap-1 rounded-full bg-input p-[3px] md:ml-auto md:flex md:shrink-0">
            {MODES.map((entry) => {
              const active = entry.key === mode;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => onModeChange(entry.key)}
                  className={`flex min-h-9 items-center justify-center rounded-full px-2 text-[12px] font-semibold transition-colors md:min-h-0 md:px-3.5 md:py-1.5 ${
                    active ? "bg-accent-bg-strong text-accent-light" : "text-muted hover:text-secondary"
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 text-[11px] text-muted md:gap-x-[18px] md:px-5 md:text-[12px]">
        <Legend colour="var(--color-success)" label="Picked, won" short="Won" />
        <Legend colour="var(--color-muted)" label="Picked, lost" short="Lost" />
        {anyBans && <Legend colour="var(--color-danger-text)" label="Banned" short="Banned" />}
        <span className="ml-auto hidden text-dim md:inline">
          One dot per game. Hover or click a hero to see its games.
        </span>
      </div>

      <div className="flex flex-col md:gap-1 md:px-4 md:py-3">
        {board.length === 0 && (
          <p className="px-1 py-6 text-[13px] text-muted">No picks recorded for this scope.</p>
        )}
        {board.map((row) => (
          <div
            key={row.count}
            className="grid grid-cols-[40px_minmax(0,1fr)] border-t border-border bg-table md:grid-cols-[44px_minmax(0,1fr)] md:rounded-md md:border md:border-border"
          >
            <span className="grid place-items-center border-r border-border font-valve-pulp text-[22px] font-bold text-primary md:text-[26px]">
              {row.count}
            </span>
            <div className="flex flex-wrap gap-1.5 p-1.5">
              {row.heroes.map((entry) => (
                <HeroTile key={entry.hero} entry={entry} anyBans={anyBans} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend({ colour, label, short }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[7px] w-[7px] rounded-full md:h-2 md:w-2" style={{ background: colour }} />
      <span className="md:hidden">{short}</span>
      <span className="hidden md:inline">{label}</span>
    </span>
  );
}

/**
 * One hero, with the games behind its dots on hover (desktop) or tap. The
 * tooltip is anchored to the tile's left or right edge depending on which half
 * of the viewport it sits in, so it never runs off the page.
 */
function HeroTile({ entry, anyBans }) {
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [alignLeft, setAlignLeft] = useState(true);

  const picks = entry.won + entry.lost;
  const dots = [
    ...Array(entry.won).fill("var(--color-success)"),
    ...Array(entry.lost).fill("var(--color-muted)"),
    ...Array(entry.banned).fill("var(--color-danger-text)"),
  ];
  const summary = anyBans
    ? `${entry.hero} · ${picks} picks (${entry.won} won) · ${entry.banned} bans`
    : `${entry.hero} · ${picks} picks (${entry.won} won)`;
  const shown = entry.games || [];
  const open = hovered || pinned;

  const anchor = (element) => {
    const rect = element.getBoundingClientRect();
    setAlignLeft(rect.left + rect.width / 2 < window.innerWidth / 2);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${summary}. ${shown.length} games.`}
        onMouseEnter={(event) => {
          anchor(event.currentTarget);
          setHovered(true);
        }}
        onMouseLeave={() => setHovered(false)}
        onFocus={(event) => {
          anchor(event.currentTarget);
          setHovered(true);
        }}
        onBlur={() => {
          setHovered(false);
          setPinned(false);
        }}
        onClick={() => setPinned((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPinned(false);
            setHovered(false);
          }
        }}
        className="flex cursor-pointer overflow-hidden rounded-[4px] bg-input outline-none focus-visible:ring-2 focus-visible:ring-accent-border-strong"
        style={{ opacity: entry.count ? 1 : 0.45 }}
      >
        {failed ? (
          <span className="grid h-[42px] w-[32px] place-items-center text-[10px] font-bold text-dim md:h-12 md:w-9">
            {heroInitials(entry.hero)}
          </span>
        ) : (
          <img
            src={heroArtUrl(entry.hero)}
            alt={entry.hero}
            onError={() => setFailed(true)}
            className="block h-[42px] w-[32px] object-cover object-top md:h-12 md:w-9"
          />
        )}
        <div
          className="grid content-center gap-[2px] px-[5px] [--dot:6px] md:[--dot:7px]"
          style={{ gridTemplateColumns: "repeat(2, var(--dot))", gridAutoRows: "var(--dot)", minWidth: 16 }}
        >
          {dots.map((colour, index) => (
            <span
              key={index}
              className="h-[var(--dot)] w-[var(--dot)] rounded-full"
              style={{ background: colour }}
            />
          ))}
        </div>
      </button>

      {open && (
        <div
          role="tooltip"
          className={`absolute top-full z-30 mt-1.5 w-[250px] overflow-hidden rounded-lg border border-border-light bg-panel shadow-lg ${
            alignLeft ? "left-0" : "right-0"
          }`}
        >
          <div className="flex flex-col gap-0.5 border-b border-border px-3 py-2">
            <span className="font-valve-oracle text-[14px] text-primary">{entry.hero}</span>
            <span className="text-[11px] text-muted">{summary}</span>
          </div>
          {shown.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-muted">No games recorded.</p>
          ) : (
            <ul className="scroll-thin max-h-[200px] overflow-y-auto py-1">
              {shown.map((game, index) => (
                <li
                  key={`${game.matchId}-${game.outcome}-${index}`}
                  className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-[12px]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: OUTCOME_DOTS[game.outcome] || OUTCOME_DOTS.lost }}
                  />
                  <span className="truncate text-secondary">
                    {game.round || "Game"}
                    <span className="text-dim"> · {game.region || "—"}</span>
                  </span>
                  <span className="text-muted tabular-nums">
                    G{game.gameNo ?? index + 1} · {formatDuration(game.durationS)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
