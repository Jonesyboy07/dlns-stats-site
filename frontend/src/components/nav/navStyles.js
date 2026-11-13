/* Shared class strings for the header. Kept here so desktop and mobile pieces
   read the same tokens. */

/** 2px accent ring, 2px offset, keyboard focus only. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary-light';

/** Uppercase section label: NIGHT SHIFT, BROWSE, SEARCH IN, DISPLAY… */
export const SECTION_LABEL =
  'text-[11px] font-semibold uppercase tracking-[.12em] text-muted';

/** Pill / chip colours for a nav trigger or link in each state. */
export function navItemTone({ isOpen = false, isActive = false }) {
  if (isOpen) return 'bg-hover text-primary';
  if (isActive) return 'bg-accent-bg-strong text-accent-light';
  return 'text-secondary hover:bg-hover hover:text-primary';
}

const DESKTOP_PILL =
  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-[7px] font-valve-oracle text-[15px] font-medium tracking-[.02em] transition-colors';

const MOBILE_CHIP =
  'inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 font-valve-oracle text-[15px] font-medium tracking-[.02em] transition-colors';

export function navItemClass(variant, state) {
  const base = variant === 'mobile' ? MOBILE_CHIP : DESKTOP_PILL;
  /* Mobile chips sit on bg-panel at rest; desktop pills are transparent. */
  const rest = variant === 'mobile' && !state.isOpen && !state.isActive ? 'bg-panel' : '';
  return `${base} ${rest} ${navItemTone(state)} ${FOCUS_RING}`;
}
