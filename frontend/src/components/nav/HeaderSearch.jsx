import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSearchSuggest from './useSearchSuggest';
import usePresence from './usePresence';
import { FOCUS_RING, SECTION_LABEL } from './navStyles';

/* Items has no chip yet: /db/search/suggest doesn't return items. Add one
   here (types: ['item']) once it does. */
const SCOPES = [
  { id: 'all', label: 'All', types: null, noun: 'everything', placeholder: 'Search players, teams, heroes…' },
  { id: 'players', label: 'Players', types: ['user'], noun: 'players', placeholder: 'Search players…' },
  { id: 'teams', label: 'Teams', types: ['team'], noun: 'teams', placeholder: 'Search teams…' },
  { id: 'heroes', label: 'Heroes', types: ['hero'], noun: 'heroes', placeholder: 'Search heroes…' },
];

const GROUPS = [
  { type: 'user', label: 'Players' },
  { type: 'team', label: 'Teams' },
  { type: 'hero', label: 'Heroes' },
  { type: 'match', label: 'Matches' },
];

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const searchUrl = (term) => `/search?q=${encodeURIComponent(term)}`;

/**
 * Header search field with a "Search in" panel: scope chips, typeahead
 * results grouped by type, and a footer row to the full /search page.
 * Desktop opens a floating panel; mobile opens it inline under the field.
 */
