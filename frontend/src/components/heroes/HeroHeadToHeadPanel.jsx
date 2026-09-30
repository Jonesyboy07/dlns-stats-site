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
  const aColor = aBetter || tie ? "text-accent-secondary-light" : "text-secondary";
  const bColor = !aBetter || tie ? "text-accent-secondary-light" : "text-secondary";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 border-t border-border py-2 text-[14px] tabular-nums">
      <div className="flex items-center justify-end gap-2.5">
        <span className={`font-bold ${aColor}`}>{aText}</span>
        <div className="flex h-2 flex-none basis-[220px] justify-end overflow-hidden rounded bg-table">
          <div
            className={`h-full rounded ${aBetter ? "bg-accent-secondary" : "bg-hover"}`}
            style={{ width: `${(aNum / max) * 100}%` }}
          />
        </div>
      </div>
      <span className="text-center text-[12px] uppercase tracking-[.05em] text-dim">
        {label}
      </span>
      <div className="flex items-center gap-2.5">
        <div className="h-2 flex-none basis-[220px] overflow-hidden rounded bg-table">
          <div
            className={`h-full rounded ${!aBetter ? "bg-accent-secondary" : "bg-hover"}`}
            style={{ width: `${(bNum / max) * 100}%` }}
          />
        </div>
        <span className={`font-bold ${bColor}`}>{bText}</span>
      </div>
    </div>
  );
}

/**
 * Head-to-Head: this hero vs another, in the same All-time scope. The opponent's
 * figures are fetched on demand, so only the ban rate (which has no data yet) is
 * a placeholder.
 */
function HeroHeadToHeadPanel({ selfId, selfStats, heroOptions = [], selectionById = {}, totalGames }) {
  const others = heroOptions.filter((option) => option.id !== selfId);
  const [opponentId, setOpponentId] = useState(() => others[0]?.id ?? null);
  const [opponentStats, setOpponentStats] = useState(null);

  useEffect(() => {
    if (!opponentId) return undefined;
    let alive = true;
    setOpponentStats(null);
    fetch(`/db/heroes/${opponentId}/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive) setOpponentStats(data?.stats ?? null);
      })
      .catch(() => {
        if (alive) setOpponentStats(null);
      });
    return () => {
      alive = false;
    };
  }, [opponentId]);

  const pickRateOf = (id) => {
    const games = selectionById[String(id)]?.pick_count;
    return games != null && totalGames ? games / totalGames : null;
  };

  const nameById = useMemo(
    () => new Map(heroOptions.map((option) => [option.id, option.name])),
    [heroOptions],
  );

  const opponentName = opponentId ? nameById.get(opponentId) ?? `Hero ${opponentId}` : DASH;

  const rows = [
    {
      label: "Win rate",
      a: selfStats?.win_rate,
      b: opponentStats?.win_rate,
      aText: formatPercent(selfStats?.win_rate),
      bText: formatPercent(opponentStats?.win_rate),
    },
    {
      label: "Pick rate",
      a: pickRateOf(selfId),
      b: pickRateOf(opponentId),
      aText: formatPercent(pickRateOf(selfId)),
      bText: formatPercent(pickRateOf(opponentId)),
    },
    { label: "Ban rate", soon: true },
    {
      label: "Games",
      a: selfStats?.games_played,
      b: opponentStats?.games_played,
      aText: selfStats?.games_played ?? DASH,
      bText: opponentStats?.games_played ?? DASH,
    },
    {
      label: "KDA",
      a: selfStats?.avg_kda,
      b: opponentStats?.avg_kda,
      aText: formatKda(selfStats?.avg_kda) ?? DASH,
      bText: formatKda(opponentStats?.avg_kda) ?? DASH,
    },
    {
      label: "Damage / min",
      a: selfStats?.damage_per_min,
      b: opponentStats?.damage_per_min,
      aText: formatInteger(selfStats?.damage_per_min) ?? DASH,
      bText: formatInteger(opponentStats?.damage_per_min) ?? DASH,
    },
    {
      label: "Souls / min",
      a: selfStats?.souls_per_min,
      b: opponentStats?.souls_per_min,
      aText: formatInteger(selfStats?.souls_per_min) ?? DASH,
      bText: formatInteger(opponentStats?.souls_per_min) ?? DASH,
    },
    {
      label: "Deaths / min",
      a: selfStats?.deaths_per_min,
      b: opponentStats?.deaths_per_min,
      aText: selfStats?.deaths_per_min ?? DASH,
      bText: opponentStats?.deaths_per_min ?? DASH,
      lower: true,
    },
  ];

  return (
    <Panel title="Head-to-Head" subtitle="Compare against another hero in the same scope">
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeroIcon name={nameById.get(selfId)} size="h-11 w-11" />
            <span className="truncate font-valve-oracle text-[20px] text-primary">
              {nameById.get(selfId) ?? "This hero"}
            </span>
          </div>
          <span className="font-valve-pulp text-[18px] text-dim">VS</span>
          <div className="flex min-w-0 items-center justify-end gap-2.5">
            <select
              value={opponentId ?? ""}
              onChange={(event) => setOpponentId(event.target.value)}
              className="min-w-0 flex-0 basis-[190px] rounded-lg border border-border-light bg-input px-3 py-2 text-[13px] text-secondary outline-none focus:border-accent-secondary-border"
            >
              {others.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <HeroIcon name={opponentName} size="h-11 w-11" />
          </div>
        </div>

        <div className="flex flex-col">
          {rows.map((row) =>
            row.soon ? (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 border-t border-border py-2"
              >
                <span className="text-right text-[12px] font-semibold text-dim">
                  Adding Soon
                </span>
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
          Better value in each row is highlighted. Deaths/min: lower is better.
        </span>
      </div>
    </Panel>
  );
}

export default HeroHeadToHeadPanel;
