import React from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import SteamAvatar from "./SteamAvatar";
import {
  formatDuration,
  formatDurationDelta,
  formatKda,
  formatRecord,
} from "../../utils/format";
import { DASH } from "../../utils/team";

/** Header and rows share this template so the labels sit over their columns. */
const ROSTER_GRID = "grid grid-cols-[minmax(140px,1fr)_auto] items-center gap-4";

/** One roster row: avatar, games + KDA, then the player's signature heroes. */
function RosterRow({ player }) {
  const games = player.appearances ?? 0;
  const kda = formatKda(player.kda);
  const heroes = (player.signature_heroes ?? []).slice(0, 3);

  return (
    <Link
      to={`/player/${player.account_id}`}
      className={`${ROSTER_GRID} border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-hover`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <SteamAvatar player={player} size="h-7 w-7" rounded="rounded" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold text-accent-secondary-light">
            {player.persona_name || `Player ${player.account_id}`}
          </span>
          <span className="whitespace-nowrap text-[12px] tabular-nums text-dim">
            {games} GP{kda ? ` · ${kda} KDA` : ""}
          </span>
        </span>
      </span>

      <span className="flex justify-end gap-1">
        {heroes.length === 0 ? (
          <span className="text-[12px] text-dim">None yet</span>
        ) : (
          heroes.map((hero) => (
            <HeroIcon key={hero.hero_id} name={hero.hero_name} size="h-8 w-8" />
          ))
        )}
      </span>
    </Link>
  );
}

/** Average game length against the whole Night Shift series, plus the longest win. */
function HowTheyWin({ durations }) {
  const avg = formatDuration(durations?.avg_s);
  const baseline = formatDuration(durations?.baseline_avg_s);
  const delta = durations?.delta_s;
  const deltaLabel = formatDurationDelta(delta);

  let pace = "No baseline available";
  let paceClass = "text-dim";
  if (deltaLabel) {
    if (delta > 0) {
      pace = `${deltaLabel} faster than avg`;
      paceClass = "text-accent-secondary-light";
    } else if (delta < 0) {
      pace = `${deltaLabel} slower than avg`;
      paceClass = "text-muted";
    } else {
      pace = "Right on the avg";
    }
  }

  const longest = durations?.longest_win;

  return (
    <SectionCard
      title="How They Win"
      subtitle={baseline ? `Night Shift avg ${baseline}` : null}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-xl border border-accent-secondary-border bg-card p-4">
          <span className="text-[12px] uppercase tracking-[.05em] text-muted">Avg game</span>
          <span className="font-valve-oracle text-[28px] font-semibold leading-none text-primary">
            {avg ?? DASH}
          </span>
          <span className={`text-[13px] ${paceClass}`}>{pace}</span>
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-border-light bg-card p-4">
          <span className="text-[12px] uppercase tracking-[.05em] text-muted">Longest win</span>
          <span className="font-valve-oracle text-[28px] font-semibold leading-none text-primary">
            {formatDuration(longest?.duration_s) ?? DASH}
          </span>
          <span className="truncate text-[13px] text-dim">
            {longest ? `vs ${longest.opponent}` : "No wins yet"}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

/** Win/loss split for each game-length bracket. */
function ResultByLength({ buckets = [] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.games, 0);

  if (total === 0) {
    return <p className="text-[13px] text-dim">No completed games yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {buckets.map((bucket) => {
        const decided = bucket.wins + bucket.losses || 1;
        return (
          <div
            key={bucket.label}
            className="flex items-center gap-3"
            title={`${bucket.label}: ${formatRecord(bucket.wins, bucket.losses)} in ${bucket.games} game${bucket.games === 1 ? "" : "s"}`}
          >
            <span className="w-20 shrink-0 text-[13px] text-muted">{bucket.label}</span>
            <span className="flex h-2.5 min-w-0 flex-1 gap-[2px] overflow-hidden rounded-full bg-input">
              <span
                className="bg-success"
                style={{ width: `${(bucket.wins / decided) * 100}%` }}
              />
              <span
                className="bg-danger"
                style={{ width: `${(bucket.losses / decided) * 100}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-secondary">
              {formatRecord(bucket.wins, bucket.losses)}
            </span>
          </div>
        );
      })}

      <div className="flex gap-4 pt-1 text-[12px] text-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] bg-success" aria-hidden="true" />
          Wins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] bg-danger" aria-hidden="true" />
          Losses
        </span>
      </div>
    </div>
  );
}

/** Most-picked heroes: bar = pick share, colour = winning or losing record. */
function HeroPool({ heroPicks = [] }) {
  const heroes = heroPicks.slice(0, 5);

  if (heroes.length === 0) {
    return <p className="text-[13px] text-dim">No hero picks yet.</p>;
  }

  const maxPicks = Math.max(...heroes.map((hero) => hero.picks), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {heroes.map((hero) => {
        const losing = hero.win_rate != null && hero.win_rate < 50;
        return (
          <Link
            key={hero.hero_id}
            to={`/hero/${hero.hero_id}`}
            className="group flex items-center gap-3 text-secondary transition-colors hover:text-accent-secondary-light"
          >
            <HeroIcon name={hero.hero_name} size="h-8 w-8" />
            <span className="w-24 shrink-0 truncate text-[14px]">{hero.hero_name}</span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-input">
              {/* The accent gradient is a `background` value, not a colour, so it
                  cannot go through `bg-*` — that would emit an invalid
                  background-color and the bar would come out empty. */}
              <span
                className={`block h-full rounded-full ${
                  losing ? "bg-danger" : "[background:var(--color-accent-secondary-gradient)]"
                }`}
                style={{ width: `${(hero.picks / maxPicks) * 100}%` }}
              />
            </span>
            <span className="w-[88px] shrink-0 text-right text-[13px] text-muted">
              {hero.picks}p
              {hero.win_rate != null ? ` · ${hero.win_rate}%` : ""}
            </span>
          </Link>
        );
      })}

      <div className="flex gap-4 pt-1 text-[12px] text-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] bg-accent-secondary" aria-hidden="true" />
          Winning record
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] bg-danger" aria-hidden="true" />
          Below 50%
        </span>
      </div>
    </div>
  );
}

function TeamOverviewTab({ players = [], maxWeek, durations, heroPicks }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="min-w-0 flex-[2_1_380px]">
        <SectionCard
          title="Roster"
          subtitle={maxWeek != null ? `NS ${maxWeek} · active players` : "active players"}
        >
          {players.length === 0 ? (
            <p className="text-[13px] text-dim">No roster data available.</p>
          ) : (
            <div className="-mx-2 flex flex-col">
              <div
                className={`${ROSTER_GRID} border-b border-border px-4 pb-2.5 text-[12px] uppercase tracking-[.05em] text-muted`}
              >
                <span>Player</span>
                <span className="min-w-[104px] text-right">Signature heroes</span>
              </div>
              {players.map((player) => (
                <RosterRow key={player.account_id} player={player} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-6">
        <HowTheyWin durations={durations} />

        <SectionCard title="Result by Game Length" subtitle="wins vs losses per bracket">
          <ResultByLength buckets={durations?.buckets} />
        </SectionCard>

        <SectionCard title="Hero Pool" subtitle="pick share + win rate">
          <HeroPool heroPicks={heroPicks} />
        </SectionCard>
      </div>
    </div>
  );
}

export default TeamOverviewTab;
