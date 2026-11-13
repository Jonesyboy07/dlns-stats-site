import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StreamStatusStrip from './StreamStatusStrip';
import { getStreamStatus } from '../utils/api';
import SettingsMenu, { SettingsButton } from './SettingsMenu';
import { NAV, isSectionActive } from './nav/navConfig';
import NavMenuButton from './nav/NavMenuButton';
import NavDropdown from './nav/NavDropdown';
import NavPanel from './nav/NavPanel';
import NavLink from './nav/NavLink';
import HeaderSearch from './nav/HeaderSearch';
import { FOCUS_RING } from './nav/navStyles';

const DESKTOP_QUERY = '(min-width: 1024px)';
const darkModeStorageKey = 'dlns.matchlist.darkMode';

/** Stored darker-theme choice. Read before the first paint, so the theme does
 *  not flash light for a frame on reload. */
function readDarkMode() {
  try {
    return localStorage.getItem(darkModeStorageKey) === '1';
  } catch {
    return false;
  }
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

function Wordmark({ onClick }) {
  return (
    <Link to="/home" onClick={onClick} className={`flex shrink-0 items-center gap-2.5 rounded-md ${FOCUS_RING}`} title="Home">
      <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
      <span className="font-valve-pulp text-[20px] font-bold text-primary">DLNS Stats</span>
    </Link>
  );
}

/**
 * DLNS Header — Night Shift and Stats menus, a Community link, search and
 * settings. One row from `lg` up; three stacked rows with inline panels below.
 * Nav content comes from nav/navConfig.js so both layouts stay in sync.
 */
function DLNS_Header({ className = '' }) {
  /* null | 'nightShift' | 'stats' | 'search' | 'settings' — one at a time. */
  const [openMenu, setOpenMenu] = useState(null);
  const [user, setUser] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [matchDarkMode, setMatchDarkMode] = useState(readDarkMode);
  const [stream, setStream] = useState(undefined);
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const triggerRefs = useRef({});

  useEffect(() => {
    fetch('/auth/api/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setUser(data.ok ? data.user : null))
      .catch(() => setUser(null));
  }, []);

  /* /auth/api/me has no admin flag; /admin/api/access does. Only asked once
     someone is signed in. */
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return undefined;
    }
    let cancelled = false;
    fetch('/admin/api/access', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setIsAdmin(Boolean(data?.is_admin));
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* Twitch state for the strip: undefined = loading, null = request failed. */
  useEffect(() => {
    let cancelled = false;

    getStreamStatus()
      .then((data) => {
        if (!cancelled) setStream(data);
      })
      .catch(() => {
        if (!cancelled) setStream(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('matchlist-theme-dark', matchDarkMode);

    try {
      localStorage.setItem(darkModeStorageKey, matchDarkMode ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }

    return () => {
      root.classList.remove('matchlist-theme-dark');
    };
  }, [matchDarkMode]);

  // Close any open menu on navigation.
  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname]);

  /* Esc closes the open menu and returns focus to its trigger. The search
     field handles its own Esc (it keeps focus in the field). */
  useEffect(() => {
    if (!openMenu || openMenu === 'search') return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      const menu = openMenu;
      setOpenMenu(null);
      const variant = isDesktop ? 'desktop' : 'mobile';
      triggerRefs.current[`${variant}-${menu}`]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMenu, isDesktop]);

  /* Desktop only: a click outside the open menu closes it. Mobile panels sit
     in the page flow and close from their trigger instead. */
  useEffect(() => {
    if (!openMenu || !isDesktop) return undefined;
    const onDown = (event) => {
      const root = event.target.closest?.('[data-menu-root]');
      if (root?.dataset.menuRoot !== openMenu) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenu, isDesktop]);

  const toggle = (id) => setOpenMenu((current) => (current === id ? null : id));
  const close = () => setOpenMenu(null);
  const setTrigger = (key) => (el) => {
    triggerRefs.current[key] = el;
  };

  const { pathname } = location;
  const menuGroups = NAV.filter((group) => group.columns);

  const settingsProps = {
    user,
    isAdmin,
    darkMode: matchDarkMode,
    onToggleDark: () => setMatchDarkMode((current) => !current),
    onNavigate: close,
  };

  const searchProps = {
    isOpen: openMenu === 'search',
    onOpen: () => setOpenMenu('search'),
    onClose: () => setOpenMenu((current) => (current === 'search' ? null : current)),
  };

  return (
    <header
      className={`sticky top-0 z-30 w-full border-b border-border bg-base-glass text-primary shadow-panel backdrop-blur-[10px] ${className}`}
    >
      {/* ── Desktop (lg and up) ── */}
      <div className="hidden lg:block">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <Wordmark onClick={close} />

          <nav aria-label="Main" className="flex items-center gap-0.5">
            {NAV.map((group) => {
              const active = isSectionActive(group, pathname);
              if (!group.columns) {
                return (
                  <NavLink key={group.id} to={group.to} label={group.label} isActive={active} onClick={close} />
                );
              }
              const menuId = `nav-desktop-${group.id}`;
              const isOpen = openMenu === group.id;
              return (
                <div key={group.id} data-menu-root={group.id} className="relative">
                  <NavMenuButton
                    ref={setTrigger(`desktop-${group.id}`)}
                    label={group.label}
                    isOpen={isOpen}
                    isSectionActive={active}
                    onToggle={() => toggle(group.id)}
                    controlsId={menuId}
                  />
                  <NavDropdown
                    id={menuId}
                    group={group}
                    variant={group.columns.length > 1 ? 'columns' : 'list'}
                    isOpen={isOpen}
                    onNavigate={close}
                  />
                </div>
              );
            })}
          </nav>

          <div className="flex-1" />

          <div className="flex min-w-0 items-center gap-2">
            <HeaderSearch variant="desktop" {...searchProps} />
            <SettingsMenu
              {...settingsProps}
              variant="desktop"
              isOpen={openMenu === 'settings'}
              onToggle={() => toggle('settings')}
              buttonRef={setTrigger('desktop-settings')}
            />
          </div>
        </div>
      </div>

      {/* ── Tablet and phone (below lg) ── */}
      <div className="lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark onClick={close} />
          <SettingsButton
            ref={setTrigger('mobile-settings')}
            isOpen={openMenu === 'settings'}
            onToggle={() => toggle('settings')}
            controlsId="settings-mobile"
          />
        </div>

        {/* Settings opens inline, directly under the top bar. */}
        <div className="px-4">
          <SettingsMenu {...settingsProps} variant="mobile" isOpen={openMenu === 'settings'} />
        </div>

        <div className="px-4 pt-3">
          <HeaderSearch variant="mobile" {...searchProps} />
        </div>

        <nav aria-label="Main" className="flex flex-wrap gap-1.5 p-3">
          {NAV.map((group) => {
            const active = isSectionActive(group, pathname);
            if (!group.columns) {
              return (
                <NavLink
                  key={group.id}
                  variant="mobile"
                  to={group.to}
                  label={group.label}
                  isActive={active}
                  onClick={close}
                />
              );
            }
            return (
              <NavMenuButton
                key={group.id}
                ref={setTrigger(`mobile-${group.id}`)}
                variant="mobile"
                label={group.label}
                isOpen={openMenu === group.id}
                isSectionActive={active}
                onToggle={() => toggle(group.id)}
                controlsId={`nav-mobile-${group.id}`}
              />
            );
          })}

          {/* Inline panel for the open menu, on its own row under the chips. */}
          {menuGroups.map((group) => (
            <NavPanel
              key={group.id}
              id={`nav-mobile-${group.id}`}
              group={group}
              isOpen={openMenu === group.id}
              onNavigate={close}
            />
          ))}
        </nav>
      </div>

      {/* Stream status — rendered on every page. Skipped entirely when the
          status request failed so it never claims an unknown state. */}
      {stream !== null && <StreamStatusStrip stream={stream} />}
    </header>
  );
}

export default DLNS_Header;
