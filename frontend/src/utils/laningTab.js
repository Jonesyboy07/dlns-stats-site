/**
 * The laning tab's data layer: the opening ten minutes as a playable map, a lane
 * head-to-head and a mirrored build table.
 *
 * Everything here is pure -- no DOM, no timers -- so the clock, the reveal rules and
 * the lane maths stay testable without a browser. The components only paint what these
 * functions return, the same split the timeline tab uses.
 *
 * The inputs are the model the page already builds (`timelineModel.kills`,
 * `timelineModel.objectives`), the per-player purchase log and the build payload, so
 * the tab cannot disagree with the rest of the page about who killed whom. Anything the
 * data cannot answer comes back as `null` rather than a misleading 0, and the reveal
 * rules never show a number the clock has not reached.
 */

import { LANE_META, LANE_ORDER, playerLane } from "./lanes";
import { LANING_END_S } from "./laning";
import { worldToPercent } from "./matchMap";

/**
 * Laning playback runs ten game-seconds per real second at 1x, so the whole ten-minute
 * phase plays in about a minute. This is the tab's own clock: it is not the timeline
 * tab's real-time one.
 */
export const LANING_PLAYBACK_RATE = 10;

/** Playback speeds the transport offers, slowest first. 1 is the rate above. */
export const LANING_SPEEDS = [0.5, 1, 2, 4];

/** Item slots the build table draws per player. */
export const LANING_ITEM_SLOTS = 6;

/** Point steps the ability grid draws, shared by all four ability rows. */
export const LANING_ABILITY_STEPS = 10;

/** A hero's abilities, in the slot order the rows are drawn in. */
export const LANING_ABILITY_SLOTS = [1, 2, 3, 4];

/** A kill this many seconds old is drawn as "just happened" on the map. */
export const LANING_RECENT_KILL_S = 30;

/** Dot sizes: the resting size, and the size a kill grows to when it is the subject. */
export const LANING_DOT_SIZE = 12;
export const LANING_DOT_SIZE_ACTIVE = 18;

/**
 * The Tier 1 guardian of each lane, by Valve's objective id. The ids are the enum's
 * lane slots, which do not line up with lane ids 1/4/6 (see `objective_lane` in the
 * backend); ids 5/7/8 are the Tier 2 walkers and 12/14/15 the barracks bosses.
 */
export const LANING_T1_BY_LANE = { 1: 1, 4: 3, 6: 4 };

/** Point cost of an ability tier. Tier 0 is the unlock and costs nothing. */
const TIER_COST = { 1: 1, 2: 2, 3: 5 };
const MAX_TIER_COST = 5;

/** A finite number, or null for anything a missing value could hide behind. */
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `value` when it is an array, otherwise an empty list -- a bad argument must not throw. */
const list = (value) => (Array.isArray(value) ? value : []);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// ---------------------------------------------------------------------------
// The playback clock
// ---------------------------------------------------------------------------

/**
 * The clock after `deltaSeconds` of real time at `speed`. Playback is clamped to the
 * laning window, and a speed or delta that cannot be used advances nothing, so a bad
 * value stalls the clock rather than throwing it somewhere.
 */
export function laningStep(time, deltaSeconds, speed, endS = LANING_END_S) {
  const from = numberOrNull(time) ?? 0;
  const delta = numberOrNull(deltaSeconds) ?? 0;
  const rate = numberOrNull(speed);
  const end = numberOrNull(endS) ?? LANING_END_S;
  if (rate === null || rate <= 0 || delta <= 0) return clamp(from, 0, end);
  return clamp(from + delta * LANING_PLAYBACK_RATE * rate, 0, end);
}

/** Whether the clock has reached the end of the laning window. */
export function laningEnded(time, endS = LANING_END_S) {
  const at = numberOrNull(time);
  const end = numberOrNull(endS) ?? LANING_END_S;
  return at !== null && at >= end;
}

/**
 * Where pressing Play starts from: the end of the window starts it over, anywhere else
 * carries on from where it was left.
 */
