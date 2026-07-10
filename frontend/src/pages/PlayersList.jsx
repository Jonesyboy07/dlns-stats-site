import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

function PlayersList() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [teamFilter, setTeamFilter] = useState('All');
  const [gamesFilter, setGamesFilter] = useState('All');
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/db/players');
      if (!response.ok) {
        throw new Error('Failed to fetch players');
      }
      const data = await response.json();
      setPlayers(data.players || data);
    } catch (err) {
      console.error('Failed to fetch players:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Extract unique team names for the filter dropdown
  const teamOptions = useMemo(() => {
    const teams = new Set(players.map(p => p.team_name).filter(Boolean));
    return ['All', ...Array.from(teams).sort()];
  }, [players]);

  // Apply filters
  const filteredPlayers = useMemo(() => {
    return players.filter(player => {
      // Search filter — name or steam ID
      const query = searchTerm.toLowerCase().trim();
      if (query) {
        const nameMatch = player.persona_name?.toLowerCase().includes(query);
        const idMatch = String(player.account_id).includes(query);
        if (!nameMatch && !idMatch) return false;
      }

      // Team filter
      if (teamFilter !== 'All' && player.team_name !== teamFilter) return false;

      // Games played filter
      if (gamesFilter !== 'All') {
        const gc = player.match_count || 0;
        switch (gamesFilter) {
          case '150+': if (gc < 150) return false; break;
          case '100-150': if (gc < 100 || gc >= 150) return false; break;
          case '50-100': if (gc < 50 || gc >= 100) return false; break;
          case '<50': if (gc >= 50) return false; break;
          default: break;
        }
      }

      return true;
    });
  }, [players, searchTerm, teamFilter, gamesFilter]);

  if (loading) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl text-gray-300">Loading players...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="w-full p-8">
      <h1 className="text-white text-3xl font-bold mb-6">Players</h1>

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          type="text"
          placeholder="Search name or Steam ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-72 px-4 py-2 text-gray-300 bg-[var(--bg-panel)] border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="px-3 py-2 text-gray-300 bg-[var(--bg-panel)] border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {teamOptions.map(team => (
            <option key={team} value={team}>{team === 'All' ? 'All Teams' : team}</option>
          ))}
        </select>

        <select
          value={gamesFilter}
          onChange={(e) => setGamesFilter(e.target.value)}
          className="px-3 py-2 text-gray-300 bg-[var(--bg-panel)] border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Games</option>
          <option value="150+">150+</option>
          <option value="100-150">100-150</option>
          <option value="50-100">50-100</option>
          <option value="<50">&lt;50</option>
        </select>
      </div>

      {/* Player Count */}
      <div className="mb-4">
        <p className="text-gray-400">
          Showing {filteredPlayers.length} of {players.length} players
        </p>
      </div>

      {/* Players Table */}
      <div className="bg-[var(--bg-panel)] text-gray-300 shadow rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-base)]">
            <tr className="border-b border-gray-700">
              <th className="text-left p-4">Player</th>
              <th className="text-left p-4">Steam ID</th>
              <th className="text-left p-4">Team</th>
              <th className="text-left p-4">Games</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.map((player) => (
              <tr 
                key={player.account_id} 
                className="border-b border-gray-700 hover:bg-slate-800/50 transition-colors"
              >
                {/* Player name + avatar */}
                <td className="p-4">
                  <Link 
                    to={`/player/${player.account_id}`}
                    className="flex items-center gap-3 group"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-700 flex-shrink-0 overflow-hidden">
                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                          {(player.persona_name || '?')[0]}
                        </div>
                      )}
                    </div>
                    <span className="text-[var(--accent)] group-hover:underline font-medium">
                      {player.persona_name || 'Unknown Player'}
                    </span>
                  </Link>
                </td>

                {/* Steam ID */}
                <td className="p-4 text-gray-400 font-mono text-sm">
                  {player.account_id}
                </td>

                {/* Team */}
                <td className="p-4">
                  <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-slate-700/60 text-gray-200">
                    {player.team_name || 'Unknown'}
                  </span>
                </td>

                {/* Games */}
                <td className="p-4 text-gray-400">
                  {player.match_count || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* No Results */}
      {filteredPlayers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-xl">No players found matching "{searchTerm}"</p>
        </div>
      )}
    </div>
  );
}

export default PlayersList;
