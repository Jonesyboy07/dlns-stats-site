import React from "react";
import { Link } from "react-router-dom";

/**
 * Recent form: one chip per game, oldest on the left so the newest game sits at
 * the right, with the win/loss summary underneath.
 *
 * A chip is built from the success/danger token PAIRS (fill, border, text) rather
 * than a flat colour, so a win and a loss stay legible on any of the theme's
 * surfaces and in both light and dark mode.
 */
const CHIP_CLASS = {
  W: "border-success-border bg-success-bg text-success",
  L: "border-danger-border bg-danger-bg text-danger-text",
};

const CHIP_BASE =
  "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border text-[11px] font-bold transition-opacity hover:opacity-70 motion-reduce:transition-none";

function FormStrip({ form = [], label = "Last 10 · oldest → newest" }) {
  const wins = form.filter((game) => game.result === "W").length;
  const losses = form.filter((game) => game.result === "L").length;
  const decided = wins + losses;

  return (
    <div className="flex flex-col items-end gap-2">
      <span className="text-[12px] uppercase tracking-[.05em] text-muted">{label}</span>

      {form.length === 0 ? (
        <span className="text-[13px] text-dim">No games yet</span>
      ) : (
        <div className="flex gap-1">
          {form.map((game) => (
            <Link
              key={game.match_id}
              to={`/match/${game.match_id}`}
              title={`Match ${game.match_id}: ${game.result === "W" ? "Win" : "Loss"}`}
              className={`${CHIP_BASE} ${CHIP_CLASS[game.result] ?? "border-border text-dim"}`}
            >
              {game.result}
            </Link>
          ))}
        </div>
      )}

      {decided > 0 && (
        <span className="text-[13px] font-semibold tabular-nums text-secondary">
          {wins} W · {losses} L
        </span>
      )}
    </div>
  );
}

export default FormStrip;