export function laningStartTime(time, endS = LANING_END_S) {
  const from = numberOrNull(time) ?? 0;
  return laningEnded(from, endS) ? 0 : clamp(from, 0, numberOrNull(endS) ?? LANING_END_S);
}

/** The clock for a scrub position, given the track's 0..1 ratio. */
export function laningScrubTime(ratio, endS = LANING_END_S) {
  const end = numberOrNull(endS) ?? LANING_END_S;
  const value = numberOrNull(ratio) ?? 0;
  return clamp(value, 0, 1) * end;
}

/** A time as a percentage along the scrubber. */
export function laningPercent(time, endS = LANING_END_S) {
  const at = numberOrNull(time);
  const end = numberOrNull(endS) ?? LANING_END_S;
  if (at === null || end <= 0) return 0;
  return clamp((at / end) * 100, 0, 100);
}

// ---------------------------------------------------------------------------
// Kills in the window
// ---------------------------------------------------------------------------

/** Players keyed by slot and by account, so a kill can be resolved either way. */
function indexPlayers(players = []) {
  const bySlot = new Map();
  const byAccount = new Map();
  for (const player of list(players)) {
    const slot = numberOrNull(player?.player_slot);
    const account = numberOrNull(player?.account_id);
    if (slot !== null) bySlot.set(slot, player);
    if (account !== null) byAccount.set(account, player);
  }
  return { bySlot, byAccount };
}

/**
 * The kills inside the laning window, each resolved to its killer and its victim. The
 * lane is the *victim's* lane: a gank counts for the lane that was killed in, which is
 * the reading the design asks for. Kills the data cannot place are kept with a null
 * lane rather than dropped, so the feed can still show them.
 */
export function laningKillList(kills = [], players = [], endS = LANING_END_S) {
  const { bySlot, byAccount } = indexPlayers(players);
  const find = (slot, accountId) =>
    (slot !== null ? bySlot.get(slot) : null) ?? (accountId !== null ? byAccount.get(accountId) : null) ?? null;

  return list(kills)
    .filter((kill) => {
      const timeS = numberOrNull(kill?.timeS);
      return timeS !== null && timeS <= endS;
    })
    .map((kill) => {
      const victim = find(numberOrNull(kill?.victimSlot), numberOrNull(kill?.victimAccountId));
      const killer = find(numberOrNull(kill?.killerSlot), numberOrNull(kill?.killerAccountId));
      const lane = numberOrNull(playerLane(victim));
      const point = kill?.position ? worldToPercent(kill.position.x, kill.position.y) : null;
      return {
        id: kill?.id ?? null,
        timeS: numberOrNull(kill?.timeS),
        lane,
        laneName: LANE_META[lane]?.name ?? null,
        laneColor: LANE_META[lane]?.color ?? null,
        // The killing side, which is what colours the dot and the feed row.
        team: numberOrNull(kill?.team) ?? numberOrNull(killer?.team) ?? null,
        victimTeam: numberOrNull(kill?.killedTeam) ?? numberOrNull(victim?.team) ?? null,
        killerName: kill?.killerName ?? killer?.persona_name ?? null,
        killerHeroId: numberOrNull(kill?.killerHeroId) ?? numberOrNull(killer?.hero_id),
        killerAccountId: numberOrNull(kill?.killerAccountId),
        victimName: kill?.victimName ?? victim?.persona_name ?? null,
        victimHeroId: numberOrNull(kill?.victimHeroId) ?? numberOrNull(victim?.hero_id),
        victimAccountId: numberOrNull(kill?.victimAccountId),
        point,
      };
    });
}

/** Whether a kill belongs to the selected lane. `lane` of null means every lane. */
export function inSelectedLane(kill, lane = null) {
  const selected = numberOrNull(lane);
  if (selected === null) return true;
  return numberOrNull(kill?.lane) === selected;
}

/**
 * The map dots: where every kill in the window happened, how big it is drawn and how
 * visible. A kill the clock has not reached is invisible rather than absent, so the map
 * does not flicker as kills appear. A kill outside the selected lane fades almost out,
 * and hovering one fades the others.
 */
