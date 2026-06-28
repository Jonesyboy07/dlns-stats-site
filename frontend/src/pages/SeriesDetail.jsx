import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { cdnImage } from "../utils/cdn";
import LoadingSkeleton from "../components/LoadingSkeleton";

function SeriesDetail() {
  const { matchId } = useParams();
  const [series, setSeries] = useState(null);
  const [heroes, setHeroes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHeroes();
    fetchSeries();
  }, [matchId]);

  const fetchHeroes = async () => {
    try {
      const res = await fetch("/db/heroes");
      if (res.ok) setHeroes(await res.json());
    } catch (e) {
      console.error("Failed to fetch heroes:", e);
    }
  };

  const fetchSeries = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/db/series/${matchId}`);
      if (!res.ok) throw new Error("Series not found");
      setSeries(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getHeroName = (heroId) => {
    const hero = heroes[heroId];
    return hero?.name || hero || `Hero ${heroId}`;
  };

  const getHeroIcon = (heroId) => {
    const name = getHeroName(heroId).toLowerCase().replace(/\s+/g, "_");
    return cdnImage(`hero icons/${name}_sm_psd.png`);
  };

  const formatDuration = (s) => {
    if (!s) return "";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  if (loading)
    return <LoadingSkeleton variant="text" />;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;
  if (!series) return null;

  const { event_title, event_week, event_team_a, event_team_b, matches } =
    series;

  // Series score: count wins per event team using team_a_ingame_side
  let wins_a = 0, wins_b = 0;
  for (const m of matches) {
    const side = m.event_team_a_ingame_side; // 0 = team_a is Amber, 1 = team_a is Sapphire
    if (side === null || side === undefined) continue;
    if (m.winning_team === side) wins_a++;
    else wins_b++;
  }
  const hasScore = matches.some((m) => m.event_team_a_ingame_side != null);



  return (
    <div className="w-full px-4 py-8">
      {/* Back link */}
      <Link
        to="/"
        className="text-blue-500 hover:underline text-sm mb-6 inline-block"
      >
        ← Back to Matches
      </Link>

      {/* Series header */}
      <div className="mb-8">
        {event_title && (
          <p className="text-gray-500 text-sm mb-1">
            {event_title}
            {event_week != null && ` · Week ${event_week}`}
          </p>
        )}
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-bold ${hasScore && wins_a > wins_b ? "text-green-300" : "text-gray-200"}`}>{event_team_a}</span>
          {hasScore
            ? <span className="text-gray-400 text-xl font-semibold">{wins_a} – {wins_b}</span>
            : <span className="text-gray-500 text-lg font-light">vs</span>
          }
          <span className={`text-2xl font-bold ${hasScore && wins_b > wins_a ? "text-green-300" : "text-gray-200"}`}>{event_team_b}</span>
          <span className="text-gray-500 text-sm ml-2">{matches.length} game{matches.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Games */}
      <div className="flex flex-col gap-6">
        {matches.map((match) => {
          const side = match.event_team_a_ingame_side; // 0 = team_a is Amber, 1 = team_a is Sapphire
          const hasSide = side != null;
          // team_a's in-game players: if side=0, they're team 0 (Amber); if side=1, they're team 1 (Sapphire)
          const teamAPlayers = hasSide ? match.players.filter((p) => p.team === side) : [];
          const teamBPlayers = hasSide ? match.players.filter((p) => p.team !== side) : [];
          const teamASide = hasSide ? (side === 0 ? "Amber" : "Sapphire") : null;
          const teamBSide = hasSide ? (side === 0 ? "Sapphire" : "Amber") : null;
          const amberPlayers = match.players.filter((p) => p.team === 0);
          const sapphirePlayers = match.players.filter((p) => p.team === 1);
          const winningTeam = match.winning_team ?? null;
          const teamAWon = hasSide ? winningTeam === side : null;
          const teamBWon = hasSide ? winningTeam !== side && winningTeam != null : null;

          const isPlaceholder = match.match_id < 0;

          if (isPlaceholder) {
            const placeholderSide = match.event_team_a_ingame_side ?? 0;
            const placeholderWinner =
              match.winning_team === placeholderSide ? event_team_a : event_team_b;
            return (
              <div
                key={match.match_id}
                className="bg-gray-800/30 border border-dashed border-gray-600/50 rounded-lg overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/40 bg-gray-900/30">
                  <div className="flex flex-col">
                    <span className="text-gray-500 text-xs italic">No match data recorded</span>
                    <span className="text-gray-600 font-semibold text-sm">{match.event_game}</span>
                  </div>
                  {match.match_vod && (
                    <a href={match.match_vod} target="_blank" rel="noopener noreferrer"
                       className="text-purple-400 hover:underline text-xs">
                      Watch VOD ↗
                    </a>
                  )}
                </div>
                <div className="px-4 py-6 text-center text-gray-500 text-sm">
                  <p className="text-gray-400">
                    Winner: <span className="font-semibold text-green-400">{placeholderWinner}</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-600 italic">
                    Match was not recorded by game servers
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div
              key={match.match_id}
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden"
            >
              {/* Game header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/50 bg-gray-900/50">
                <div className="flex flex-col">
                  <h2 className="text-gray-300 text-md">{match.match_id}</h2>
                  <span className="text-gray-600 font-semibold text-sm">
                    {match.event_game}
                  </span>
                </div>
                {match.duration_s && (
                  <span className="text-gray-300 text-md">
                    {formatDuration(match.duration_s)}
                  </span>
                )}
                <Link
                  to={`/match/${match.match_id}`}
                  className="text-blue-400 hover:underline text-xs"
                >
                  Full details →
                </Link>
                {match.match_vod && (
                  <a
                    href={match.match_vod}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:underline text-xs"
                  >
                    Watch VOD ↗
                  </a>
                )}
              </div>

              {/* Teams side by side */}
              <div className="grid grid-cols-2 divide-x divide-gray-700/50">
                {hasSide ? (
                  <>
                    <TeamColumn
                      teamName={event_team_a}
                      sideLabel={teamASide}
                      players={teamAPlayers}
                      won={teamAWon}
                      side={side === 0 ? "a" : "b"}
                      getHeroName={getHeroName}
                      getHeroIcon={getHeroIcon}
                    />
                    <TeamColumn
                      teamName={event_team_b}
                      sideLabel={teamBSide}
                      players={teamBPlayers}
                      won={teamBWon}
                      side={side === 0 ? "b" : "a"}
                      getHeroName={getHeroName}
                      getHeroIcon={getHeroIcon}
                    />
                  </>
                ) : (
                  <>
                    <TeamColumn
                      teamName="Amber"
                      sideLabel="Amber"
                      players={amberPlayers}
                      won={winningTeam === 0}
                      side="a"
                      getHeroName={getHeroName}
                      getHeroIcon={getHeroIcon}
                    />
                    <TeamColumn
                      teamName="Sapphire"
                      sideLabel="Sapphire"
                      players={sapphirePlayers}
                      won={winningTeam === 1}
                      side="b"
                      getHeroName={getHeroName}
                      getHeroIcon={getHeroIcon}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamColumn({
  teamName,
  sideLabel,
  players,
  won,
  side,
  getHeroName,
  getHeroIcon,
}) {
  return (
    <div
      className={`p-4 ${won ? (side === "a" ? "bg-amber-900/10" : "bg-blue-900/10") : ""}`}
    >
      {/* Team name + side badge + win badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-sm text-gray-200">{teamName}</span>
        {sideLabel && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            sideLabel === "Amber"
              ? "bg-amber-900/50 text-amber-300"
              : "bg-blue-900/50 text-blue-300"
          }`}>{sideLabel}</span>
        )}
        {won && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-700/60 text-green-300">
            WIN
          </span>
        )}
      </div>

      {/* Players */}
      <div className="flex flex-col gap-2">
        {players.map((player, i) => (
          <div key={i} className="flex items-center gap-2">
            {player.hero_id ? (
              <Link
                to={`/hero/${player.hero_id}`}
                title={getHeroName(player.hero_id)}
              >
                <img
                  src={getHeroIcon(player.hero_id)}
                  alt={getHeroName(player.hero_id)}
                  className="w-7 h-7 rounded object-cover bg-gray-700"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              </Link>
            ) : (
              <div className="w-7 h-7 rounded bg-gray-700" />
            )}
            <div className="min-w-0">
              {player.account_id ? (
                <Link
                  to={`/player/${player.account_id}`}
                  className="text-gray-200 text-sm hover:underline truncate block"
                  title={player.persona_name || "Anonymous"}
                >
                  {player.persona_name || "Anonymous"}
                </Link>
              ) : (
                <span className="text-gray-200 text-sm truncate block">
                  {player.persona_name || "Anonymous"}
                </span>
              )}
              <span className="text-gray-500 text-xs">
                {getHeroName(player.hero_id)}
              </span>
            </div>
            <span className="ml-auto text-xs text-gray-400 shrink-0">
              {player.kills}/{player.deaths}/{player.assists}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SeriesDetail;
