import React, { forwardRef } from 'react';
import { navItemClass } from './navStyles';

/** Menu trigger: a pill on desktop, a chip on mobile, with a chevron. */
const NavMenuButton = forwardRef(function NavMenuButton(
  { label, isOpen, isSectionActive, onToggle, controlsId, variant = 'desktop' },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls={controlsId}
      className={navItemClass(variant, { isOpen, isActive: isSectionActive })}
    >
      {label}
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        className={`h-3 w-3 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${
          isOpen ? 'rotate-180' : ''
        }`}
      >
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
});

export default NavMenuButton;
