import React, { useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../ErrorMessage";
import HeroIcon from "../HeroIcon";
import usePanelData from "../player/usePanelData";
import { formatDuration } from "../../utils/format";

function formatValue(card, value) {
  return card.kind === "game" ? formatDuration(value) : Number(value).toLocaleString("en-GB");
}

/** Who set a record and where: a player on a hero, or the two teams of a game. */
function describe(card, entry) {
  if (card.kind === "game") {
    return {
      who: entry.team_a && entry.team_b ? `${entry.team_a} vs ${entry.team_b}` : `Match #${entry.match_id}`,
      meta: [entry.region, `Week ${entry.week}`].filter(Boolean).join(" · "),
      hero: null,
    };
  }
  return {
    who: entry.persona_name || "Unknown player",
    meta: [entry.hero_name, `Week ${entry.week}`].filter(Boolean).join(" · "),
    hero: entry.hero_name,
  };
}

function HolderBadge({ card, hero, size }) {
  if (card.kind === "player") {
    return <HeroIcon name={hero} size={size} className="rounded-md" />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} flex shrink-0 items-center justify-center rounded-md border border-border-light bg-hover font-valve-oracle text-[12px] font-semibold text-muted`}
    >
      VS
    </span>
  );
}

function RecordCard({ card, open, onToggle }) {
  const [top, ...rest] = card.entries;
  const topInfo = top ? describe(card, top) : null;

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border-light bg-card px-5 py-[18px] shadow-[var(--shadow-panel)]">
      <h3 className="mb-4 border-b border-border pb-3 font-valve-oracle text-[18px] font-semibold leading-tight text-primary">
        {card.label}
      </h3>
      {!top ? (
        <p className="text-[13px] text-dim">No games in range.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <span className="font-valve-pulp text-[40px] leading-none text-primary tabular-nums">
            {formatValue(card, top.value)}
          </span>
          <div className="flex min-w-0 items-center gap-2.5">
            <HolderBadge card={card} hero={topInfo.hero} size="h-9 w-9" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span title={topInfo.who} className="truncate font-semibold text-primary">
                {topInfo.who}
              </span>
              <span className="truncate text-[12px] text-dim">{topInfo.meta}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Link to={`/match/${top.match_id}`} className="text-[13px] font-medium text-accent-light hover:text-accent">
              View match ›
            </Link>
            {rest.length > 0 && (
              <button
                type="button"
                aria-expanded={open}
                onClick={onToggle}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-200 active:scale-[.97] ${
                  open
                    ? "border-accent-border bg-accent-bg-strong text-accent-light"
                    : "border-border-light bg-badge-bg text-secondary hover:bg-hover"
                }`}
              >
                Top {card.entries.length} {open ? "▴" : "▾"}
              </button>
            )}
          </div>
          {open && (
            <ol className="flex flex-col gap-1 border-t border-border pt-2.5">
              {rest.map((entry, i) => {
                const info = describe(card, entry);
                return (
                  <li key={`${entry.match_id}-${entry.account_id ?? i}`}>
                    <Link
                      to={`/match/${entry.match_id}`}
                      className="-mx-1.5 grid grid-cols-[14px_24px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-[5px] text-[13px] text-secondary transition-colors duration-200 hover:bg-accent-bg"
                    >
                      <span className="text-[12px] text-dim">{i + 2}</span>
                      <HolderBadge card={card} hero={info.hero} size="h-6 w-6" />
                      <span className="flex min-w-0 flex-col">
                        <span title={info.who} className="truncate text-primary">
                          {info.who}
                        </span>
                        <span className="truncate text-[11px] text-dim">{info.meta}</span>
                      </span>
                      <span className="font-semibold text-primary tabular-nums">{formatValue(card, entry.value)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

const GRID = "grid grid-cols-1 items-start gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]";

/**
 * Records: one card per single-game best in the filtered weeks and region, with
 * the holder, a link to the match, and the next four inline. One card's Top 5 is
 * open at a time.
 */
export default function RecordsTab({ query }) {
  const { data, loading, error, reload } = usePanelData(`/db/stats/records-board?${query}`, {
    errorMessage: "Could not load the records",
  });
  const [openId, setOpenId] = useState(null);

  if (error) return <ErrorMessage message={error} onRetry={reload} />;
  if (loading) {
    return (
      <div className={GRID} aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-[210px] animate-pulse rounded-xl border border-border-light bg-card" />
        ))}
      </div>
    );
  }

  return (
    <section className={GRID} aria-label="Records">
      {(data?.records ?? []).map((card) => (
        <RecordCard
          key={card.id}
          card={card}
          open={openId === card.id}
          onToggle={() => setOpenId((current) => (current === card.id ? null : card.id))}
        />
      ))}
    </section>
  );
}
