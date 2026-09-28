import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import PlayerAvatar from "../components/PlayerAvatar";
import ScoreChip from "../components/player/ScoreChip";
import SegmentedControl from "../components/player/SegmentedControl";
import { formatPercent } from "../utils/format";

const DASH = "—";

/** Games-played buckets. Five options is a small enough set for pills. */
const GAMES_FILTERS = [
  { id: "All", label: "All games" },
  { id: "150+", label: "150+" },
  { id: "100-150", label: "100–150" },
  { id: "50-100", label: "50–100" },
  { id: "<50", label: "<50" },
];

/**
 * A native dropdown popup is painted by the OS, not by the page: an option that
 * carries no colours of its own inherits the select's light text and lands on a
 * white popup. Every option therefore states its own pair.
 */
const OPTION_CLASS = "bg-table text-secondary";

const inGamesBucket = (games, bucket) => {
  switch (bucket) {
    case "150+":
      return games >= 150;
    case "100-150":
      return games >= 100 && games < 150;
    case "50-100":
      return games >= 50 && games < 100;
    case "<50":
      return games < 50;
    default:
      return true;
  }
};

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

  // Unique team names for the filter dropdown. The endpoint reports each player's
  // OWN spelling, and the hand-authored feed mixes casings (ABRAHAMS and Abrahams are
  // one team), so names are grouped case-insensitively and the option shows the
  // spelling that appears most often — the same rule the team pages apply. "Unknown"
  // is the API's fallback for a player with no resolvable team, not a team to filter by.
  const teamOptions = useMemo(() => {
    const groups = new Map();
    for (const name of players.map(p => p.team_name)) {
      if (!name || name === 'Unknown') continue;
      const group = groups.get(name.toLowerCase()) ?? new Map();
      group.set(name, (group.get(name) ?? 0) + 1);
      groups.set(name.toLowerCase(), group);
    }
    const names = [...groups.values()]
      .map(spellings =>
        [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      )
      .sort((a, b) => a.localeCompare(b));
    return ['All', ...names];
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

      // Team filter — case-insensitive for the same reason the options are grouped
      if (teamFilter !== 'All' && (player.team_name || '').toLowerCase() !== teamFilter.toLowerCase()) {
        return false;
      }

      // Games played filter
      if (!inGamesBucket(player.match_count || 0, gamesFilter)) return false;

      return true;
    });
  }, [players, searchTerm, teamFilter, gamesFilter]);

  const isFiltered = Boolean(searchTerm.trim() || teamFilter !== 'All' || gamesFilter !== 'All');
  const clearFilters = () => {
    setSearchTerm('');
    setTeamFilter('All');
    setGamesFilter('All');
  };

  if (loading) {
    return <LoadingSkeleton variant="table-row" />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={fetchPlayers} />;
  }

  return (
    <div className="w-full px-4 py-6">
      <header className="mb-4">
        <h1 className="font-valve-oracle text-[24px] leading-tight text-primary">Players</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {players.length} player{players.length === 1 ? '' : 's'} recorded
        </p>
      </header>

      {/* Search + filters, the same grammar as the player match table: pills for
          short option sets, a dropdown where the list is long. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search name or Steam ID…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-border-light bg-input px-3.5 py-2 text-[13px] text-secondary outline-none placeholder:text-dim focus:border-accent-secondary-border md:w-72"
        />

        <span className="flex items-center gap-1 rounded-full border border-border bg-table px-3">
          <select
            aria-label="Team"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="bg-transparent py-1.5 text-[12px] text-secondary outline-none"
          >
            {teamOptions.map(team => (
              <option className={OPTION_CLASS} key={team} value={team}>
                {team === 'All' ? 'All teams' : team}
              </option>
            ))}
          </select>
        </span>

        <SegmentedControl
          label="Games played"
          options={GAMES_FILTERS}
          value={gamesFilter}
          onChange={setGamesFilter}
        />

        <span className="ml-auto text-[12px] tabular-nums text-dim">
          Showing {filteredPlayers.length} of {players.length}
        </span>
      </div>

      {filteredPlayers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-lighter px-4 py-10 text-center">
          <p className="text-[13px] text-muted">
            {searchTerm.trim()
              ? `No players match “${searchTerm.trim()}”.`
              : 'No players match these filters.'}
          </p>
          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-border-light bg-input px-4 py-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-card shadow">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-border-light bg-table text-[11px] uppercase tracking-[.05em] text-muted">
                <th className="px-4 py-2.5 text-left font-normal">Player</th>
                <th className="px-4 py-2.5 text-left font-normal">Steam ID</th>
                <th className="px-4 py-2.5 text-left font-normal">Team</th>
                <th className="px-4 py-2.5 text-right font-normal">Games</th>
                <th className="px-4 py-2.5 text-right font-normal">Record</th>
                <th className="px-4 py-2.5 text-right font-normal">Win rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPlayers.map((player) => (
                <tr
                  key={player.account_id}
                  className="transition-colors hover:bg-accent-secondary/[0.08]"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/player/${player.account_id}`}
                      className="group flex items-center gap-3"
                    >
                      <PlayerAvatar
                        player={player}
                        size="h-9 w-9"
                        rounded="rounded-lg"
                      />
                      <span className="truncate text-[13px] font-semibold text-accent-secondary-light group-hover:underline">
                        {player.persona_name || 'Unknown Player'}
                      </span>
                    </Link>
                  </td>

                  <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-dim">
                    {player.account_id}
                  </td>

                  <td className="px-4 py-2.5 text-[13px]">
                    {player.team_name && player.team_name !== 'Unknown' ? (
                      <Link
                        to={`/team/${encodeURIComponent(player.team_name)}`}
                        className="text-secondary transition-colors hover:text-accent-secondary-light hover:underline"
                      >
                        {player.team_name}
                      </Link>
                    ) : (
                      <span className="text-dim" title="No team resolved for this player">
                        {DASH}
                      </span>
                    )}
                  </td>

                  {/* Record and win rate are what the API already returns and the
                      player page leads with, so the list speaks the same language. */}
                  <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-secondary">
                    {player.match_count || 0}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {player.wins == null || player.losses == null ? (
                      <span className="text-dim">{DASH}</span>
                    ) : (
                      <ScoreChip
                        wins={player.wins}
                        losses={player.losses}
                        className="text-[13px]"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-secondary">
                    {player.winrate == null ? DASH : formatPercent(player.winrate * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PlayersList;
