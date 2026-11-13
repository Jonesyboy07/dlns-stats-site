/**
 * Single source for the header nav. Desktop dropdowns and mobile panels both
 * map over this, so the two layouts can't drift apart.
 *
 * `match` lists the path prefixes that make a section "active" (a deep link
 * like /player/123 lights up Teams). A menu row is "current" when the path
 * equals its `to`. A column can have a visible `label` heading, or an
 * `srLabel` that names its list for screen readers only; with neither, the
 * list is named after the menu. An item may carry an optional `sub` line.
 */
export const NAV = [
  {
    id: 'nightShift',
    label: 'Night Shift',
    match: ['/week', '/matchlist', '/match', '/matches', '/series'],
    columns: [
      {
        items: [
          { label: 'This week', to: '/week' },
          { label: 'Matches', to: '/matchlist' },
        ],
      },
    ],
  },
  {
    id: 'teams',
    label: 'Teams',
    match: ['/teams', '/team', '/players', '/player', '/users'],
    columns: [
      {
        items: [
          { label: 'Players', to: '/players' },
          { label: 'Teams', to: '/teams' },
        ],
      },
    ],
  },
  {
    id: 'stats',
    label: 'Stats',
    match: ['/stats', '/heroes', '/hero', '/items', '/item'],
    columns: [
      {
        srLabel: 'Browse',
        items: [
          { label: 'Heroes', to: '/heroes' },
          { label: 'Items', to: '/items' },
        ],
      },
      {
        srLabel: 'Leaderboards',
        items: [{ label: 'All stats', to: '/stats' }],
      },
    ],
    /* Mobile panel footer link. */
    footer: { label: 'All stats and leaderboards', to: '/stats' },
  },
  { id: 'community', label: 'Community', to: '/community', match: ['/community'] },
];

/** True when `pathname` is `prefix` itself or sits under it. */
export function pathMatches(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isSectionActive(group, pathname) {
  return (group.match || []).some((prefix) => pathMatches(pathname, prefix));
}

export function isCurrentPage(item, pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return path === item.to;
}
