/**
 * The league's three lanes, shared by the player pages.
 *
 * `players.lane` holds the game-reported assigned lane and `lane_real` the
 * positionally inferred one; both use the same 1/4/6 encoding and the inferred
 * value is preferred because it corrects players who swap at the start of a game.
 * The colours match the match page's scoreboard so a lane reads the same
 * everywhere — always show the name next to the colour, never colour alone.
 */

import { LOSS, WIN, matchOutcome } from "./playerStats";

export const LANE_META = {
  1: { id: 1, name: "York", color: "#facc15" },
  // Names and colours follow the game's own lane identity, verified against the
  // map data: lane 1 is yellow, lane 4 blue and lane 6 green — so Greenwich (the
  // green lane) is id 6 and Broadway (blue) is id 4.
  4: { id: 4, name: "Broadway", color: "#22d3ee" },
  6: { id: 6, name: "Greenwich", color: "#4ade80" },
};

/** Reading order for the lane lists: York, Broadway, Greenwich. */
export const LANE_ORDER = [1, 4, 6];

/** The row that collects games with no recorded lane. */
export const UNKNOWN_LANE = { id: null, name: "Unknown", color: null };

export const playerLane = (match) => match?.lane_real ?? match?.lane ?? null;

export const laneMeta = (lane) => LANE_META[Number(lane)] ?? null;

/**
 * Games, share and win rate per lane, in York/Broadway/Greenwich order with the
 * unrecorded games last. Every lane is listed even at zero, so the table is
 * comparable between players; a win rate is null (rendered "—") until a lane has
 * a decided game, and unknown results count toward games but never toward it.
 */
export function laneBreakdown(matches = []) {
  const buckets = new Map(
    [...LANE_ORDER, UNKNOWN_LANE.id].map((id) => [
      id,
      { ...(LANE_META[id] ?? UNKNOWN_LANE), games: 0, wins: 0, losses: 0 },
    ]),
  );

  for (const match of matches) {
    const id = Number(playerLane(match));
    const row = buckets.get(buckets.has(id) ? id : null);
    row.games += 1;
    const outcome = matchOutcome(match);
    if (outcome === WIN) row.wins += 1;
    else if (outcome === LOSS) row.losses += 1;
  }

  const total = matches.length;
  return {
    total,
    rows: [...LANE_ORDER, null].map((id) => {
      const row = buckets.get(id);
      const decided = row.wins + row.losses;
      return {
        ...row,
        decided,
        share: total > 0 ? row.games / total : null,
        winRate: decided > 0 ? row.wins / decided : null,
      };
    }),
  };
}
