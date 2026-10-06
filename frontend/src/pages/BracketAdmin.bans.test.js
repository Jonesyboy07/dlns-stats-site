import { describe, expect, it } from 'vitest';
import { banPayload, banTeam, toBanForm } from './BracketAdmin.jsx';

const order = (first, pattern) => [0, 1, 2, 3].map((i) => banTeam(first, i, pattern));

describe('ban order', () => {
  it('follows the event pattern from the team that bans first', () => {
    expect(order('team_a', 'ABBA')).toEqual(['team_a', 'team_b', 'team_b', 'team_a']);
    expect(order('team_b', 'ABBA')).toEqual(['team_b', 'team_a', 'team_a', 'team_b']);
    expect(order('team_a', 'ABAB')).toEqual(['team_a', 'team_b', 'team_a', 'team_b']);
    expect(order('team_a', 'AABB')).toEqual(['team_a', 'team_a', 'team_b', 'team_b']);
  });

  it('falls back to A, B, B, A for events without a pattern', () => {
    expect(order('team_a', undefined)).toEqual(['team_a', 'team_b', 'team_b', 'team_a']);
  });

  it('sends filled slots with their slot number and team', () => {
    const draft = { first: 'team_b', heroes: ['13', '', '6', ''] };
    expect(banPayload(draft, 'ABBA')).toEqual([
      { order: 1, team: 'team_b', hero_id: 13 },
      { order: 3, team: 'team_a', hero_id: 6 },
    ]);
  });

  it('reads the first-ban team back from saved bans using the pattern', () => {
    // ABBA: slot 3 is B, so a team_a ban there means team_b banned first.
    expect(toBanForm([{ order: 3, team: 'team_a', hero_id: 1 }], 'ABBA')).toEqual({ first: 'team_b', heroes: ['', '', '1', ''] });
    expect(toBanForm(undefined, 'ABBA')).toEqual({ first: 'team_a', heroes: ['', '', '', ''] });
  });
});
