import React, { useEffect, useMemo, useState } from "react";
import Panel from "../player/Panel";
import HeroIcon from "../HeroIcon";
import { formatInteger, formatKda } from "../../utils/format";
import { formatPercent } from "../../utils/heroPages";

const DASH = "—";

/** Mirrored comparison row: the better side of each row is drawn in accent. */
function CompareRow({ label, a, b, aText, bText, lower = false }) {
  const aNum = a ?? 0;
  const bNum = b ?? 0;
  const max = Math.max(aNum, bNum) || 1;
  const tie = aNum === bNum;
  const aBetter = lower ? aNum < bNum : aNum > bNum;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 border-t border-border py-2 text-[14px] tabular-nums">
      <div className="flex items-center justify-end gap-2.5">
        <span className={`font-bold ${aBetter || tie ? "text-accent-secondary-light" : "text-secondary"}`}>
          {aText}
        </span>
        <div className="flex h-2 flex-none basis-[220px] justify-end overflow-hidden rounded bg-table">
          <div
            className={`h-full rounded ${aBetter ? "bg-accent-secondary" : "bg-hover"}`}
            style={{ width: `${(aNum / max) * 100}%` }}
          />
        </div>
      </div>
      <span className="text-center text-[12px] uppercase tracking-[.05em] text-dim">{label}</span>
      <div className="flex items-center gap-2.5">
        <div className="h-2 flex-none basis-[220px] overflow-hidden rounded bg-table">
          <div
            className={`h-full rounded ${!aBetter ? "bg-accent-secondary" : "bg-hover"}`}
            style={{ width: `${(bNum / max) * 100}%` }}
          />
        </div>
        <span className={`font-bold ${!aBetter || tie ? "text-accent-secondary-light" : "text-secondary"}`}>
          {bText}
        </span>
      </div>
    </div>
  );
}

/**
 * Head-to-Head: this hero vs another, in the same scope. Both sides come from the
 * profile's per-hero table, so choosing an opponent needs no extra request.
 * Ban rate has no data yet and is the only placeholder row.
 */
function HeroHeadToHeadPanel({ heroId, heroName, perHero = [] }) {
  const others = useMemo(
    () => perHero.filter((row) => row.hero_id !== heroId).sort((a, b) => a.hero_name.localeCompare(b.hero_name)),
    [perHero, heroId],
  );
  const [opponentId, setOpponentId] = useState(() => others[0]?.hero_id ?? null);

  useEffect(() => {
    if (opponentId == null && others.length > 0) setOpponentId(others[0].hero_id);
  }, [others, opponentId]);

  const self = useMemo(() => perHero.find((row) => row.hero_id === heroId), [perHero, heroId]);
  const opponent = useMemo(
    () => others.find((row) => row.hero_id === opponentId) ?? others[0] ?? null,
    [others, opponentId],
  );

  if (!self || !opponent) {
    return (
      <Panel title="Head-to-Head" subtitle="Compare against another hero in the same scope">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }

  const rows = [
    {
      label: "Win rate",
      a: self.win_rate,
      b: opponent.win_rate,
      aText: formatPercent(self.win_rate),
      bText: formatPercent(opponent.win_rate),
    },
    {
      label: "Pick rate",
      a: self.pick_rate,
      b: opponent.pick_rate,
      aText: formatPercent(self.pick_rate),
      bText: formatPercent(opponent.pick_rate),
    },
    { label: "Ban rate", soon: true },
    {
      label: "Games",
      a: self.games,
      b: opponent.games,
      aText: String(self.games),
      bText: String(opponent.games),
    },
    {
      label: "KDA",
      a: self.kda,
      b: opponent.kda,
      aText: formatKda(self.kda) ?? DASH,
      bText: formatKda(opponent.kda) ?? DASH,
    },
    {
      label: "Damage",
      a: self.damage_per_game,
      b: opponent.damage_per_game,
      aText: formatInteger(self.damage_per_game) ?? DASH,
      bText: formatInteger(opponent.damage_per_game) ?? DASH,
    },
    {
      label: "Souls",
      a: self.souls_per_game,
      b: opponent.souls_per_game,
      aText: formatInteger(self.souls_per_game) ?? DASH,
      bText: formatInteger(opponent.souls_per_game) ?? DASH,
    },
    {
      label: "Deaths",
      a: self.deaths_per_game,
      b: opponent.deaths_per_game,
      aText: self.deaths_per_game == null ? DASH : self.deaths_per_game.toFixed(1),
      bText: opponent.deaths_per_game == null ? DASH : opponent.deaths_per_game.toFixed(1),
      lower: true,
    },
  ];

  return (
    <Panel title="Head-to-Head" subtitle="Compare against another hero in the same scope">
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeroIcon name={heroName} size="h-11 w-11" />
            <span className="truncate font-valve-oracle text-[20px] text-primary">{heroName}</span>
          </div>
          <span className="font-valve-pulp text-[18px] text-dim">VS</span>
          <div className="flex min-w-0 items-center justify-end gap-2.5">
            <select
              value={opponent.hero_id}
              onChange={(event) => setOpponentId(Number(event.target.value))}
              className="min-w-0 flex-none basis-[190px] rounded-lg border border-border-light bg-input px-3 py-2 text-[13px] text-secondary outline-none focus:border-accent-secondary-border"
            >
              {others.map((option) => (
                <option key={option.hero_id} value={option.hero_id} className="bg-table text-secondary">
                  {option.hero_name}
                </option>
              ))}
            </select>
            <HeroIcon name={opponent.hero_name} size="h-11 w-11" />
          </div>
        </div>

        <div className="flex flex-col">
          {rows.map((row) =>
            row.soon ? (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 border-t border-border py-2"
              >
                <span className="text-right text-[12px] font-semibold text-dim">Adding Soon</span>
                <span className="text-center text-[12px] uppercase tracking-[.05em] text-dim">
                  {row.label}
                </span>
                <span className="text-[12px] font-semibold text-dim">Adding Soon</span>
              </div>
            ) : (
              <CompareRow key={row.label} {...row} />
            ),
          )}
        </div>

        <span className="text-[12px] text-dim">
          Better value in each row is highlighted. Deaths: lower is better.
        </span>
      </div>
    </Panel>
  );
}

export default HeroHeadToHeadPanel;
