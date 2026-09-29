import React from "react";
import FormStrip from "./FormStrip";
import TeamLogo from "../TeamLogo";

/**
 * Team identity header: crest, name, the season's headline figures and recent form.
 *
 * Every figure is optional and simply omitted when there is no data — a
 * pre-season entry has no league week and no record to state.
 */
function TeamIdentityCard({
  teamName,
  seriesRecord,
  gameRecord,
  winRate,
  weekRange,
  activePlayers,
  form = [],
}) {
  const meta = [
    seriesRecord && { label: "Series", value: seriesRecord },
    gameRecord && { label: "Games", value: gameRecord },
    winRate && { label: "Win rate", value: winRate, tone: "text-accent-secondary-light" },
  ].filter(Boolean);

  const span =
    weekRange?.first != null && weekRange?.last != null
      ? `First NS ${weekRange.first} \u00b7 Last NS ${weekRange.last}`
      : null;

  return (
    <header className="flex flex-wrap items-center gap-6 rounded-2xl border border-border bg-card px-6 py-5 shadow">
      <TeamLogo
        name={teamName}
        size="h-[112px] w-[96px]"
        rounded="rounded-xl"
        textClass="font-valve-pulp text-[26px]"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h1 className="truncate font-valve-pulp text-[40px] uppercase leading-none tracking-[.01em] text-primary">
          {teamName}
        </h1>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
          {meta.map((item) => (
            <span key={item.label} className="flex gap-1.5 text-muted">
              {item.label}
              <span className={`font-semibold ${item.tone ?? "text-secondary"}`}>
                {item.value}
              </span>
            </span>
          ))}
          {span && <span className="text-muted">{span}</span>}
          {activePlayers != null && (
            <span className="text-muted">
              {activePlayers} active player{activePlayers === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto">
        <FormStrip form={form} />
      </div>
    </header>
  );
}

export default TeamIdentityCard;
