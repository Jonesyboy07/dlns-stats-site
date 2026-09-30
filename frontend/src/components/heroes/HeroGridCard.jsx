import React, { useState } from "react";
import { Link } from "react-router-dom";
import { cdnImage } from "../../utils/cdn";
import { heroArtUrl, heroInitials } from "../HeroCard";
import { formatPercent, trendGlyph } from "../../utils/heroPages";

const PILL =
  "absolute rounded-full border border-border-light bg-table/85 px-2 py-[3px] text-[12px] font-bold";

/** Vertical portrait over the card backer, with a dashed initials fallback. */
function HeroTileArt({ name }) {
  const [failed, setFailed] = useState(false);

  if (!name || failed) {
    return (
      <div className="m-2 flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-border-lighter">
        <span className="font-valve-pulp text-[32px] leading-none text-dim">
          {heroInitials(name)}
        </span>
        <span className="font-valve-oracle text-[14px] text-muted">{name || "Unknown"}</span>
      </div>
    );
  }

  return (
    <div className="relative aspect-[3/4] overflow-hidden bg-table">
      <img
        src={cdnImage("vertical/card_backer_psd.png")}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-30"
      />
      <img
        src={heroArtUrl(name)}
        alt={name}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}

/**
 * One card in the Heroes list grid: portrait with a win-rate rank and a
 * week-over-week trend pill, over a Pick / Win / Games row. The stat that the
 * current sort is by is highlighted.
 */
function HeroGridCard({ hero, sortKey }) {
  const { id, name, rank, trend, pick, win, games } = hero;

  const up = trend != null && trend >= 0;
  const value = (text, active, dim) => (
    <span
      className={`text-[14px] font-semibold tabular-nums ${
        dim ? "text-dim" : active ? "text-accent-secondary-light" : "text-primary"
      }`}
    >
      {text}
    </span>
  );

  const stat = (label, text, key, dim) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[.05em] text-dim">{label}</span>
      {value(text, sortKey === key, dim)}
    </div>
  );

  return (
    <Link
      to={`/hero/${id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border-light bg-card shadow transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-accent-secondary-border hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative">
        <HeroTileArt name={name} />
        <span className={`${PILL} left-2 top-2 text-primary`}>
          {rank == null ? "—" : `#${rank}`}
        </span>
        <span
          title={
            trend == null
              ? "No games last week"
              : `Win rate ${trend >= 0 ? "+" : "−"}${Math.abs(trend).toFixed(1)} pts vs last week`
          }
          className={`${PILL} right-2 top-2 ${up ? "text-success" : "text-danger-text"}`}
        >
          {trendGlyph(trend)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-border px-3 pb-3 pt-2.5">
        {stat("Pick", formatPercent(pick), "pick", pick == null || pick === 0)}
        {stat("Win", formatPercent(win), "win", win == null || win === 0)}
        {stat("Games", games ? String(games) : "—", "games", !games)}
      </div>
    </Link>
  );
}

export default HeroGridCard;
