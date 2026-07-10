import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { cdnImage, staticImagePathToCdn } from "../utils/cdn";

function HeroDetail() {
  const { heroId } = useParams();
  const [heroes, setHeroes] = useState({});
  const [heroStats, setHeroStats] = useState(null);
  const [heroMeta, setHeroMeta] = useState(null);
  const [topPlayers, setTopPlayers] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [effectiveWith, setEffectiveWith] = useState([]);
  const [effectiveAgainst, setEffectiveAgainst] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMorePlayers, setShowMorePlayers] = useState(false);
  const [showMoreItems, setShowMoreItems] = useState(false);
  const [showMoreWith, setShowMoreWith] = useState(false);
  const [showMoreAgainst, setShowMoreAgainst] = useState(false);

  useEffect(() => {
    fetchHeroes();
  }, [heroId]);

  const fetchHeroes = async () => {
    try {
      setLoading(true);
      const [heroesRes, statsRes, metaRes, topPlayersRes, topItemsRes, matchupsRes] = await Promise.all([
        fetch("/db/heroes"),
        fetch(`/db/heroes/${heroId}/stats`),
        fetch(`/db/heroes/${heroId}/meta`),
        fetch(`/db/heroes/${heroId}/top_players`),
        fetch(`/db/heroes/${heroId}/top_items`),
        fetch(`/db/heroes/${heroId}/matchups`),
      ]);
      if (heroesRes.ok) {
        const data = await heroesRes.json();
        setHeroes(data);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setHeroStats(data.stats);
      }
      if (metaRes.ok) {
        const data = await metaRes.json();
        setHeroMeta(data);
      }
      if (topPlayersRes.ok) {
        const data = await topPlayersRes.json();
        setTopPlayers(data.players ?? []);
      }
      if (topItemsRes.ok) {
        const data = await topItemsRes.json();
        setTopItems(data.items ?? []);
      }
      if (matchupsRes.ok) {
        const data = await matchupsRes.json();
        setEffectiveWith(data.effective_with ?? []);
        setEffectiveAgainst(data.effective_against ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch heroes:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl">Loading hero details...</div>
      </div>
    );
  }

  const hero = heroes[heroId];
  const heroName = hero?.name || hero || "Unknown Hero";

  const heroIcon = (hid) => {
    const h = heroes[hid];
    const name = (h?.name || h || "").toLowerCase().replace(/\s+/g, "_");
    return cdnImage(`hero icons/${name}_sm_psd.png`);
  };
  const heroDisplayName = (hid) => {
    const h = heroes[hid];
    return h?.name || h || `Hero ${hid}`;
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-10 p-4 sm:p-8">
      {/* Hero Header */}
      <div className="mb-6 md:mb-8 col-span-1 md:col-span-10 flex flex-col sm:flex-row items-center sm:items-center gap-4 text-center sm:text-left">
        <img
          src={cdnImage(`cardIcons/${heroName.toLowerCase().replace(/&/g, "and").replace(/\s+/g, "_")}_card_psd.png`)}
          alt={heroName}
          className="w-16 h-24 object-cover rounded shadow"
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
        <div>
          <h1 className="text-white text-4xl font-bold">{heroName}</h1>
          <div className="flex gap-2 mt-1 font-valve-pulp">
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium bg-slate-700 text-gray-200 rotate-[4deg]">
              {heroMeta?.tagline?.[0] ?? "—"}
            </span>
            <span className="inline-flex items-center px-3 py-1 mt-1 text-sm font-medium bg-slate-700 text-gray-200 rotate-[-4deg]">
              {heroMeta?.tagline?.[1] ?? "—"}
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium bg-slate-700 text-gray-200 rotate-[4deg]">
              {heroMeta?.tagline?.[2] ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Abilities Section */}
      <div className="mb-6 md:mb-8 col-span-1 md:col-span-4">
        <h2 className="text-white text-center text-xl md:text-2xl font-bold">Abilities</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(heroMeta?.abilities ?? Array(4).fill(null)).map((ability, i) => (
            <div key={i} className="shadow rounded-lg p-3 flex flex-col items-center text-center">
              <div className="relative w-24 h-24">
                <img
                  src={cdnImage("abilities/ability_frame_standard.svg")}
                  alt=""
                  className="absolute inset-0 w-full h-full"
                />
                {ability?.image ? (
                  <img
                    src={staticImagePathToCdn((ability.image.startsWith("/") ? ability.image : `/${ability.image}`).replace(/\\/g, "/"))}
                    alt={ability.name ?? ""}
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2/5 h-2/5 object-contain opacity-75 ${ability.invert ? " invert" : ""}`}
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-xl">
                    {i + 1}
                  </span>
                )}
              </div>
              <h3 className="font-bold text-lg text-gray-200">{ability?.name ?? `Ability ${i + 1}`}</h3>
              <p className="text-sm text-gray-400 mt-1">{ability?.description ?? ""}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hero Stats */}
      <div className="bg-panel text-gray-200 shadow rounded-lg p-4 sm:p-6 col-span-1 md:col-span-6 row-span-2 md:ml-4 mt-4 md:mt-0">
        <h2 className="text-lg sm:text-xl font-bold mb-4">Stats</h2>

        {/* Row 1 — Averages */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Averages
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
            {[
              ["Kills", heroStats?.avg_kills],
              ["Deaths", heroStats?.avg_deaths],
              ["Assists", heroStats?.avg_assists],
              ["KDA", heroStats?.avg_kda],
              ["Damage", heroStats?.avg_damage?.toLocaleString()],
              ["Souls", heroStats?.avg_souls?.toLocaleString()],
            ].map(([label, val]) => (
              <div key={label} className="bg-slate-800 rounded p-2 sm:p-3">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className="text-base sm:text-lg font-bold text-white">{val ?? "-"}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2 — Highest */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Highest
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {[
              ["Kills", heroStats?.max_kills],
              ["Damage", heroStats?.max_damage?.toLocaleString()],
              ["Healing", heroStats?.max_healing?.toLocaleString()],
              ["Obj Damage", heroStats?.max_obj_damage?.toLocaleString()],
            ].map(([label, val]) => (
              <div key={label} className="bg-slate-800 rounded p-2 sm:p-3">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className="text-base sm:text-lg font-bold text-white">{val ?? "-"}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Row 3 — Rates */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Rates
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {[
              ["Win Rate", heroStats?.win_rate != null ? (heroStats.win_rate * 100).toFixed(1) + "%" : "-"],
              ["Pick Rate", heroStats?.pick_rate != null ? (heroStats.pick_rate * 100).toFixed(2) + "%" : "-"],
              ["Games Played", heroStats?.games_played],
              ["Wins", heroStats?.wins, "text-green-400"],
            ].map(([label, val, extraClass]) => (
              <div key={label} className="bg-slate-800 rounded p-2 sm:p-3">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className={`text-base sm:text-lg font-bold text-white ${extraClass || ""}`}>{val ?? "-"}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Most Played By */}
      <div className="bg-panel text-gray-300 shadow rounded-lg p-4 sm:p-6 col-span-1 md:col-span-4">
        <h2 className="text-xl font-bold mb-4">Most Played By</h2>
        {topPlayers.length === 0 ? (
          <p className="text-gray-500 text-sm">No data available.</p>
        ) : (
          <>
            <ol className="space-y-2">
              {(showMorePlayers ? topPlayers : topPlayers.slice(0, 5)).map((p, i) => (
                <li key={p.account_id} className="flex items-center gap-3">
                  <span className="text-gray-500 text-sm w-5 text-right">{i + 1}.</span>
                  <Link
                    to={`/player/${p.account_id}`}
                    className="flex-1 text-blue-400 hover:underline truncate"
                  >
                    {p.persona_name ?? p.account_id}
                  </Link>
                  <span className="text-gray-400 text-sm">{p.games_played}g</span>
                  <span className={`text-sm font-semibold ${p.win_rate >= 0.5 ? "text-green-400" : "text-red-400"}`}>
                    {(p.win_rate * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ol>
            {topPlayers.length > 5 && (
              <button
                onClick={() => setShowMorePlayers((v) => !v)}
                className="mt-3 text-xs text-blue-400 hover:underline"
              >
                {showMorePlayers ? 'Show less' : `Show ${topPlayers.length - 5} more`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Most Bought Items */}
      <div className="bg-panel text-gray-300 shadow rounded-lg p-4 sm:p-6 col-span-1 md:col-span-10 mt-4">
        <h2 className="text-xl font-bold mb-4">Most Bought Items</h2>
        {topItems.length === 0 ? (
          <p className="text-gray-500 text-sm">No item data available.</p>
        ) : (
          <>
          <div className="flex flex-wrap gap-4">
            {(showMoreItems ? topItems : topItems.slice(0, 10)).map((item) => {
              const folder = item.item_tier === 5 ? "legendaries" : item.item_slot_type;
              const imgSrc = folder
                ? cdnImage(`items/${folder}/${item.name.toLowerCase().replace(/ /g, "_")}_psd.png`)
                : null;
              const slotColor =
                item.item_slot_type === "weapon"
                  ? "text-orange-400"
                  : item.item_slot_type === "vitality"
                  ? "text-green-400"
                  : item.item_slot_type === "spirit"
                  ? "text-purple-400"
                  : "text-gray-400";
              return (
                <div
                  key={item.id}
                  className="flex flex-col items-center bg-slate-800 rounded p-3 w-24 text-center"
                  title={item.name}
                >
                  {imgSrc && (
                    <img
                      src={imgSrc}
                      alt={item.name}
                      className="w-12 h-12 object-contain mb-1"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  )}
                  <p className="text-xs text-gray-200 leading-tight truncate w-full">{item.name}</p>
                  <p className={`text-xs font-semibold mt-1 ${slotColor}`}>
                    {(item.pick_rate * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-500">{item.count}×</p>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* Matchups */}
      <div className="col-span-1 md:col-span-10 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Effective With */}
        <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-green-400">Most Effective With</h2>
          {effectiveWith.length === 0 ? (
            <p className="text-gray-500 text-sm">Not enough data.</p>
          ) : (
            <>
              <div className="space-y-2">
                {(showMoreWith ? effectiveWith : effectiveWith.slice(0, 5)).map((h) => (
                  <Link
                    key={h.hero_id}
                    to={`/hero/${h.hero_id}`}
                    className="flex items-center gap-3 hover:bg-slate-700 rounded px-2 py-1 transition-colors"
                  >
                    <img
                      src={heroIcon(h.hero_id)}
                      alt={heroDisplayName(h.hero_id)}
                      className="w-8 h-8 object-cover rounded"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    <span className="flex-1 text-gray-200 text-sm">{heroDisplayName(h.hero_id)}</span>
                    <span className="text-gray-500 text-xs">{h.games}g</span>
                    <span className="text-green-400 text-sm font-semibold">
                      {(h.win_rate * 100).toFixed(0)}%
                    </span>
                  </Link>
                ))}
              </div>
              {effectiveWith.length > 5 && (
                <button
                  onClick={() => setShowMoreWith((v) => !v)}
                  className="mt-3 text-xs text-blue-400 hover:underline"
                >
                  {showMoreWith ? 'Show less' : `Show ${effectiveWith.length - 5} more`}
                </button>
              )}
            </>
          )}
        </div>

        {/* Effective Against */}
        <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-red-400">Most Effective Against</h2>
          {effectiveAgainst.length === 0 ? (
            <p className="text-gray-500 text-sm">Not enough data.</p>
          ) : (
            <>
              <div className="space-y-2">
                {(showMoreAgainst ? effectiveAgainst : effectiveAgainst.slice(0, 5)).map((h) => (
                  <Link
                    key={h.hero_id}
                    to={`/hero/${h.hero_id}`}
                    className="flex items-center gap-3 hover:bg-slate-700 rounded px-2 py-1 transition-colors"
                  >
                    <img
                      src={heroIcon(h.hero_id)}
                      alt={heroDisplayName(h.hero_id)}
                      className="w-8 h-8 object-cover rounded"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    <span className="flex-1 text-gray-200 text-sm">{heroDisplayName(h.hero_id)}</span>
                    <span className="text-gray-500 text-xs">{h.games}g</span>
                    <span className="text-red-400 text-sm font-semibold">
                    {(h.win_rate * 100).toFixed(0)}%
                  </span>
                  </Link>
                ))}
              </div>
              {effectiveAgainst.length > 5 && (
                <button
                  onClick={() => setShowMoreAgainst((v) => !v)}
                  className="mt-3 text-xs text-blue-400 hover:underline"
                >
                  {showMoreAgainst ? 'Show less' : `Show ${effectiveAgainst.length - 5} more`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default HeroDetail;
