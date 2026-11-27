/**
 * The timeline's event feed: kills, objectives, team fights and key item buys in one
 * time-ordered list, narrowed by what the reader is looking at.
 *
 * The rules ported here are the v3 handoff's, and several are easy to get wrong:
 *
 *  - Reveal: a row is listed only once the clock reaches it -- nothing future is shown.
 *    A focused fight is the exception: the reader asked to see that whole engagement.
 *  - Key items only appear when a player is highlighted (or the filter is Key items),
 *    because a match logs a few hundred buys and they would bury everything else.
 *  - A kill that belongs to a team fight is indented under that fight's header row,
 *    but only while the filter is not "Kills" -- filtering to kills alone means the
 *    fights are not on screen to indent under.
 *  - A fight whose header is revealed but whose last kill is not yet is "in progress":
 *    its score counts the kills so far and its outcome is not known.
 *  - Quiet stretches: in All events, runs of 3+ unremarkable rows (pick-offs outside a
 *    fight with no badge, or item buys) fold into one expandable row.
 *
 * Rows carry semantic flags (`background`, `current`, `hovered`, `indented`) rather
 * than colours, so the component decides presentation and this stays testable.
 */

import { killInvolves } from "./matchTimelineMap";

export const FEED_FILTERS = [
  { value: "all", label: "All events", glyph: null },
  { value: "kills", label: "Kills", glyph: "circle" },
  { value: "obj", label: "Objectives", glyph: "diamond" },
  { value: "fights", label: "Team fights", glyph: "square" },
  { value: "items", label: "Key items", glyph: "rounded" },
];

/** A run of this many quiet rows or more folds into one quiet-stretch row. */
export const QUIET_MIN_ROWS = 3;

const toNumber = (value) => (value == null ? null : Number(value));
const timeOf = (row) => row.timeS ?? 0;

/**
 * Every row a filter and selection allow, before the clock, focus or folding apply.
 * Unsorted.
 */
