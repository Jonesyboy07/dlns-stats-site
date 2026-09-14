import React, { useState } from "react";
import { Link } from "react-router-dom";
import DivisionBar from "../DivisionBar";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import {
  formatDuration,
  formatDurationDelta,
  formatKda,
  formatRecord,
} from "../../utils/format";

const ROW = "flex items-center gap-3 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2";

function PlayerAvatar({ player }) {
  const [failed, setFailed] = useState(false);

  if (player.avatar_url && !failed) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-full border border-gray-700 object-cover"
      />
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-gray-400">
      {(player.persona_name || "?")[0].toUpperCase()}
    </span>
  );
}

/** One roster row: avatar, games + KDA, then the player's signature heroes. */
function RosterRow({ player }) {
  const games = player.appearances ?? 0;
  const kda = formatKda(player.kda);
  const heroes = player.signature_heroes ?? [];

  return (
    <Link
      to={`/player/${player.account_id}`}
      className={`${ROW} transition-colors hover:border-purple-500/50 hover:bg-gray-700/40`}
    >
      <PlayerAvatar player={player} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">
          {player.persona_name || `Player ${player.account_id}`}
        </p>
        <p className="whitespace-nowrap text-xs text-gray-500">
          {games} game{games === 1 ? "" : "s"}
          {kda ? ` \u00b7 ${kda} KDA` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {heroes.length === 0 ? (
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            None yet
          </span>
        ) : (
          heroes.map((hero) => (
            <HeroIcon key={hero.hero_id} name={hero.hero_name} size="h-8 w-8" />
          ))
        )}
      </div>
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
  let paceClass = "text-gray-500";
  if (deltaLabel) {
    if (delta > 0) {
      pace = `${deltaLabel} faster than avg`;
      paceClass = "text-purple-400";
    } else if (delta < 0) {
      pace = `${deltaLabel} slower than avg`;
      paceClass = "text-gray-400";
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
        <div className="rounded-lg border border-gray-700/60 bg-gray-800/40 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Avg game
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{avg ?? "\u2014"}</p>
          <p className={`mt-0.5 text-xs ${paceClass}`}>{pace}</p>
        </div>

        <div className="rounded-lg border border-gray-700/60 bg-gray-800/40 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Longest
          </p>
          <p className="mt-1 text-2xl font-bold text-white">
            {formatDuration(longest?.duration_s) ?? "\u2014"}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {longest ? `vs ${longest.opponent}` : "No wins yet"}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

/** Win/loss split for each game-length bracket. */
function ResultByLength({ buckets = [] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.games, 0);

  if (total === 0) {
    return <p className="text-sm text-gray-600">No completed games yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-gray-400">
            {bucket.label}
          </span>
          <div className="min-w-0 flex-1">
            <DivisionBar
              wins={bucket.wins}
              losses={bucket.losses}
              title={`${bucket.label}: ${formatRecord(bucket.wins, bucket.losses)} in ${bucket.games} game${bucket.games === 1 ? "" : "s"}`}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs text-gray-400">
            {formatRecord(bucket.wins, bucket.losses)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Most-picked heroes: bar = pick share, colour = winning or losing record. */
function HeroPool({ heroPicks = [] }) {
  const heroes = heroPicks.slice(0, 5);

  if (heroes.length === 0) {
    return <p className="text-sm text-gray-600">No hero picks yet.</p>;
  }

  const maxPicks = Math.max(...heroes.map((hero) => hero.picks), 1);

  return (
    <div className="space-y-2">
      {heroes.map((hero) => {
        const losing = hero.win_rate != null && hero.win_rate < 50;
        return (
          <Link
            key={hero.hero_id}
            to={`/hero/${hero.hero_id}`}
            className="group flex items-center gap-3"
          >
            <HeroIcon name={hero.hero_name} size="h-8 w-8" />
            <span className="w-24 shrink-0 truncate text-sm text-gray-200 group-hover:text-purple-300">
              {hero.hero_name}
            </span>
            <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-700/70">
              <div
                className={`h-full rounded-full ${losing ? "bg-red-500" : "bg-purple-500"}`}
                style={{ width: `${(hero.picks / maxPicks) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs text-gray-300">
              {hero.picks}p
              {hero.win_rate != null ? ` \u00b7 ${hero.win_rate}%` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function TeamOverviewTab({ players = [], maxWeek, durations, heroPicks }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
      <SectionCard
        title="Roster"
        subtitle={maxWeek != null ? `WK ${maxWeek}` : null}
        action={
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            Signature heroes
          </span>
        }
        className="lg:col-span-2"
      >
        {players.length === 0 ? (
          <p className="text-sm text-gray-600">No roster data available.</p>
        ) : (
          <div className="space-y-2">
            {players.map((player) => (
              <RosterRow key={player.account_id} player={player} />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="space-y-6 lg:col-span-3">
        <HowTheyWin durations={durations} />

        <SectionCard title="Result by Game Length">
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
