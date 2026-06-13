import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { cdnImage } from '../utils/cdn';

function PlayerHeroDetail() {
  const { accountId, heroId } = useParams();
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  const [heroName, setHeroName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, [accountId, heroId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [userRes, matchesRes] = await Promise.all([
        fetch(`/db/users/${accountId}`),
        fetch(`/db/users/${accountId}/matches`),
      ]);

      if (!userRes.ok) throw new Error('Player not found');
      const userData = await userRes.json();
      setUser(userData.user);

      if (matchesRes.ok) {
        const matchesData = await matchesRes.json();
        const filtered = (matchesData.matches || []).filter(
          (m) => String(m.hero_id) === String(heroId)
        );
        setMatches(filtered);
        if (filtered.length > 0) {
          setHeroName(filtered[0].hero_name || `Hero ${heroId}`);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const heroCardUrl = (name) => {
    const slug = name.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, '_');
    return cdnImage(`cardicons/${slug}_card_psd.png`);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (s) => {
    if (!s) return '-';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const wins = matches.filter((m) => m.result === 'Win').length;
  const losses = matches.length - wins;
  const totalKills = matches.reduce((a, m) => a + (m.kills || 0), 0);
  const totalDeaths = matches.reduce((a, m) => a + (m.deaths || 0), 0);
  const totalAssists = matches.reduce((a, m) => a + (m.assists || 0), 0);
  const avgKDA = matches.length
    ? ((totalKills + totalAssists) / Math.max(totalDeaths, 1)).toFixed(2)
    : '0.00';
  const avgK = matches.length ? (totalKills / matches.length).toFixed(1) : '0.0';
  const avgD = matches.length ? (totalDeaths / matches.length).toFixed(1) : '0.0';
  const avgA = matches.length ? (totalAssists / matches.length).toFixed(1) : '0.0';
  const winRate = matches.length ? ((wins / matches.length) * 100).toFixed(1) : '0.0';

  if (loading) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl">Loading...</div>
      </div>
    );
  }

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
    <div className="w-full p-8">
      <Link
        to={`/player/${accountId}`}
        className="text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to {user?.persona_name || 'Player'}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-6 mb-8">
        {heroName && (
          <img
            src={heroCardUrl(heroName)}
            alt={heroName}
            className="w-20 h-28 object-cover rounded shadow"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        <div>
          <h1 className="text-white text-3xl font-bold">{heroName || `Hero ${heroId}`}</h1>
          <p className="text-gray-400 text-lg mt-1">
            {user?.persona_name || 'Unknown Player'}
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="bg-panel text-gray-300 shadow rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-gray-500 text-sm">Games</p>
            <p className="text-2xl font-bold">{matches.length}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">W-L</p>
            <p className="text-2xl font-bold">
              <span className="text-green-600">{wins}</span>
              <span className="text-gray-400"> - </span>
              <span className="text-red-600">{losses}</span>
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Win Rate</p>
            <p className="text-2xl font-bold">{winRate}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Avg KDA</p>
            <p className="text-2xl font-bold">{avgKDA}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Avg K / D / A</p>
            <p className="text-2xl font-bold">
              {avgK} / {avgD} / {avgA}
            </p>
          </div>
        </div>
      </div>

      {/* Match History */}
      <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Match History</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3">Match</th>
                <th className="text-left p-3">Result</th>
                <th className="text-left p-3">K / D / A</th>
                <th className="text-left p-3">KDA</th>
                <th className="text-left p-3">Duration</th>
                <th className="text-left p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-4 text-center text-gray-400">
                    No matches found
                  </td>
                </tr>
              ) : (
                matches.map((match) => (
                  <tr key={match.match_id} className="border-b border-gray-700 hover:bg-slate-800/90">
                    <td className="p-3">
                      <Link
                        to={`/match/${match.match_id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {match.match_id}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span
                        className={`font-semibold ${
                          match.result === 'Win' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {match.result || '-'}
                      </span>
                    </td>
                    <td className="p-3">
                      {match.kills || 0} / {match.deaths || 0} / {match.assists || 0}
                    </td>
                    <td className="p-3">
                      {(
                        (match.kills + match.assists) /
                        Math.max(match.deaths, 1)
                      ).toFixed(2)}
                    </td>
                    <td className="p-3">{formatDuration(match.duration_s)}</td>
                    <td className="p-3 text-sm text-gray-600">
                      {formatDate(match.start_time || match.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PlayerHeroDetail;
