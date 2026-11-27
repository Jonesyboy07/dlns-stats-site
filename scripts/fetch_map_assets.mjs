#!/usr/bin/env node
/**
 * Regenerate `frontend/src/data/mapAssets.json`: the ziplines and objective
 * positions the match maps draw.
 *
 * The maps must not call a third party on page load, and the geometry only
 * changes when Valve ships a new map, so it is fetched once and committed. Run:
 *
 *     node scripts/fetch_map_assets.mjs
 *
 * Two upstreams, both recorded in the output:
 *
 * - `deadlock-api`'s `/v1/assets/map` is authoritative for the ziplines and for
 *   the cores, titans, walkers and guardians. Its `left_relative`/`top_relative`
 *   are the marker's **top-left corner**, not its centre -- its own source says
 *   "the marker centre is `margin + size / 2`", with `Core` markers at 30% x 8%
 *   and every other icon at 10% x 10%. Placing the centre on those numbers is
 *   what made the markers sit half an icon up and to the left.
 * - `deadlock-plus`'s extracted map-item fixture supplies the base guardians
 *   (objective ids 12/14/15, `npc_barrack_boss`), which deadlock-api does not
 *   publish. Its coordinates for the tiers deadlock-api *does* publish are
 *   cross-checked, so a stale fixture is caught instead of silently drawn.
 *
 * The script fails loudly rather than writing a partial file: a radius that no
 * longer matches `MAP_RADIUS`, a zipline in a colour this file cannot name, an
 * unrecognised objective key, or a fixture from a different map build all mean
 * the upstream data moved and the mapping here needs a look.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_RADIUS } from "../frontend/src/utils/matchMap.js";
import { ziplinePath } from "../frontend/src/utils/mapZiplinePath.js";

const MAP_URL = "https://api.deadlock-api.com/v1/assets/map";

/** Pinned commit: the fixture only changes when someone re-runs this by hand. */
const BASE_GUARDIAN_COMMIT = "a1b1d3344d215e12f22d59b1297db40288c66ecc";
const BASE_GUARDIAN_URL =
  `https://raw.githubusercontent.com/deadlock-plus/deadlock-plus/${BASE_GUARDIAN_COMMIT}` +
  "/crates/ring2/dp-gamedata/fixtures/map_items.tsv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "frontend", "src", "data", "mapAssets.json");

/** Which map layout the published geometry belongs to (see `MAP_VERSIONS`). */
const MAP_VERSION = "post_cns";

/**
 * The API colours each zipline with the lane's in-game colour. They are close to,
 * not equal to, the site's own lane palette, so the lane is resolved here and the
 * file stores the palette colour every other lane mark already uses.
 */
const LANE_BY_COLOR = {
  "#f1cc30": 1, // York
  "#29b1cc": 4, // Broadway
  "#59b247": 6, // Greenwich
};

/** `LANE_META` in frontend/src/utils/lanes.js. */
const LANE_COLOR = { 1: "#facc15", 4: "#22d3ee", 6: "#4ade80" };

/**
 * The `objectives_map.css` marker box per kind, as fractions of the minimap. The
 * published position is the box's top-left corner, so the structure sits at
 * `position + size / 2`.
 */
const MARKER_SIZE = { core: [0.30, 0.08], icon: [0.10, 0.10] };

/**
 * Objective key -> `{ objectiveId, tier, lane }`, where the key's lane is the
 * asset's *slot* (1/3/4) and `lane` is the site's lane id (1/4/6) -- the same
 * mapping as `TEAM_OBJECTIVE_LANES` in backend/main.py.
 */
const OBJECTIVES = {
  core: { objectiveId: 0, tier: "core", lane: null },
  titan: { objectiveId: 9, tier: "titan", lane: null },
  tier1_1: { objectiveId: 1, tier: "tier1", lane: 1 },
  tier1_3: { objectiveId: 3, tier: "tier1", lane: 4 },
  tier1_4: { objectiveId: 4, tier: "tier1", lane: 6 },
  tier2_1: { objectiveId: 5, tier: "tier2", lane: 1 },
  tier2_3: { objectiveId: 7, tier: "tier2", lane: 4 },
  tier2_4: { objectiveId: 8, tier: "tier2", lane: 6 },
};

/** `npc_barrack_boss` lane slot -> the site's lane id. */
const SLOT_LANE = { 1: 1, 3: 4, 4: 6 };

const OBJECTIVE_KEY = /^team([01])_((?:tier[12]_[134])|titan|core)$/;

/** How far the fixture may disagree with the API before it is treated as stale. */
const FIXTURE_TOLERANCE_PCT = 0.05;

