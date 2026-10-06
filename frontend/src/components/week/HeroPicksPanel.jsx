import React, { useState } from "react";
import { heroArtUrl, heroInitials } from "../HeroCard";

const MODES = [
  { key: "all", label: "Picks + bans" },
  { key: "picks", label: "Picks" },
  { key: "bans", label: "Bans" },
];

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
    <section className="flex flex-col overflow-hidden rounded-xl border border-border-light bg-card shadow">
      <header className="flex items-center gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-valve-oracle text-[20px] text-primary">Hero Picks &amp; Bans</h2>
          <span className="text-[13px] text-muted">{subline}</span>
        </div>

        {anyBans && (
          <div className="ml-auto flex shrink-0 gap-1 rounded-full bg-input p-[3px]">
            {MODES.map((entry) => {
              const active = entry.key === mode;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => onModeChange(entry.key)}
                  className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
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

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-border px-5 py-2.5 text-[12px] text-muted">
        <Legend colour="var(--color-success)" label="Picked, won" />
        <Legend colour="var(--color-muted)" label="Picked, lost" />
        {anyBans && <Legend colour="var(--color-danger-text)" label="Banned" />}
        <span className="ml-auto text-dim">
          One dot per game. Hover a hero for totals.
        </span>
      </div>

      <div className="flex flex-col gap-1 px-4 py-3">
        {board.length === 0 && (
          <p className="px-1 py-6 text-[13px] text-muted">No picks recorded for this scope.</p>
        )}
        {board.map((row) => (
          <div
            key={row.count}
            className="grid grid-cols-[44px_minmax(0,1fr)] rounded-md border border-border bg-table"
          >
            <span className="grid place-items-center border-r border-border font-valve-pulp text-[26px] font-bold text-primary">
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

function Legend({ colour, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  );
}

function HeroTile({ entry, anyBans }) {
  const [failed, setFailed] = useState(false);
  const picks = entry.won + entry.lost;
  const dots = [
    ...Array(entry.won).fill("var(--color-success)"),
    ...Array(entry.lost).fill("var(--color-muted)"),
    ...Array(entry.banned).fill("var(--color-danger-text)"),
  ];
  const title = anyBans
    ? `${entry.hero} · ${picks} picks (${entry.won} won) · ${entry.banned} bans`
    : `${entry.hero} · ${picks} picks (${entry.won} won)`;

  return (
    <div
      title={title}
      className="flex overflow-hidden rounded-[4px] bg-input"
      style={{ opacity: entry.count ? 1 : 0.45 }}
    >
      {failed ? (
        <span className="grid h-12 w-9 place-items-center text-[10px] font-bold text-dim">
          {heroInitials(entry.hero)}
        </span>
      ) : (
        <img
          src={heroArtUrl(entry.hero)}
          alt={entry.hero}
          onError={() => setFailed(true)}
          className="block h-12 w-9 object-cover object-top"
        />
      )}
      <div
        className="grid content-center gap-[2px] px-[5px]"
        style={{ gridTemplateColumns: "repeat(2, 7px)", gridAutoRows: "7px", minWidth: 16 }}
      >
        {dots.map((colour, index) => (
          <span
            key={index}
            className="rounded-full"
            style={{ width: 7, height: 7, background: colour }}
          />
        ))}
      </div>
    </div>
  );
}
