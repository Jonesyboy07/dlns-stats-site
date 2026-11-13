import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isCurrentPage } from './navConfig';
import { FOCUS_RING, SECTION_LABEL } from './navStyles';
import usePresence from './usePresence';

function MenuRow({ item, isCurrent, onNavigate }) {
  return (
    <li>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={isCurrent ? 'page' : undefined}
        className={`block rounded-md px-3 py-2 transition-colors ${
          isCurrent ? 'bg-accent-bg-strong' : 'hover:bg-hover'
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
 * Desktop floating menu under a nav trigger. `list` is one 220px column
 * (Night Shift); `columns` sizes to its columns (min 160px each) with a 1px
 * divider between them (Stats).
 */
export default function NavDropdown({ id, group, variant = 'list', isOpen, onNavigate }) {
  const { pathname } = useLocation();
  const { mounted, closing } = usePresence(isOpen);
  if (!mounted) return null;

  const isColumns = variant === 'columns';
  /* One 1px divider track between each pair of columns. */
  const gridTemplateColumns = isColumns
    ? group.columns.map(() => 'minmax(160px, 1fr)').join(' 1px ')
    : undefined;

  return (
    <div
      id={id}
      style={isColumns ? { gridTemplateColumns } : undefined}
      className={`absolute left-0 top-[46px] z-40 rounded-lg border border-border-light bg-panel p-1.5 shadow-heavy ${
        isColumns ? 'grid w-max gap-1.5' : 'w-[220px]'
      } ${closing ? 'nav-pop-out pointer-events-none' : 'nav-pop-in'}`}
    >
      {group.columns.map((column, index) => {
        const labelId = `${id}-col-${index}`;
        return (
          <React.Fragment key={column.label || column.srLabel || index}>
            {isColumns && index > 0 && <div aria-hidden="true" className="bg-border" />}
            <div className="min-w-0">
              {column.label && (
                <p id={labelId} className={`px-3 pb-1 pt-2 ${SECTION_LABEL}`}>
                  {column.label}
                </p>
              )}
              <ul
                aria-labelledby={column.label ? labelId : undefined}
                aria-label={column.label ? undefined : column.srLabel || group.label}
                className="space-y-0.5"
              >
                {column.items.map((item) => (
                  <MenuRow
                    key={item.label}
                    item={item}
                    isCurrent={isCurrentPage(item, pathname)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
