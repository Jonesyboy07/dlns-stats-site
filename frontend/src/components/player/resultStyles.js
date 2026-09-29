/**
 * Result styling shared by the player panels so a win/loss/unknown row reads the
 * same in the form strip, the hero pool's last-5 list and the match table.
 * Unknown is always dashed and colourless — never a default win.
 */

/** Small square with a letter, as used by the form strip. */
export const RESULT_SQUARE_CLASS = {
  W: "border border-success-border bg-success-bg text-success",
  L: "border border-danger-border bg-danger-bg text-danger-text",
  U: "border border-dashed border-border-lighter text-dim",
};

/** Wider pill carrying the word, as used by the match table. */
export const RESULT_CHIP_CLASS = {
  W: "border border-success-border bg-success-bg text-success",
  L: "border border-danger-border bg-danger-bg text-danger-text",
  U: "border border-dashed border-border-lighter text-dim",
};

export const RESULT_LABEL = { W: "Win", L: "Loss", U: "—" };

/** The letter/word shown inside a result chip or square. */
export const resultGlyph = (outcome, { long = false } = {}) =>
  outcome === "U" ? (long ? "—" : "–") : long ? RESULT_LABEL[outcome] : outcome;