export function laningDots(killList = [], { lane = null, time = LANING_END_S, hoverKillId = null } = {}) {
  const at = numberOrNull(time) ?? LANING_END_S;
  return list(killList).map((kill) => {
    const past = kill.timeS !== null && kill.timeS <= at;
    const inLane = inSelectedLane(kill, lane);
    const hovered = hoverKillId !== null && kill.id === hoverKillId;
    const recent = past && at - kill.timeS < LANING_RECENT_KILL_S;
    const subject = hovered || recent;
    return {
      ...kill,
      hovered,
      past,
      recent,
      inLane,
      size: subject ? LANING_DOT_SIZE_ACTIVE : LANING_DOT_SIZE,
      opacity: !past
        ? 0
        : !inLane
          ? 0.1
          : hoverKillId !== null && !hovered
            ? 0.3
            : subject
              ? 1
              : 0.6,
    };
  });
}

/**
 * The kill feed rows: the selected lane's kills in time order, with the ones the clock
 * has not reached dimmed rather than hidden so the list does not reflow as it plays.
 */
export function laningFeed(killList = [], { lane = null, time = LANING_END_S, hoverKillId = null } = {}) {
  const at = numberOrNull(time) ?? LANING_END_S;
  return list(killList)
    .filter((kill) => inSelectedLane(kill, lane))
    .map((kill) => ({
      ...kill,
      past: kill.timeS !== null && kill.timeS <= at,
      hovered: hoverKillId !== null && kill.id === hoverKillId,
    }));
}

/**
 * Deaths by the clock, split by the *victim's* team -- the caption reads as how many
 * each side lost, including the kills the filter is hiding.
 */
export function laningDeathTally(killList = [], { lane = null, time = LANING_END_S } = {}) {
  const at = numberOrNull(time) ?? LANING_END_S;
  const tally = { total: 0, amber: 0, sapphire: 0 };
  for (const kill of list(killList)) {
    if (!inSelectedLane(kill, lane)) continue;
    if (kill.timeS === null || kill.timeS > at) continue;
    tally.total += 1;
    if (kill.victimTeam === 0) tally.amber += 1;
    else if (kill.victimTeam === 1) tally.sapphire += 1;
  }
  return tally;
}

/** The scrubber's kill markers, as a position along the track plus their side. */
export function laningTicks(killList = [], { lane = null, endS = LANING_END_S } = {}) {
  return list(killList).map((kill) => ({
    id: kill.id,
    left: laningPercent(kill.timeS, endS),
    team: kill.team,
    inLane: inSelectedLane(kill, lane),
  }));
}

// ---------------------------------------------------------------------------
// Tier 1 guardians
// ---------------------------------------------------------------------------

/**
 * When each side's own Tier 1 guardian in a lane fell. `objectives` are the model's
 * rows, whose `team` is the side that destroyed the objective, so the guardian that
 * fell belongs to the *other* side. A guardian that never fell (`destroyed_time_s` of
 * 0, or no row at all) is `standing`; one that fell after the laning window still
 * reports its time, flagged `beyondWindow`, because the design shows this row whatever
 * the clock says.
 */
export function laneGuardians(objectives = [], lane, endS = LANING_END_S) {
  const wanted = LANING_T1_BY_LANE[numberOrNull(lane)];
  const rows = list(objectives).filter((row) => numberOrNull(row?.objectiveId) === wanted);
  const end = numberOrNull(endS) ?? LANING_END_S;

  const sideOf = (destroyingTeam) => {
    const row = rows.find((candidate) => numberOrNull(candidate?.team) === destroyingTeam);
    const timeS = numberOrNull(row?.timeS);
    if (timeS === null || timeS <= 0) return { timeS: null, standing: true, beyondWindow: false };
    return { timeS, standing: false, beyondWindow: timeS > end };
  };

  // Sapphire destroying the objective means the amber guardian fell, and vice versa.
  return { amber: sideOf(1), sapphire: sideOf(0) };
}

