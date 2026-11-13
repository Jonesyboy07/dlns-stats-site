import React from 'react';
import { Link } from 'react-router-dom';
import { navItemClass } from './navStyles';

/** Plain top-level link (Community): same look as a menu trigger, no chevron. */
export default function NavLink({ to, label, isActive, onClick, variant = 'desktop' }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={navItemClass(variant, { isActive })}
    >
      {label}
    </Link>
  );
}