export default function HeaderSearch({ variant = 'desktop', isOpen, onOpen, onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const baseId = useId();
  const listboxId = `${baseId}-results`;
  const panelId = `${baseId}-panel`;
  const isDesktop = variant === 'desktop';

  const [query, setQuery] = useState('');
  const [scopeId, setScopeId] = useState('all');
  const [highlight, setHighlight] = useState(-1);
  const { results, searching, error } = useSearchSuggest(query);
  const { mounted, closing } = usePresence(isOpen);

  const term = query.trim();
  const scope = SCOPES.find((s) => s.id === scopeId) || SCOPES[0];

  /* Group results by type in a fixed order, filtered to the scope. The flat
     list gives arrow keys a single index across groups. */
  const { groups, flat } = useMemo(() => {
    const allowed = scope.types;
    const grouped = GROUPS.map((g) => ({
      ...g,
      items: results.filter((r) => r.type === g.type && (!allowed || allowed.includes(r.type))),
    })).filter((g) => g.items.length > 0);
    return { groups: grouped, flat: grouped.flatMap((g) => g.items) };
  }, [results, scope]);

  useEffect(() => {
    setHighlight(-1);
  }, [results, scopeId]);

  /* "/" from anywhere outside a text field focuses this field, when it is
     the visible one (desktop and mobile layouts are both in the DOM). */
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reset = () => {
    setQuery('');
    setHighlight(-1);
  };

  const goTo = (url) => {
    reset();
    onClose();
    inputRef.current?.blur();
    navigate(url);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (highlight >= 0 && flat[highlight]) {
      goTo(flat[highlight].url);
    } else if (term) {
      goTo(searchUrl(term));
    }
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) onOpen();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    }
  };

  /* Esc: first press clears and closes the panel, keeping focus in the
     field; a second press blurs it. */
  const handleRootKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (isOpen || query) {
      reset();
      onClose();
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
    }
  };

  /* Desktop: tabbing out of the field and panel closes it. */
  const handleRootBlur = (event) => {
    if (!isDesktop) return;
    if (!event.currentTarget.contains(event.relatedTarget)) onClose();
  };

  const activeId = isOpen && highlight >= 0 ? `${baseId}-opt-${highlight}` : undefined;
  const countMessage = !term || searching ? '' : error ? '' : `${flat.length} result${flat.length === 1 ? '' : 's'}`;

  let optionIndex = -1;

  return (
    <div
      data-menu-root="search"
      onKeyDown={handleRootKeyDown}
      onBlur={handleRootBlur}
      className={isDesktop ? 'relative min-w-[240px] flex-[0_1_400px]' : 'w-full'}
    >
      <form role="search" onSubmit={handleSubmit}>
        <label htmlFor={`${baseId}-input`} className="sr-only">
          Search players, teams and heroes
        </label>
        <div
          className={`flex items-center gap-2 rounded-full border border-border bg-input pl-3.5 pr-3 transition-colors focus-within:border-accent-secondary-border-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-secondary-light ${
            isDesktop ? 'h-10' : 'h-11'
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-muted">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            id={`${baseId}-input`}
            type="search"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-expanded={isOpen}
            aria-controls={panelId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            value={query}
            placeholder={scope.placeholder}
            onFocus={onOpen}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(-1);
              if (!isOpen) onOpen();
            }}
            onKeyDown={handleInputKeyDown}
            className={`min-w-0 flex-1 bg-transparent text-primary placeholder:text-muted outline-none ${
              isDesktop ? 'text-[14px]' : 'text-[1rem]'
            }`}
          />
          {isDesktop && !query && (
            <kbd
              aria-hidden="true"
              className="shrink-0 rounded border border-border px-1.5 font-mono text-[10px] font-bold leading-4 text-muted"
            >
              /
            </kbd>
          )}
        </div>
      </form>

      <p aria-live="polite" className="sr-only">
        {isOpen ? countMessage : ''}
      </p>

      {mounted && (
        <div
          id={panelId}
          /* Clicks inside the panel keep focus in the field. */
          onMouseDown={(event) => event.preventDefault()}
          className={`rounded-lg border border-border-light bg-panel p-3 ${
            isDesktop
              ? 'absolute right-0 top-[52px] z-40 w-[400px] max-w-[calc(100vw-2rem)] shadow-heavy'
              : 'mt-2'
          } ${closing ? 'nav-pop-out pointer-events-none' : 'nav-pop-in'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p id={`${baseId}-scope`} className={SECTION_LABEL}>
                Search in
              </p>
              <div role="group" aria-labelledby={`${baseId}-scope`} className="mt-2 flex flex-wrap gap-1.5">
                {SCOPES.map((s) => {
                  const selected = s.id === scopeId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setScopeId(s.id);
                        inputRef.current?.focus();
                      }}
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-semibold transition-colors ${
                        selected
                          ? 'border-accent-border bg-accent-bg text-accent-light'
                          : 'border-border bg-input text-secondary hover:bg-hover hover:text-primary'
                      } ${FOCUS_RING}`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {!isDesktop && (
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
                  inputRef.current?.blur();
                }}
                className={`inline-flex min-h-9 shrink-0 items-center rounded-full border border-border bg-input px-3 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover hover:text-primary ${FOCUS_RING}`}
              >
                Close
              </button>
            )}
          </div>

          {!term && isDesktop && (
            <p className="mt-3 text-[12px] font-medium text-muted">
              Type a name to search. Press / from anywhere to jump here.
            </p>
          )}

          {term && (
            <div className="mt-3">
              {flat.length > 0 && (
                <ul id={listboxId} role="listbox" aria-label="Search results" className="scroll-thin max-h-72 space-y-2 overflow-y-auto">
                  {groups.map((group) => (
                    <li key={group.type} role="presentation">
                      <p id={`${baseId}-g-${group.type}`} className={`px-2 pb-1 ${SECTION_LABEL}`}>
                        {group.label}
                      </p>
                      <ul role="group" aria-labelledby={`${baseId}-g-${group.type}`}>
                        {group.items.map((result) => {
                          optionIndex += 1;
                          const index = optionIndex;
                          const active = index === highlight;
                          return (
                            <li
                              key={`${result.type}-${result.url}`}
                              id={`${baseId}-opt-${index}`}
                              role="option"
                              aria-selected={active}
                              onMouseEnter={() => setHighlight(index)}
                              onClick={() => goTo(result.url)}
                              className={`cursor-pointer truncate rounded-md px-2 py-1.5 text-[14px] font-semibold text-primary transition-colors ${
                                active ? 'bg-hover' : ''
                              }`}
                            >
                              {result.text}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {searching && <p className="mt-2 px-2 text-[12px] font-medium text-muted">Searching…</p>}

              {!searching && error && (
                <p className="px-2 text-[12px] font-medium text-muted">Search isn't responding. Try again in a moment.</p>
              )}

              {!searching && !error && flat.length === 0 && (
                <p className="px-2 text-[12px] font-medium text-muted">
                  No matches for “{term}”. Try a different spelling or{' '}
                  <Link
                    to={searchUrl(term)}
                    onClick={(event) => {
                      event.preventDefault();
                      goTo(searchUrl(term));
                    }}
                    className={`text-accent-secondary-light hover:underline ${FOCUS_RING}`}
                  >
                    search everything
                  </Link>
                  .
                </p>
              )}

              <div className="mt-3 border-t border-border pt-2">
                <Link
                  to={searchUrl(term)}
                  onClick={(event) => {
                    event.preventDefault();
                    goTo(searchUrl(term));
                  }}
                  className={`flex min-h-9 items-center rounded-md px-2 text-[13px] font-semibold text-accent-secondary-light hover:bg-hover ${FOCUS_RING}`}
                >
                  <span className="truncate">
                    Search {scope.noun} for “{term}”
                  </span>
                  <span aria-hidden="true" className="shrink-0">
                    &nbsp;→
                  </span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
