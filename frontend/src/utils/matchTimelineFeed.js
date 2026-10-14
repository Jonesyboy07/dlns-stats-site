/**
 * The timeline's event feed: kills, objectives, team fights and key item buys in one
 * time-ordered list, narrowed by what the reader is looking at.
 *
 * The rules ported here are the handoff's, and two of them are easy to get wrong:
 *
 *  - Key items only appear when a player is highlighted (or the filter is Key items),
 *    because a match logs a few hundred buys and they would bury everything else.
 *  - A kill that belongs to a team fight is indented under that fight's header row,
 *    but only while the filter is not "Kills" -- filtering to kills alone means the
 *    fights are not on screen to indent under.
 *
 * Rows carry semantic flags (`subdued`, `background`, `indented`) rather than colours,
 * so the component decides presentation and this stays testable.
 */

import { killInvolves } from "./matchTimelineMap";

export const FEED_FILTERS = [
  { value: "all", label: "All events" },
  { value: "kills", label: "Kills" },
  { value: "obj", label: "Objectives" },
  { value: "fights", label: "Team fights" },
  { value: "items", label: "Key items" },
];

/** Events after the clock are dimmed to this. */
export const FUTURE_OPACITY = 0.35;

const toNumber = (value) => (value == null ? null : Number(value));

/**
 * The feed's rows for the current view. `t` is the clock; events after it are dimmed
 * and the last one before it is marked as current. A focused fight overrides both the
 * clock and the filter's breadth: the reader asked to see exactly that engagement.
 */
export function buildFeedRows(
  model,
  {
    t = null,
    filter = "all",
    selection = [],
    hoveredKillId = null,
    focusedFight = null,
    durationS = null,
  } = {},
) {
  if (!model) return [];

  const kills = model.kills || [];
  const objectives = model.objectives || [];
  const purchases = model.keyPurchases || [];
  const fights = model.fights || [];
  const hasSelection = Boolean(selection?.length);
  const involves = (kill) => killInvolves(kill, selection);

  // Which fight a kill belongs to, so a row knows whether to indent.
  const fightByKill = new Map();
  fights.forEach((fight) => fight.killIds.forEach((killId) => fightByKill.set(killId, fight)));

  const playerName = (slot) =>
    model.playersBySlot?.get(toNumber(slot))?.persona_name ?? null;

  let rows = [];

  for (const kill of kills) {
    if (hasSelection && !involves(kill)) continue;
    const fight = fightByKill.get(kill.id) ?? null;
    if (filter === "obj" || filter === "items") continue;
    if (filter === "fights" && !fight) continue;

    rows.push({
      kind: "kill",
      key: `kill-${kill.id}`,
      timeS: kill.timeS,
      killId: kill.id,
      fightIndex: fight ? fight.index : null,
      indented: Boolean(fight) && filter !== "kills",
      victimName: kill.victimName ?? playerName(kill.victimSlot),
      killerName: kill.killerName ?? playerName(kill.killerSlot),
      // The design lifts highlighted players' names out of the body colour.
      victimSelected: selection.includes(kill.victimAccountId),
      killerSelected: selection.includes(kill.killerAccountId),
      heroId: kill.killerHeroId,
      team: kill.team,
      badges: kill.badges ?? [],
    });
  }

  if (filter === "all" || filter === "obj") {
    objectives.forEach((objective, index) => {
      rows.push({
        kind: "objective",
        key: `objective-${objective.id ?? index}`,
        timeS: objective.timeS,
        objective,
      });
    });
  }

  // Key items are the one row kind that is opt-in: either the filter asks for them or
  // a player is highlighted, otherwise a match's few hundred buys would drown the feed.
  if (filter === "items" || (filter === "all" && hasSelection)) {
    purchases.forEach((purchase, index) => {
      if (hasSelection && !selection.includes(purchase.accountId)) return;
      rows.push({
        kind: "item",
        key: `item-${purchase.itemId}-${purchase.timeS}-${index}`,
        timeS: purchase.timeS,
        purchase,
        playerName: playerName(purchase.playerSlot),
        playerSelected: selection.includes(purchase.accountId),
      });
    });
  }

  if (filter === "all" || filter === "fights") {
    fights.forEach((fight) => {
      if (hasSelection && !fight.kills.some(involves)) return;
      rows.push({ kind: "fight", key: `fight-${fight.index}`, timeS: fight.startS, fight });
    });
  }

  if (focusedFight) {
    const followUp = focusedFight.objective ?? null;
    rows = rows.filter(
      (row) =>
        (row.kind === "fight" && row.fight.index === focusedFight.index) ||
        row.fightIndex === focusedFight.index ||
        (row.kind === "objective" && followUp && row.objective === followUp),
    );
  }

  // A fight's header sits at its start time, and reads above any kill on that second.
  rows.sort(
    (a, b) =>
      (a.timeS ?? 0) - (b.timeS ?? 0) ||
      (a.kind === "fight" ? 1 : 0) - (b.kind === "fight" ? 1 : 0),
  );

  const at = t == null ? Infinity : toNumber(t);
  let currentIndex = -1;
  rows.forEach((row, index) => {
    if ((row.timeS ?? 0) <= at) currentIndex = index;
  });
  // At the end of the match every row is in the past, so nothing is "current".
  const atEnd = durationS != null && at >= toNumber(durationS);

  return rows.map((row, index) => {
    const past = (row.timeS ?? 0) <= at;
    const isCurrent = index === currentIndex && !focusedFight && !atEnd;
    const hovered = row.kind === "kill" && hoveredKillId != null && row.killId === hoveredKillId;
    return {
      ...row,
      subdued: !focusedFight && !past,
      background:
        row.kind === "fight"
          ? focusedFight
            ? "fightFocused"
            : "fight"
          : hovered
            ? "hover"
            : isCurrent
              ? "current"
              : null,
    };
  });
}