// ---------------------------------------------------------------------------
// Head-to-head
// ---------------------------------------------------------------------------

/** One `label | left bar | right bar` row. `kind` is "bar" unless stated otherwise. */
function dualRow({ key, label, left, right, format = "souls" }) {
  const l = numberOrNull(left);
  const r = numberOrNull(right);
  const known = l !== null || r !== null;
  const max = Math.max(l ?? 0, r ?? 0);
  const ratio = (value) => (known && max > 0 && value !== null ? clamp(value / max, 0, 1) : 0);
  // Who is ahead, as the bars and the value colours are drawn from: a tie lights both
  // sides (they are level, not both losing), and unknown lights neither.
  const leader = !known || l === null || r === null ? null : l > r ? "left" : r > l ? "right" : "tie";
  return {
    key,
    label,
    kind: "bar",
    format,
    known,
    leader,
    left: { value: l, ratio: ratio(l) },
    right: { value: r, ratio: ratio(r) },
  };
}

/** A side's total for one stat, and whether any player behind it was known. */
function sideTotal(players, valueOf) {
  let total = 0;
  let known = false;
  for (const player of list(players)) {
    const value = numberOrNull(valueOf(player));
    if (value === null) continue;
    total += value;
    known = true;
  }
  return { total, known };
}

/**
 * The team-format values each head-to-head row is built from, so the component can
 * format them without the maths knowing about team names or thousands.
 */
export const HEAD_TO_HEAD_FORMAT = {
  souls: "souls",
  damage: "damage",
  count: "count",
};

/**
 * The lane's head-to-head rows: souls at 5:00 and 10:00, hero damage and kills, each
 * summed per side. `valuesOf(player)` must return `{ souls5, souls10, heroDamage,
 * kills }` -- null where the snapshots cannot answer, which leaves the row unknown
 * rather than drawn as a loss.
 */
export function laneHeadToHead(players = [], valuesOf) {
  const left = list(players).filter((player) => numberOrNull(player?.team) === 0);
  const right = list(players).filter((player) => numberOrNull(player?.team) === 1);
  const total = (key) => ({
    left: sideTotal(left, (player) => valuesOf(player)?.[key]),
    right: sideTotal(right, (player) => valuesOf(player)?.[key]),
  });

  const souls5 = total("souls5");
  const souls10 = total("souls10");
  const damage = total("heroDamage");
  const kills = total("kills");

  const leadOf = (pair) => {
    if (!pair.left.known || !pair.right.known) return null;
    return pair.left.total - pair.right.total;
  };

  return {
    players: { left, right },
    rows: [
      dualRow({
        key: "souls5",
        label: "SOULS @5:00",
        left: souls5.left.known ? souls5.left.total : null,
        right: souls5.right.known ? souls5.right.total : null,
        format: HEAD_TO_HEAD_FORMAT.souls,
      }),
      dualRow({
        key: "souls10",
        label: "SOULS @10:00",
        left: souls10.left.known ? souls10.left.total : null,
        right: souls10.right.known ? souls10.right.total : null,
      }),
      dualRow({
        key: "heroDamage",
        label: "HERO DMG",
        left: damage.left.known ? damage.left.total : null,
        right: damage.right.known ? damage.right.total : null,
        format: HEAD_TO_HEAD_FORMAT.damage,
      }),
      dualRow({
        key: "kills",
        label: "KILLS",
        left: kills.left.known ? kills.left.total : null,
        right: kills.right.known ? kills.right.total : null,
        format: HEAD_TO_HEAD_FORMAT.count,
      }),
    ],
    // The headline lead is the end-of-laning souls difference, which is what the
    // All view ranks lanes by too.
    lead: leadOf(souls10),
  };
}

/**
 * The All view's rows: combined souls at 10:00 per lane, in York/Broadway/Greenwich
 * order, with the overall lead across every lane.
 */
