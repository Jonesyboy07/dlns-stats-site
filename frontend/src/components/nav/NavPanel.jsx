import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isCurrentPage } from './navConfig';
import { FOCUS_RING, SECTION_LABEL } from './navStyles';
import usePresence from './usePresence';

function Tile({ item, pathname, onNavigate }) {
  const isCurrent = isCurrentPage(item, pathname);
  return (
    <li className="min-w-0">
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={isCurrent ? 'page' : undefined}
        className={`block h-full rounded-md p-3 transition-colors ${
          isCurrent ? 'bg-accent-bg-strong' : 'bg-card hover:bg-hover'
        } ${FOCUS_RING}`}
      >
        <span className={`block text-[14px] font-semibold ${isCurrent ? 'text-accent-light' : 'text-primary'}`}>
          {item.label}
        </span>
        {item.sub && <span className="mt-0.5 block text-[12px] font-medium text-muted">{item.sub}</span>}
      </Link>
    </li>
  );
}

/**
 * Mobile inline panel under the chip row. Each config column becomes a
 * section of tiles, under its label when it has one. A group with a `footer`
 * (Stats) uses a 2-column grid and swaps any column that only holds the
 * footer's destination for the footer link at the bottom; other groups
 * (Night Shift, Teams) use one column.
 */
export default function NavPanel({ id, group, isOpen, onNavigate }) {
  const { pathname } = useLocation();
  const { mounted, closing } = usePresence(isOpen);
  if (!mounted) return null;

  const { footer } = group;
  const sections = group.columns
    .map((column) => ({
      ...column,
      items: column.items.filter((item) => !footer || item.to !== footer.to),
    }))
    .filter((column) => column.items.length > 0);

  return (
    <div
      id={id}
      className={`w-full space-y-3 rounded-lg border border-border-light bg-panel p-3 ${
        closing ? 'nav-pop-out pointer-events-none' : 'nav-pop-in'
      }`}
    >
      {sections.map((column, index) => {
        const labelId = `${id}-label-${index}`;
        return (
          <div key={column.label || column.srLabel || index}>
            {column.label && (
              <p id={labelId} className={`mb-2 px-1 ${SECTION_LABEL}`}>
                {column.label}
              </p>
            )}
            <ul
              aria-labelledby={column.label ? labelId : undefined}
              aria-label={column.label ? undefined : column.srLabel || group.label}
              className={`grid gap-2 ${footer ? 'grid-cols-2' : 'grid-cols-1'}`}
            >
              {column.items.map((item) => (
                <Tile key={item.label} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        );
      })}
      {footer && (
        <Link
          to={footer.to}
          onClick={onNavigate}
          aria-current={isCurrentPage(footer, pathname) ? 'page' : undefined}
          className={`inline-flex min-h-9 items-center rounded-md px-1 text-[14px] font-semibold text-accent-secondary-light hover:underline ${FOCUS_RING}`}
        >
          {footer.label} <span aria-hidden="true">&nbsp;→</span>
        </Link>
      )}
    </div>
  );
}
