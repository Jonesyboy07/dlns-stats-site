import React from "react";
import { decisiveScore } from "../../utils/playerStats";

/** Tones returned by decisiveScore(), mapped to the design tokens. */
const TONE_CLASS = {
  win: "text-success",
  loss: "text-danger-text",
  neutral: "text-dim",
  tie: "text-secondary",
};

/**
 * A W–L pair where only the number that decided it carries colour — green when
 * the wins lead, red when the losses do. The smaller number stays dim, so "2–0"
 * reads as a win at a glance instead of asking the eye to compare two digits.
 */
export default function ScoreChip({
  wins = 0,
  losses = 0,
  title,
  className = "",
}) {
  const { winsTone, lossesTone } = decisiveScore(wins, losses);

  return (
    <span
      className={`inline-flex items-baseline font-semibold tabular-nums ${className}`}
      title={title}
    >
      <span className={TONE_CLASS[winsTone]}>{wins}</span>
      <span className="mx-1 font-normal text-dim">–</span>
      <span className={TONE_CLASS[lossesTone]}>{losses}</span>
    </span>
  );
}
