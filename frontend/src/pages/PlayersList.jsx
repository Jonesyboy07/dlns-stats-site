import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LoadingSkeleton from "../components/LoadingSkeleton";

function PlayersList() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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

  if (loading) {
    return <LoadingSkeleton variant="list-item" />;
  }

  if (error) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl text-red-600">Error: {error}</div>
      </div>
    );
  }

  // Filter players by search term
  const filteredPlayers = players.filter(player =>
    player.persona_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="w-full p-8">
      <h1 className="text-white text-3xl font-bold mb-6">Players</h1>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search players..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-96 px-4 py-2 text-gray-300 bg-[var(--bg-panel)] border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Player Count */}
      <div className="mb-4">
        <p className="text-gray-400">
          Showing {filteredPlayers.length} of {players.length} players
        </p>
      </div>

      {/* Players List */}
      <div className="bg-[var(--bg-panel)] text-gray-300 shadow rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-base)]">
            <tr className="border-b border-gray-700">
              <th className="text-left p-4">Player Name</th>
              <th className="text-left p-4">Account ID</th>
              <th className="text-left p-4">Total Matches</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.map((player) => (
              <tr 
                key={player.account_id} 
                className="border-b border-gray-700 hover:bg-slate-800/50 transition-colors"
              >
                <td className="p-4">
                  <Link 
                    to={`/player/${player.account_id}`}
                    className="text-[var(--accent)] hover:underline font-medium"
                  >
                    {player.persona_name || 'Unknown Player'}
                  </Link>
                </td>
                <td className="p-4 text-gray-400">
                  {player.account_id}
                </td>
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
