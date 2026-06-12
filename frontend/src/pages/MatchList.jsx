import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

// Helper to get hero icon path
// Filenames are lowercase, underscores, & → and (e.g. "Mo & Krill" → "mo_and_krill_sm_psd.png")
const getHeroIcon = (heroName) => {
  if (!heroName) return null;
  const filename = heroName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, "_");
  return `/static/images/hero icons/${filename}_sm_psd.png`;
};

function MatchList() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [weekMap, setWeekMap] = useState({});
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [weekOptions, setWeekOptions] = useState([]);
  const [weekFilter, setWeekFilter] = useState("");
  const perPage = 20;

  // Hero filter state
  const [heroSearch, setHeroSearch] = useState("");
  const [heroFilter, setHeroFilter] = useState("");
  const [heroSuggestions, setHeroSuggestions] = useState([]);
  const [showHeroDropdown, setShowHeroDropdown] = useState(false);
  const [heroHighlight, setHeroHighlight] = useState(-1);
  const [allHeroes, setAllHeroes] = useState([]);
  const heroRef = useRef(null);

  // Player filter state
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [playerSuggestions, setPlayerSuggestions] = useState([]);
  const [showPlayerDropdown, setShowPlayerDropdown] = useState(false);
  const [playerHighlight, setPlayerHighlight] = useState(-1);
  const [allPlayers, setAllPlayers] = useState([]);
  const playerRef = useRef(null);

  // Load available series list from matches.json-derived API
  useEffect(() => {
    fetch("/db/weeks")
      .then((r) => r.json())
      .then((data) => {
        setSeriesOptions(Array.isArray(data.series_titles) ? data.series_titles : []);
      })
      .catch(() => {});
  }, []);

  // Load week map and week options for the selected series
  useEffect(() => {
    const url = seriesFilter
      ? `/db/weeks?event_title=${encodeURIComponent(seriesFilter)}`
      : "/db/weeks";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setWeekMap(data.weeks || {});

        const weeks = new Set();
        for (const entry of Object.values(data.details || {})) {
          if (entry?.week != null) {
            weeks.add(entry.week);
          }
        }
        const sortedWeeks = Array.from(weeks).sort((a, b) => Number(b) - Number(a));
        setWeekOptions(sortedWeeks);
        if (weekFilter && !sortedWeeks.includes(Number(weekFilter))) {
          setWeekFilter("");
        }
      })
      .catch(() => {
        setWeekMap({});
        setWeekOptions([]);
      });
  }, [seriesFilter]);

  // Load hero and player lists for autocomplete
  useEffect(() => {
    fetch("/db/heroes")
      .then((r) => r.json())
      .then((data) => {
        const heroes = Object.entries(data).map(([id, name]) => ({ id, name }));
        setAllHeroes(heroes);
      })
      .catch(() => {});
    fetch("/db/players")
      .then((r) => r.json())
      .then((data) => {
        setAllPlayers(
          (data.players || []).map((p) => p.persona_name).filter(Boolean),
        );
      })
      .catch(() => {});
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (heroRef.current && !heroRef.current.contains(e.target))
        setShowHeroDropdown(false);
      if (playerRef.current && !playerRef.current.contains(e.target))
        setShowPlayerDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    fetchMatches();
  }, [page, heroFilter, playerFilter, seriesFilter, weekFilter]);

  // Update hero suggestions
  useEffect(() => {
    if (!showHeroDropdown) {
      setHeroSuggestions([]);
      return;
    }
    const q = heroSearch.toLowerCase();
    setHeroSuggestions(
      allHeroes.filter((h) => !q || h.name.toLowerCase().includes(q)),
    );
    setHeroHighlight(-1);
  }, [heroSearch, allHeroes, showHeroDropdown]);

  // Update player suggestions
  useEffect(() => {
    if (!showPlayerDropdown) {
      setPlayerSuggestions([]);
      return;
    }
    const q = playerSearch.toLowerCase();
    setPlayerSuggestions(
      allPlayers.filter((p) => !q || p.toLowerCase().includes(q)),
    );
    setPlayerHighlight(-1);
  }, [playerSearch, allPlayers, showPlayerDropdown]);

  const fetchMatches = async () => {
    try {
      setLoading(true);
      let url = `/db/matches/latest/paged?page=${page}&per_page=${perPage}`;
      if (heroFilter) url += `&hero=${encodeURIComponent(heroFilter)}`;
      if (playerFilter) url += `&player=${encodeURIComponent(playerFilter)}`;
      if (seriesFilter) url += `&event_title=${encodeURIComponent(seriesFilter)}`;
      if (weekFilter) url += `&event_week=${encodeURIComponent(weekFilter)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch matches");
      const data = await response.json();
      setMatches(data.matches || []);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectHero = (name) => {
    setHeroSearch(name);
    setHeroFilter(name);
    setShowHeroDropdown(false);
    setPage(1);
  };
  const clearHero = () => {
    setHeroSearch("");
    setHeroFilter("");
    setShowHeroDropdown(false);
    setPage(1);
  };
  const selectPlayer = (name) => {
    setPlayerSearch(name);
    setPlayerFilter(name);
    setShowPlayerDropdown(false);
    setPage(1);
  };
  const clearPlayer = () => {
    setPlayerSearch("");
    setPlayerFilter("");
    setShowPlayerDropdown(false);
    setPage(1);
  };
  const clearSeries = () => {
    setSeriesFilter("");
    setWeekFilter("");
    setPage(1);
  };
  const clearWeek = () => {
    setWeekFilter("");
    setPage(1);
  };

  const handleHeroKey = (e) => {
    if (!showHeroDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHeroHighlight((i) => Math.min(i + 1, heroSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHeroHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && heroHighlight >= 0) {
      e.preventDefault();
      selectHero(heroSuggestions[heroHighlight].name);
    } else if (e.key === "Escape") {
      setShowHeroDropdown(false);
    }
  };
  const handlePlayerKey = (e) => {
    if (!showPlayerDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPlayerHighlight((i) => Math.min(i + 1, playerSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPlayerHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && playerHighlight >= 0) {
      e.preventDefault();
      selectPlayer(playerSuggestions[playerHighlight]);
    } else if (e.key === "Escape") {
      setShowPlayerDropdown(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "-";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      : `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString();
  };

  const teamName = (team) => {
    if (team === 0)
      return (
        <div className="flex text-team-amber items-center gap-1">
          Hidden King
        </div>
      );
    if (team === 1)
      return (
        <div className="flex text-team-sapphire items-center gap-1">
          Archmother
        </div>
      );
    return "Unknown";
  };

  // Render hero icons for a specific team
  const renderTeamHeroes = (match, team) => {
    const players = (match.players || []).filter((p) => p.team === team);
    return (
      <div className="flex justify-center gap-1 flex-wrap">
        {players.map((p, i) => (
          <img
            key={i}
            src={getHeroIcon(p.hero_name)}
            alt={p.hero_name || "?"}
            title={p.hero_name || "Unknown"}
            className="w-8 h-8"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        ))}
      </div>
    );
  };

  const getWeekDisplay = (match) => {
    const dbWeek = match?.event_week;
    const mappedWeek = weekMap[String(match?.match_id)];
    const week = dbWeek != null ? dbWeek : mappedWeek;
    if (week == null) return null;

    const title = (match?.event_title || "Night Shift").trim() || "Night Shift";
    return { title, week };
  };

  if (error) {
    return (
      <div className="w-full p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:p-8">
      <h1 className="text-gray-100 text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Match List</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4">
        <div className="relative w-full sm:w-64">
          <div className="flex">
            <select
              value={seriesFilter}
              onChange={(e) => {
                setSeriesFilter(e.target.value);
                setWeekFilter("");
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-input border border-border-light rounded-l text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">Filter by series...</option>
              {seriesOptions.map((series) => (
                <option key={series} value={series}>
                  {series}
                </option>
              ))}
            </select>
            {seriesFilter && (
              <button
                onClick={clearSeries}
                className="px-2 bg-input border-y border-border-light text-gray-400 hover:text-white text-sm"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {seriesFilter && weekOptions.length > 0 && (
          <div className="relative w-full sm:w-56">
            <div className="flex">
              <select
                value={weekFilter}
                onChange={(e) => {
                  setWeekFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-input border border-border-light rounded-l text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">Filter by week...</option>
                {weekOptions.map((week) => (
                  <option key={week} value={week}>
                    Week {week}
                  </option>
                ))}
              </select>
              {weekFilter && (
                <button
                  onClick={clearWeek}
                  className="px-2 bg-input border-y border-border-light text-gray-400 hover:text-white text-sm"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hero filter combobox */}
        <div ref={heroRef} className="relative w-full sm:w-64">
          <div className="flex">
            <input
              type="text"
              placeholder="Filter by hero..."
              value={heroSearch}
              onChange={(e) => {
                setHeroSearch(e.target.value);
                setShowHeroDropdown(true);
              }}
              onFocus={() => setShowHeroDropdown(true)}
              onKeyDown={handleHeroKey}
              className="w-full px-3 py-2 bg-input border border-border-light rounded-l text-white text-sm focus:outline-none focus:border-blue-500"
            />
            {heroFilter && (
              <button
                onClick={clearHero}
                className="px-2 bg-input border-y border-border-light text-gray-400 hover:text-white text-sm"
              >
                ×
              </button>
            )}
            <button
              onClick={() => setShowHeroDropdown(!showHeroDropdown)}
              className="px-2 bg-input border border-border-light rounded-r text-gray-400 hover:text-white text-sm"
            >
              ▾
            </button>
          </div>
          {showHeroDropdown && heroSuggestions.length > 0 && (
            <ul className="absolute z-50 w-full mt-1 bg-gray-900 border border-border-light rounded shadow-lg max-h-60 overflow-y-auto">
              {heroSuggestions.map((h, i) => (
                <li
                  key={h.id}
                  onClick={() => selectHero(h.name)}
                  className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                    i === heroHighlight
                      ? "bg-blue-600 text-white"
                      : "text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  <img
                    src={getHeroIcon(h.name)}
                    alt=""
                    className="w-5 h-5 rounded"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  {h.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Player filter combobox */}
        <div ref={playerRef} className="relative w-full sm:w-64">
          <div className="flex">
            <input
              type="text"
              placeholder="Filter by player..."
              value={playerSearch}
              onChange={(e) => {
                setPlayerSearch(e.target.value);
                setShowPlayerDropdown(true);
              }}
              onFocus={() => setShowPlayerDropdown(true)}
              onKeyDown={handlePlayerKey}
              className="w-full px-3 py-2 bg-input border border-border-light rounded-l text-white text-sm focus:outline-none focus:border-blue-500"
            />
            {playerFilter && (
              <button
                onClick={clearPlayer}
                className="px-2 bg-input border-y border-border-light text-gray-400 hover:text-white text-sm"
              >
                ×
              </button>
            )}
            <button
              onClick={() => setShowPlayerDropdown(!showPlayerDropdown)}
              className="px-2 bg-input border border-border-light rounded-r text-gray-400 hover:text-white text-sm"
            >
              ▾
            </button>
          </div>
          {showPlayerDropdown && playerSuggestions.length > 0 && (
            <ul className="absolute z-50 w-full mt-1 bg-gray-900 border border-border-light rounded shadow-lg max-h-60 overflow-y-auto">
              {playerSuggestions.map((name, i) => (
                <li
                  key={name}
                  onClick={() => selectPlayer(name)}
                  className={`px-3 py-2 cursor-pointer text-sm ${
                    i === playerHighlight
                      ? "bg-blue-600 text-white"
                      : "text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Match Table */}
      <div className="bg-table border border-border-light shadow rounded-lg p-6">
        {loading ? (
          <div className="text-center text-xl text-gray-300 py-8">
            Loading matches...
          </div>
        ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[600px] sm:min-w-0">
            <thead>
              <tr className="border-b border-border-light text-white">
                <th className="text-left p-4 w-[10%]">Week</th>
                <th className="text-left p-4 w-[15%]">Match</th>
                <th className="text-left p-4 w-[25%]">Winner</th>
                <th className="text-center p-4 w-[20%]">
                  <div className="flex justify-center gap-2">
                    <img
                      src="/static/images/teamNames/team1_patron_logo_psd.png"
                      alt="Hidden King"
                      className="h-10"
                      style={{
                        filter:
                          "brightness(0) saturate(100%) invert(64%) sepia(14%) saturate(3308%) hue-rotate(1deg) brightness(106%) contrast(103%)",
                      }}
                    />
                  </div>
                </th>
                <th className="p-4 w-[20%]">
                  <div className="flex justify-center gap-2">
                    <img
                      src="/static/images/teamNames/team2_patron_logo_psd.png"
                      alt="Team Sapphire"
                      className="h-10"
                      style={{
                        filter:
                          "brightness(0) saturate(100%) invert(24%) sepia(96%) saturate(1698%) hue-rotate(203deg) brightness(94%) contrast(115%)",
                      }}
                    />{" "}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-4 text-center text-gray-500">
                    No matches found
                  </td>
                </tr>
              ) : (
                matches.map((match) => {
                  const weekDisplay = getWeekDisplay(match);
                  return (
                    <tr
                      key={match.match_id}
                      className="border-b border-border-light text-gray-200 hover:bg-hover"
                    >
                      <td className="p-4 text-gray-400 text-sm">
                        {weekDisplay ? (
                          <Link
                            to={`/week/${weekDisplay.week}?event_title=${encodeURIComponent(weekDisplay.title)}`}
                            className="hover:underline hover:text-gray-200"
                          >
                            {weekDisplay.title} #{weekDisplay.week}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-4">
                        <Link
                          to={`/match/${match.match_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {match.match_id}
                        </Link>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatDate(match.start_time)}
                        </div>
                      </td>
                      <td className="p-4">{teamName(match.winning_team)}</td>
                      <td className="p-4">{renderTeamHeroes(match, 0)}</td>
                      <td className="p-4">{renderTeamHeroes(match, 1)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination Controls */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="text-sm text-gray-600">
            Showing {matches.length > 0 ? (page - 1) * perPage + 1 : 0} to{" "}
            {Math.min(page * perPage, total)} of {total} matches
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-gray-700">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MatchList;
