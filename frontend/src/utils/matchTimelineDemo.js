/**
 * The Timeline's reading of demo data (`/db/matches/<id>/demo`, written by
 * `backend/main.py -demoparse`).
 *
 * The demo records every player's souls and assists every second, so unlike the stats
 * snapshots (minutes apart) nothing here interpolates: a value at `t` is the sample for
 * that second. When a match has no parsed demo every function returns its empty value
 * and the tab leaves souls blank, exactly as before demo parsing existed.
 *
 * Pure throughout, so every rule is unit-tested in `matchTimelineDemo.test.js`.
 */

/** True when the API returned a parsed demo with at least one player's series. */
export function hasDemo(demo) {
  return Boolean(demo?.available && demo.players && Object.keys(demo.players).length);
}

const stepOf = (demo) => Math.max(1, Number(demo?.step_s) || 1);

/** The sample index for match second `t`, clamped to the series. */
export function sampleIndex(demo, t, length) {
  const index = Math.floor(Math.max(0, Number(t) || 0) / stepOf(demo));
  return Math.min(Math.max(0, index), Math.max(0, length - 1));
}

/** One player's value of `field` at second `t`, or null without that series. */
export function demoValueAt(demo, accountId, field, t) {
  const values = demo?.players?.[String(accountId)]?.[field];
  if (!Array.isArray(values) || values.length === 0) return null;
  return values[sampleIndex(demo, t, values.length)];
}

/**
 * Amber-minus-Sapphire souls every second, in the shape `soulLeadSeries` returns
 * (`[{ timeS, lead, souls: [amber, sapphire] }]`), so the header, the turning points and
 * the soul-lead lane read demo data through the same code paths as before.
 */
export function demoSoulLeadSeries(demo) {
  if (!hasDemo(demo)) return [];
  const sides = Object.values(demo.players).filter(
    (player) => (player.team === 0 || player.team === 1) && Array.isArray(player.souls),
  );
  const length = Math.max(0, ...sides.map((player) => player.souls.length));
  const step = stepOf(demo);
  const series = [];
  for (let i = 0; i < length; i += 1) {
    const souls = [0, 0];
    for (const player of sides) {
      const values = player.souls;
      souls[player.team] += values[Math.min(i, values.length - 1)] ?? 0;
    }
    series.push({ timeS: i * step, lead: souls[0] - souls[1], souls });
  }
  return series;
}

/** First index in time-sorted `rows` (`[timeS, ...]`) at or after `timeS`. */
function lowerBound(rows, timeS) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid][0] < timeS) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * What a fight cost and earned, from the demo: each side's souls gained between its
 * start and end, and whoever dealt the most hero damage inside it.
 *
 * `playersByAccount` maps account id -> the match's player row, for the top damage
 * dealer's name, hero and side. Returns null without a demo.
 */
export function fightDemoStats(fight, demo, playersByAccount = new Map()) {
  if (!hasDemo(demo) || !fight) return null;

  const series = demo._soulLead ?? demoSoulLeadSeries(demo);
  let soulsGained = null;
  if (series.length) {
    const at = (t) => series[sampleIndex(demo, t, series.length)].souls;
    const [startAmber, startSapphire] = at(fight.startS);
    const [endAmber, endSapphire] = at(fight.endS);
    soulsGained = [Math.max(0, endAmber - startAmber), Math.max(0, endSapphire - startSapphire)];
  }

  let topDamage = null;
  const rows = Array.isArray(demo.damage) ? demo.damage : [];
  if (rows.length) {
    const totals = new Map();
    for (let i = lowerBound(rows, Math.floor(fight.startS)); i < rows.length && rows[i][0] <= fight.endS; i += 1) {
      const [, attacker, , damage] = rows[i];
      totals.set(attacker, (totals.get(attacker) || 0) + (Number(damage) || 0));
    }
    for (const [accountId, damage] of totals) {
      if (damage > (topDamage?.damage ?? 0)) {
        const player = playersByAccount.get(accountId) ?? null;
        topDamage = {
          accountId,
          damage,
          name: player?.persona_name ?? null,
          heroId: player?.hero_id ?? demo.players?.[String(accountId)]?.hero_id ?? null,
          team: player?.team ?? demo.players?.[String(accountId)]?.team ?? null,
        };
      }
    }
  }

  return { soulsGained, topDamage };
}

/**
 * The model's fights with their demo stats attached as `demoStats`, so the feed's fight
 * cards can show souls gained and top damage. Fights are returned unchanged (same
 * objects) without a demo.
 */
export function withFightDemoStats(fights = [], demo, players = []) {
  if (!hasDemo(demo)) return fights;
  const playersByAccount = new Map(
    (players || []).filter((player) => player?.account_id != null).map((player) => [player.account_id, player]),
  );
  // Built once and shared, rather than once per fight.
  const shared = { ...demo, _soulLead: demoSoulLeadSeries(demo) };
  return (fights || []).map((fight) => ({ ...fight, demoStats: fightDemoStats(fight, shared, playersByAccount) }));
}