const round = (value, places) => {
  const scale = 10 ** places;
  return Math.round(Number(value) * scale) / scale;
};

/** A world point as `[left, top]` percentages of the minimap. */
function percent(x, y, radius = MAP_RADIUS) {
  return [
    round(((Number(x) + radius) / (2 * radius)) * 100, 2),
    round(((radius - Number(y)) / (2 * radius)) * 100, 2),
  ];
}

/** The three handles as flat `[x, y, ...]` arrays, dropping the unused height. */
function handles(points) {
  const flat = [];
  for (const point of points) flat.push(round(point[0], 0), round(point[1], 0));
  return flat;
}

/** Ziplines as `{ lane, color, path }`, ordered by lane. */
function ziplines(paths) {
  return (paths || [])
    .map((zipline) => {
      const color = String(zipline.color || "").toLowerCase();
      const lane = LANE_BY_COLOR[color];
      if (!lane) throw new Error(`unrecognised zipline colour ${zipline.color} -- update LANE_BY_COLOR`);
      // The handles are only needed to build the path; the app never sees them.
      const path = ziplinePath({
        origin: [round(zipline.origin[0], 0), round(zipline.origin[1], 0)],
        p0: handles(zipline.P0_points || []),
        p1: handles(zipline.P1_points || []),
        p2: handles(zipline.P2_points || []),
      });
      return { lane, color: LANE_COLOR[lane], path };
    })
    .sort((a, b) => a.lane - b.lane);
}

/** The API's objective positions as `{ key: [left, top] }` centres. */
function objectiveCentres(positions) {
  const centres = {};
  for (const [key, position] of Object.entries(positions || {})) {
    const match = OBJECTIVE_KEY.exec(key);
    if (!match) throw new Error(`unrecognised objective key ${key} -- update OBJECTIVES`);
    const [, , kind] = match;
    if (!OBJECTIVES[kind]) throw new Error(`no objective entry for ${kind} -- update OBJECTIVES`);
    // `Core` markers are larger, so their centre is further from the top-left corner.
    const [width, height] = kind === "core" ? MARKER_SIZE.core : MARKER_SIZE.icon;
    centres[key] = [
      round((Number(position.left_relative) + width / 2) * 100, 2),
      round((Number(position.top_relative) + height / 2) * 100, 2),
    ];
  }
  return centres;
}

/** The fixture's rows, plus the game build it was extracted from. */
function fixtureRows(tsv) {
  const lines = tsv.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith("build_id"));
  if (header < 0) throw new Error("fixture has no build_id header -- has the format changed?");
  const build = (lines[header].split("\t")[1] || "").trim();
  const rows = lines.slice(header + 1).flatMap((line) => {
    const cells = line.split("\t");
    if (cells.length < 7) return [];
    const [kind, team, slot, objectiveId, x, y] = cells;
    return [{
      kind,
      team: Number(team),
      slot: Number(slot),
      objectiveId: Number(objectiveId),
      x: Number(x),
      y: Number(y),
    }];
  });
  return { build, rows };
}

/**
 * Cross-check the fixture against the API on the tiers both describe. A mismatch
 * means the fixture predates a map rework, so its base guardians would be drawn
 * in the wrong place.
 */
function checkFixtureMatchesApi(fixture, centres) {
  // The API's key suffix is the lane *slot*, which is the fixture's `lane_slot`.
  const suffixByKind = { guardian: "tier1", walker: "tier2", patron: "titan" };

  for (const row of fixture.rows) {
    const prefix = suffixByKind[row.kind];
    if (!prefix) continue;
    const suffix = row.kind === "patron" ? prefix : `${prefix}_${row.slot}`;
    const api = centres[`team${row.team}_${suffix}`];
    if (!api) continue;
    const [left, top] = percent(row.x, row.y);
    if (Math.abs(api[0] - left) > FIXTURE_TOLERANCE_PCT || Math.abs(api[1] - top) > FIXTURE_TOLERANCE_PCT) {
      throw new Error(
        `${row.kind} team${row.team} slot${row.slot}: fixture says ${left},${top} but the API says ` +
          `${api[0]},${api[1]} -- the fixture is from a different map build`,
      );
    }
  }
}