export function laneHeadToHeadAll(laneRows = [], valuesOf) {
  const rows = list(laneRows).map((row) => {
    const left = sideTotal(row?.left, (player) => valuesOf(player)?.souls10);
    const right = sideTotal(row?.right, (player) => valuesOf(player)?.souls10);
    return dualRow({
      key: `lane-${row?.lane}`,
      label: (LANE_META[numberOrNull(row?.lane)]?.name ?? "Unknown").toUpperCase(),
      left: left.known ? left.total : null,
      right: right.known ? right.total : null,
    });
  });

  let leftTotal = 0;
  let rightTotal = 0;
  let leftKnown = false;
  let rightKnown = false;
  for (const row of list(laneRows)) {
    const left = sideTotal(row?.left, (player) => valuesOf(player)?.souls10);
    const right = sideTotal(row?.right, (player) => valuesOf(player)?.souls10);
    if (left.known) {
      leftTotal += left.total;
      leftKnown = true;
    }
    if (right.known) {
      rightTotal += right.total;
      rightKnown = true;
    }
  }

  return { rows, lead: leftKnown && rightKnown ? leftTotal - rightTotal : null };
}

// ---------------------------------------------------------------------------
// Ability order
// ---------------------------------------------------------------------------

/** The point cost of an ability tier: 0 is the unlock, then 1/2/5 points. */
export function tierCost(tier) {
  const value = numberOrNull(tier);
  if (value === null || value <= 0) return 0;
  return TIER_COST[value] ?? MAX_TIER_COST;
}

/**
 * The ability grid: one row per ability slot, and one cell per point spent in the game
 * so far. Points are ordered by when they were spent -- not by which ability they went
 * into -- so column *n* is the *n*th point of the game, and it lights up in the row of
 * the ability that point bought. That is what makes the grid read as a build order
 * rather than four unrelated bars.
 *
 * A point the clock has not reached is not drawn. A point with no recorded time is
 * never drawn: the data cannot say when it happened, and guessing a column would put it
 * in the wrong place. `slot` orders the rows (the payload's own order is the order the
 * points were spent in, which is not slot order); abilities without one keep the order
 * they arrived in.
 */
export function abilityOrderRows(
  abilities = [],
  time = LANING_END_S,
  steps = LANING_ABILITY_STEPS,
) {
  const at = numberOrNull(time) ?? LANING_END_S;
  const rows = list(abilities).map((ability, index) => ({
    key: numberOrNull(ability?.ability_id) ?? `ability-${index}`,
    abilityId: numberOrNull(ability?.ability_id),
    slot: numberOrNull(ability?.slot) ?? index + 1,
    name: ability?.name ?? null,
    image: ability?.image ?? null,
    cells: Array.from({ length: steps }, () => null),
  }));

  // The points, in the order they were spent. Two points spent in the same second have
  // no recorded order -- the payload lists them the way the API happened to -- so ties
  // fall back to slot order, which at least draws the same grid every time.
  const points = [];
  list(abilities).forEach((ability, index) => {
    for (const upgrade of list(ability?.upgrades)) {
      const timeS = numberOrNull(upgrade?.game_time_s);
      if (timeS === null || timeS <= 0) continue;
      points.push({
        rowIndex: index,
        slot: numberOrNull(ability?.slot) ?? index + 1,
        timeS,
        tier: numberOrNull(upgrade?.tier) ?? 0,
      });
    }
  });
  points.sort((a, b) => a.timeS - b.timeS || a.slot - b.slot || a.rowIndex - b.rowIndex);

  points.slice(0, steps).forEach((point, column) => {
    const row = rows[point.rowIndex];
    if (!row || point.timeS > at) return;
    const cost = tierCost(point.tier);
    row.cells[column] = {
      kind: cost === 0 ? "unlock" : "upgrade",
      cost,
      tier: point.tier,
      timeS: point.timeS,
      abilityId: row.abilityId,
    };
  });

  rows.sort((a, b) => a.slot - b.slot);
  return rows;
}

// ---------------------------------------------------------------------------
// Items and the mirrored build table
// ---------------------------------------------------------------------------

