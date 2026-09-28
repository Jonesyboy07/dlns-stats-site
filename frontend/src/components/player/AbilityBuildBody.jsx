import React, { useState } from "react";
import { cdnImage } from "../../utils/cdn";
import ScoreChip from "./ScoreChip";
import SegmentedControl from "./SegmentedControl";
import { formatPercent } from "../../utils/format";

/**
 * The 16 points a level-16 game spends: four unlocks plus the 1/2/5 AP upgrades.
 * The grid is always 16 columns wide so builds of different lengths line up.
 */
const STEPS = 16;
const AP_COST = { 1: 1, 2: 2, 3: 5 };

/** Ability icon, falling back to a dashed box with the slot number. */
function AbilityIcon({ ability }) {
  const [failed, setFailed] = useState(false);
  if (!ability.icon || failed) {
    return (
      <span
        title={`${ability.name} — icon missing`}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-dashed border-border-lighter text-[10px] font-bold text-dim"
      >
        {ability.slot}
      </span>
    );
  }
  return (
    <img
      src={cdnImage(ability.icon)}
      alt={ability.name}
      title={ability.name}
      onError={() => setFailed(true)}
      className="h-[26px] w-[26px] shrink-0 rounded-md border border-border object-cover"
    />
  );
}

const UnlockChip = () => (
  <span className="flex h-6 w-[26px] items-center justify-center rounded-md border border-accent-secondary-border bg-accent-secondary-bg-strong">
    <span
      aria-hidden="true"
      className="h-2 w-2 rotate-45 rounded-[1px] bg-accent-secondary-light"
    />
  </span>
);

const UpgradeChip = ({ cost = 1 }) => (
  <span className="flex h-6 items-center gap-1 rounded-md border border-border-light bg-input px-1.5 text-[12px] font-bold tabular-nums text-primary">
    <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 rounded-[1px] bg-muted" />
    {cost}
  </span>
);

/**
 * The ability point order on this hero, as up to three builds.
 *
 * Builds are grouped by the ORDER THE FOUR ABILITIES ARE UNLOCKED — the later
 * upgrades vary too much per game to cluster (measured: a 20-game player produced
 * 18 distinct full orders but only 6 distinct unlock orders). The grid shows each
 * build's most common full order, and every figure is the group's real one, so
 * nothing here implies a consistency the data does not have.
 */
export default function AbilityBuildBody({ builds, heroName }) {
  const [selected, setSelected] = useState(0);
  const list = builds?.builds ?? [];
  const abilities = builds?.abilities ?? [];
  const games = builds?.games ?? 0;
  const active = list[Math.min(selected, Math.max(0, list.length - 1))];

  if (list.length === 0 || abilities.length === 0) {
    return (
      <p className="text-[12px] text-dim">
        No ability order recorded on {heroName} yet.
      </p>
    );
  }

  const options = list.map((build, index) => ({
    id: index,
    label: `Build ${index + 1}`,
    note: build.share == null ? null : formatPercent(build.share * 100),
    title: `Opens ${build.unlock_order.join(" → ")} · ${build.games} of ${games} games`,
  }));

  return (
    <div className="flex flex-col gap-3.5">
      <SegmentedControl
        options={options}
        value={selected}
        onChange={setSelected}
        label="Ability build"
        className="self-start"
      />

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] text-muted">
        <span>
          <b className="text-primary">{active.games}</b> of {games} games ·{" "}
          <b className="text-primary">
            {active.share == null ? "—" : formatPercent(active.share * 100)}
          </b>
        </span>
        <span className="flex items-baseline gap-1.5">
          <ScoreChip
            wins={active.wins}
            losses={active.losses}
            className="text-[13px]"
            title={`${active.wins}–${active.losses} on this build`}
          />
          <span>
            {active.win_rate == null ? "—" : formatPercent(active.win_rate * 100)} win rate
          </span>
        </span>
        <span>
          Opens:{" "}
          <span className="text-secondary">{active.unlock_order.join(" → ")}</span>
        </span>
        <span>
          Max order:{" "}
          <span className="text-secondary">
            {active.max_order.length > 0 ? active.max_order.join(" → ") : "—"}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div
          className="grid gap-[3px] px-1 text-center text-[10px] text-dim"
          style={{ gridTemplateColumns: `120px repeat(${STEPS}, minmax(0, 1fr))` }}
        >
          <span className="text-left uppercase tracking-[.06em]">Step</span>
          {Array.from({ length: STEPS }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>

        {abilities.map((ability) => (
          <div
            key={ability.slot}
            className="grid items-center gap-[3px] rounded-lg bg-table p-1"
            style={{ gridTemplateColumns: `120px repeat(${STEPS}, minmax(0, 1fr))` }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <AbilityIcon ability={ability} />
              <span className="truncate text-[12px] text-primary" title={ability.name}>
                {ability.name}
              </span>
            </span>

            {Array.from({ length: STEPS }, (_, index) => {
              const step = active.steps?.[index];
              const applies = step && step[0] === ability.slot;
              const tier = applies ? step[1] : null;
              return (
                <span
                  key={index}
                  className="flex min-w-0 justify-center"
                  title={
                    applies
                      ? `Step ${index + 1}: ${tier === 0 ? "unlock" : `upgrade (${AP_COST[tier] ?? 1} AP)`} ${ability.name}`
                      : undefined
                  }
                >
                  {applies &&
                    (tier === 0 ? <UnlockChip /> : <UpgradeChip cost={AP_COST[tier] ?? 1} />)}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <UnlockChip />
          Unlock
        </span>
        <span className="flex items-center gap-1.5">
          <UpgradeChip cost={1} />
          Upgrade · number = AP cost (1 / 2 / 5)
        </span>
        <span className="ml-auto text-[11px] text-dim">
          {builds.other_games} game{builds.other_games === 1 ? "" : "s"} used other
          order{builds.other_games === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