function collectRows(model, { filter = "all", selection = [] } = {}) {
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

  const rows = [];

  if (filter !== "obj" && filter !== "items") {
    for (const kill of kills) {
      if (hasSelection && !involves(kill)) continue;
      const fight = fightByKill.get(kill.id) ?? null;
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

  return rows;
}

/** A fight's header sits at its (padded) start, and reads above any kill on that second. */
function sortRows(rows) {
  return rows.sort(
    (a, b) => timeOf(a) - timeOf(b) || (a.kind === "fight" ? -1 : 0) - (b.kind === "fight" ? -1 : 0),
  );
}

/** The rows a focused fight shows: its header, its kills and its follow-up objective. */
function focusRows(rows, focusedFight) {
  const followUp = focusedFight.objective ?? null;
  return rows.filter(
    (row) =>
      (row.kind === "fight" && row.fight.index === focusedFight.index) ||
      row.fightIndex === focusedFight.index ||
      (row.kind === "objective" && followUp && row.objective === followUp),
  );
}

/**
 * A fight as the card shows it at the clock. Before its last kill it is in progress:
 * the score counts only the kills so far and there is no winner or follow-up yet. A
 * finished fight's follow-up objective is only named once it has fallen.
 */
export function fightAt(fight, at = Infinity) {
  const inProgress = at < fight.endS;
  if (!inProgress) {
    const followUpS = fight.objective?.timeS;
    return {
      inProgress: false,
      score: fight.score,
      winner: fight.winner,
      followUp: fight.objective && (followUpS == null || followUpS <= at) ? fight.objective : null,
    };
  }
  const soFar = fight.kills.filter((kill) => timeOf(kill) <= at);
  const amber = soFar.filter((kill) => kill.team === 0).length;
  const sapphire = soFar.filter((kill) => kill.team === 1).length;
  return { inProgress: true, score: `${amber}–${sapphire}`, winner: null, followUp: null };
}

/** Rows a quiet stretch may swallow: nothing a reader would scan the feed for. */
function isQuiet(row) {
  if (row.kind === "item") return true;
  return row.kind === "kill" && row.fightIndex == null && !(row.badges?.length);
}

/** "3 picks · 1 item" for a stretch's contents. */
export function quietSummary({ picks = 0, items = 0 } = {}) {
  const parts = [];
  if (picks) parts.push(`${picks} pick${picks === 1 ? "" : "s"}`);
  if (items) parts.push(`${items} item${items === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Fold runs of `QUIET_MIN_ROWS`+ quiet rows into one stretch row. A stretch is keyed by
 * its first event's time, so its expanded state survives the clock moving and the run
 * growing. An expanded stretch keeps its header (to collapse it) followed by its rows.
 */
function foldQuiet(rows, expanded) {
  const out = [];
  let run = [];

  const flush = () => {
    if (run.length >= QUIET_MIN_ROWS) {
      const first = run[0];
      const key = `quiet-${timeOf(first)}`;
      const isOpen = expanded.has(key);
      out.push({
        kind: "quiet",
        key,
        timeS: timeOf(first),
        startS: timeOf(first),
        endS: timeOf(run[run.length - 1]),
        picks: run.filter((row) => row.kind === "kill").length,
        items: run.filter((row) => row.kind === "item").length,
        expanded: isOpen,
        // While folded, the stretch stands in for its rows' states.
        current: !isOpen && run.some((row) => row.current),
        hovered: !isOpen && run.some((row) => row.hovered),
        background: !isOpen && run.some((row) => row.current) ? "current" : null,
      });
      if (isOpen) out.push(...run.map((row) => ({ ...row, inStretch: key })));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const row of rows) {
    if (isQuiet(row)) {
      run.push(row);
    } else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}

/**
 * The feed's rows for the current view. `t` is the clock: only events at or before it
 * are listed, and the latest of them is marked current (until the match ends). A
 * focused fight overrides both the clock and the filter's breadth.
 *
 * `hoveredFightIndex` lifts a fight card's border; `expandedQuiet` is the set of
 * quiet-stretch keys the reader has opened.
 */
export function buildFeedRows(
  model,
  {
    t = null,
    filter = "all",
    selection = [],
    hoveredKillId = null,
    hoveredFightIndex = null,
    focusedFight = null,
    durationS = null,
    expandedQuiet = new Set(),
  } = {},
) {
  if (!model) return [];

  const at = t == null ? Infinity : toNumber(t);
  let rows = collectRows(model, { filter, selection });
  rows = focusedFight ? focusRows(rows, focusedFight) : rows.filter((row) => timeOf(row) <= at);
  sortRows(rows);

  // At the end of the match every row is in the past, so nothing is "current".
  const atEnd = durationS != null && at >= toNumber(durationS);
  const currentIndex = focusedFight || atEnd ? -1 : rows.length - 1;

  rows = rows.map((row, index) => {
    const current = index === currentIndex;
    if (row.kind === "fight") {
      const hovered = hoveredFightIndex != null && row.fight.index === hoveredFightIndex;
      return {
        ...row,
        // A focused fight is read whole, so it is never shown as still running.
        ...(focusedFight ? fightAt(row.fight) : fightAt(row.fight, at)),
        current,
        hovered,
        focused: Boolean(focusedFight),
        background: focusedFight ? "fightFocused" : "fight",
      };
    }
    const hovered = row.kind === "kill" && hoveredKillId != null && row.killId === hoveredKillId;
    return {
      ...row,
      current,
      hovered,
      background: hovered ? "hover" : current ? "current" : null,
    };
  });

  return filter === "all" && !focusedFight ? foldQuiet(rows, expandedQuiet) : rows;
}

/**
 * How many events each tab holds at the clock, for the count pills. Counts only what
 * has happened (`t`), and follows the selection the same way the rows do. The fights
 * tab counts fights, not the kills listed under them.
 */
export function feedCounts(model, { t = null, selection = [] } = {}) {
  const counts = Object.fromEntries(FEED_FILTERS.map((option) => [option.value, 0]));
  if (!model) return counts;
  const at = t == null ? Infinity : toNumber(t);
  const kindFor = { kills: "kill", obj: "objective", fights: "fight", items: "item" };

  for (const { value } of FEED_FILTERS) {
    const rows = collectRows(model, { filter: value, selection }).filter((row) => timeOf(row) <= at);
    counts[value] = value === "all" ? rows.length : rows.filter((row) => row.kind === kindFor[value]).length;
  }
  return counts;
}
