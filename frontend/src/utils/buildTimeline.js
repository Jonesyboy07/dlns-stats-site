/**
 * Timeline placement for the player profile's Items & Build panel.
 *
 * Buy times are medians per item, so the axis spans only the data: it starts just
 * before the earliest purchase and ends just after the latest one. That spreads
 * the icons across the whole track — a 0..latest axis leaves them bunched in the
 * first third, because the last item can be bought more than twice as late as the
 * first.
 *
 * Real builds still cluster (the first two items can be under two minutes apart),
 * so a minimum-gap pass keeps a 24px icon and its label clear of the previous one.
 * Only the track compresses where the data is dense: the order and the printed
 * times are never touched, and the caller prints the real median next to each icon.
 */

/** Percentage of the track that has to sit between two neighbouring icons. */
export const TIMELINE_MIN_GAP = 13;
/** Icon centres stay inside these bounds so nothing is clipped by the panel. */
export const TIMELINE_START = 5;
export const TIMELINE_END = 95;
/** Share of the data span added before the first and after the last item. */
export const TIMELINE_PAD = 0.08;

/**
 * Positions (percent of the track) for `times` in the order given. The input must
 * already be sorted ascending — the caller prints the times in that order, and the
 * gap pass assumes it.
 */
export function timelinePositions(times = [], { minGap = TIMELINE_MIN_GAP } = {}) {
  const values = times.map((time) => Number(time) || 0);
  if (values.length === 0) return [];

  const first = Math.min(...values);
  const last = Math.max(...values);
  const span = Math.max(last - first, 1);
  const pad = span * TIMELINE_PAD;
  const from = first - pad;
  const width = last + pad - from;

  // Where each icon would sit if the axis were the whole data range.
  const raw = values.map(
    (value) =>
      TIMELINE_START + ((value - from) / width) * (TIMELINE_END - TIMELINE_START),
  );

  const placed = [];
  raw.forEach((position, index) => {
    const previous = placed[index - 1];
    placed.push(previous == null ? position : Math.max(position, previous + minGap));
  });

  // A build dense enough to run off the end keeps its shape but has every gap
  // scaled down together, so the last icon lands on the end of the track. Icons
  // stay apart and in order; only the spacing gives, and the times printed beside
  // them are still the real medians.
  const overflow = placed[placed.length - 1] - TIMELINE_END;
  if (overflow <= 0) return placed;

  const start = placed[0];
  const factor = (TIMELINE_END - start) / (placed[placed.length - 1] - start);
  return placed.map((position) => start + (position - start) * factor);
}