/** Base guardians as `{ key: positions }`: two structures per lane per team. */
function baseGuardians(fixture) {
  const groups = new Map();
  for (const row of fixture.rows) {
    if (row.kind !== "base_guardian") continue;
    if (row.team !== 0 && row.team !== 1) throw new Error(`base guardian with team ${row.team}`);
    if (!SLOT_LANE[row.slot]) throw new Error(`base guardian in unknown lane slot ${row.slot}`);
    if (row.objectiveId !== 11 + row.slot) {
      throw new Error(`base guardian slot ${row.slot} has objective ${row.objectiveId}, expected ${11 + row.slot}`);
    }
    const key = `team${row.team}_base_${row.slot}`;
    groups.set(key, [...(groups.get(key) || []), percent(row.x, row.y)]);
  }
  for (const [key, positions] of groups) {
    if (positions.length !== 2) throw new Error(`${key}: expected 2 base guardians, got ${positions.length}`);
  }
  if (groups.size !== 6) throw new Error(`expected 6 base guardian pairs, got ${groups.size}`);
  return groups;
}

/**
 * Shrines (Titan shield generators) as `{ key, ... }` entries: one per team per outer
 * slot. Unlike the lanes, a team has exactly two, and the game reports them as ids 10
 * and 11 -- "Titan Shield Generator 1" and "... 2". Nothing in the extracted data or
 * in a match says which physical generator is "1", so the slot order is used: the
 * lower slot is generator 1. The two almost always fall together (511 of 527 team
 * pairs in the league's data fall within one match, minutes apart), so the convention
 * is a low-stakes choice rather than a guess that hides a tower.
 */
function shrines(fixture) {
  const entries = [];
  for (const row of fixture.rows) {
    if (row.kind !== "shrine") continue;
    if (row.team !== 0 && row.team !== 1) throw new Error(`shrine with team ${row.team}`);
    if (row.slot !== 1 && row.slot !== 4) throw new Error(`shrine in unexpected lane slot ${row.slot}`);
    entries.push({
      key: `team${row.team}_shrine_${row.slot}`,
      team: row.team,
      objectiveId: row.slot === 1 ? 10 : 11,
      tier: "shrine",
      lane: SLOT_LANE[row.slot],
      positions: [percent(row.x, row.y)],
    });
  }
  if (entries.length !== 4) throw new Error(`expected 4 shrines, got ${entries.length}`);
  return entries;
}

/** Every objective as `{ key, team, objectiveId, tier, lane, positions }`, in draw order. */
function objectives(centres, bases, shrineEntries) {
  const entries = Object.entries(centres).map(([key, positions]) => {
    const [, team, kind] = OBJECTIVE_KEY.exec(key);
    return {
      key,
      team: Number(team),
      objectiveId: OBJECTIVES[kind].objectiveId,
      tier: OBJECTIVES[kind].tier,
      lane: OBJECTIVES[kind].lane,
      positions: [positions],
    };
  });

  for (const [key, positions] of bases) {
    const [, team, slot] = /^team([01])_base_(\d)$/.exec(key);
    entries.push({
      key,
      team: Number(team),
      objectiveId: 11 + Number(slot),
      tier: "base",
      lane: SLOT_LANE[slot],
      positions,
    });
  }

  entries.push(...shrineEntries);

  const order = { tier1: 0, tier2: 1, base: 2, shrine: 3, titan: 4, core: 5 };
  return entries.sort(
    (a, b) => order[a.tier] - order[b.tier] || a.team - b.team || a.key.localeCompare(b.key),
  );
}

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

async function main() {
  const source = await (await fetchOk(MAP_URL)).json();
  if (Number(source.radius) !== MAP_RADIUS) {
    throw new Error(`map radius is ${source.radius}, expected ${MAP_RADIUS} -- check MAP_RADIUS`);
  }

  const lanes = ziplines(source.zipline_paths);
  if (lanes.length !== 3 || lanes.some((lane) => !lane.path)) {
    throw new Error(`expected 3 usable ziplines, got ${lanes.length} -- check ziplinePath`);
  }

  const centres = objectiveCentres(source.objective_positions);
  if (Object.keys(centres).length !== 16) {
    throw new Error(`expected 16 published objectives, got ${Object.keys(centres).length}`);
  }

  const fixture = fixtureRows(await (await fetchOk(BASE_GUARDIAN_URL)).text());
  checkFixtureMatchesApi(fixture, centres);
  const bases = baseGuardians(fixture);
  const shrineEntries = shrines(fixture);

  const data = {
    version: MAP_VERSION,
    source: MAP_URL,
    base_guardian_source: BASE_GUARDIAN_URL,
    base_guardian_build: fixture.build,
    generated_at: new Date().toISOString().slice(0, 10),
    radius: MAP_RADIUS,
    ziplines: lanes,
    objectives: objectives(centres, bases, shrineEntries),
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${lanes.length} ziplines, ` +
      `${data.objectives.length} objectives (${bases.size} base guardian pairs, ` +
      `${shrineEntries.length} shrines, build ${fixture.build})`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
