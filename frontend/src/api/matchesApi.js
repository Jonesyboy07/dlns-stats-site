// API client for Flask backend
import { spoilerHeaders } from '../spoilers/spoilerStore';
const API_BASE = import.meta.env.DEV 
  ? 'http://localhost:5050'  // Flask dev server
  : '';  // Production uses same origin

export const matchesApi = {
  // Get paginated matches with filters
  async getMatches({ page = 1, per_page = 20, order = 'desc', team, game_mode, match_mode } = {}) {
    const params = new URLSearchParams({
      page: page.toString(),
      per_page: per_page.toString(),
      order,
    });
    
    if (team !== undefined && team !== '') params.append('team', team);
    if (game_mode) params.append('game_mode', game_mode);
    if (match_mode) params.append('match_mode', match_mode);
    
    const response = await fetch(`${API_BASE}/db/matches/latest/paged?${params}`, { headers: spoilerHeaders() });
    if (!response.ok) throw new Error('Failed to fetch matches');
    return response.json();
  },
  
  // Get players for a specific match
  async getMatchPlayers(matchId) {
    const response = await fetch(`${API_BASE}/db/matches/${matchId}/players`, { headers: spoilerHeaders() });
    if (!response.ok) throw new Error('Failed to fetch match players');
    return response.json();
  },
  
  // Get user info
  async getUser(accountId) {
    const response = await fetch(`${API_BASE}/db/users/${accountId}`);
    if (!response.ok) throw new Error('Failed to fetch user');
    return response.json();
  },
  
  // Get heroes mapping
  async getHeroes() {
    const response = await fetch(`${API_BASE}/db/heroes`);
    if (!response.ok) throw new Error('Failed to fetch heroes');
    return response.json();
  }
};