/**
 * A player's items as of `time`: everything bought at or before the clock, minus
 * anything already sold, in purchase order and capped at `count` slots. Selling frees
 * a slot, so the items behind it move up -- this is the inventory at that moment, not a
 * purchase history.
 */
export function itemSlots(purchases = [], accountId, time, count = LANING_ITEM_SLOTS) {
  const account = numberOrNull(accountId);
  const at = numberOrNull(time) ?? LANING_END_S;
  const bought = list(purchases)
    .filter((purchase) => numberOrNull(purchase?.account_id) === account)
    .map((purchase) => ({
      timeS: numberOrNull(purchase?.time_s),
      soldTimeS: numberOrNull(purchase?.sold_time_s),
      name: purchase?.item ?? null,
      image: purchase?.image ?? null,
      icon: purchase?.icon ?? null,
      itemId: numberOrNull(purchase?.item_id),
    }))
    .filter((purchase) => purchase.timeS !== null && purchase.timeS <= at)
    .filter((purchase) => purchase.soldTimeS === null || purchase.soldTimeS > at)
    .sort((a, b) => a.timeS - b.timeS || (a.itemId ?? 0) - (b.itemId ?? 0));

  return Array.from({ length: count }, (_, index) => {
    const purchase = bought[index];
    if (!purchase) return { key: `slot-${index}`, empty: true, name: null, image: null };
    return {
      key: `slot-${index}`,
      empty: false,
      name: purchase.name,
      image: purchase.image,
      icon: purchase.icon,
      boughtAtS: purchase.timeS,
    };
  });
}

/**
 * The mirrored build table: for each lane in York/Broadway/Greenwich order, its amber
 * players paired against its sapphire players by position within the lane, so the two
 * sides of a row are actually laning against each other. A lane can field an odd
 * number, so a row can have one side missing.
 *
 * `lane` of null lists every lane (what the All view shows). Each side carries the
 * player's identity, their laning K/D/A, their ability grid at the clock and their
 * items at the clock.
 */
export function buildTableRows({
  laneRows = [],
  lane = null,
  valuesOf = () => null,
  buildsFor = () => null,
  purchases = [],
  time = LANING_END_S,
} = {}) {
  const selected = numberOrNull(lane);
  const rows = [];

  for (const row of list(laneRows)) {
    if (selected !== null && numberOrNull(row?.lane) !== selected) continue;
    const left = list(row?.left);
    const right = list(row?.right);
    const count = Math.max(left.length, right.length);

    for (let index = 0; index < count; index += 1) {
      const side = (player) => {
        if (!player) return null;
        const build = buildsFor(player) || {};
        return {
          accountId: numberOrNull(player.account_id),
          slot: numberOrNull(player.player_slot),
          name: player.persona_name || "Anonymous",
          heroId: numberOrNull(player.hero_id),
          team: numberOrNull(player.team),
          kda: {
            kills: numberOrNull(valuesOf(player)?.kills),
            deaths: numberOrNull(valuesOf(player)?.deaths),
            assists: numberOrNull(valuesOf(player)?.assists),
          },
          abilities: abilityOrderRows(build.abilities ?? [], time),
          items: itemSlots(purchases, player.account_id, time),
        };
      };

      rows.push({
        key: `${row?.lane}-${index}`,
        lane: numberOrNull(row?.lane),
        laneName: LANE_META[numberOrNull(row?.lane)]?.name ?? null,
        laneColor: LANE_META[numberOrNull(row?.lane)]?.color ?? null,
        // A new lane group takes a divider, and every other row alternates its fill.
        groupStart: index === 0 && rows.length > 0,
        alternate: rows.length % 2 === 1,
        left: side(left[index]),
        right: side(right[index]),
      });
    }
  }

  return rows;
}

/** The lane filter's options: All first, then the lanes in reading order. */
export const LANING_LANE_OPTIONS = [
  { id: null, name: "All" },
  ...LANE_ORDER.map((lane) => ({ id: lane, name: LANE_META[lane].name })),
];
