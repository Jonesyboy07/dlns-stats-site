import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StreamStatusStrip from './StreamStatusStrip';
import { getStreamStatus } from '../utils/api';

/**
 * DLNS Header — responsive navigation with hamburger menu for mobile.
 */
function DLNS_Header({ className = "" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(undefined);
  const [matchDarkMode, setMatchDarkMode] = useState(false);
  const [stream, setStream] = useState(undefined);
  const location = useLocation();
  const darkModeStorageKey = 'dlns.matchlist.darkMode';

  useEffect(() => {
    fetch('/auth/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setUser(data.ok ? data.user : null))
      .catch(() => setUser(null));
  }, []);

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
    try {
      setMatchDarkMode(localStorage.getItem(darkModeStorageKey) === '1');
    } catch {
      setMatchDarkMode(false);
    }
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

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  /* No "Home" item: the wordmark beside the nav already links to /home, so a
     nav entry next to it would be a duplicate affordance. */
  const primaryNav = [
    { path: "/matchlist", label: "Matches" },
    { path: "/players", label: "Players" },
    { path: "/teams", label: "Teams" },
    { path: "/heroes", label: "Heroes" },
    { path: "/stats", label: "Stats" },
    { path: "/community", label: "Community" },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <header className={`sticky top-0 z-30 w-full border-b border-border bg-base-glass text-primary shadow-panel backdrop-blur-[10px] ${className}`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-16">
          {/* Brand + Desktop nav together on the left */}
          <div className="flex items-center gap-4">
            <Link to="/home" className="flex shrink-0 items-center gap-2.5" title="Home">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <span className="font-valve-pulp text-[20px] font-bold text-primary">
                DLNS Stats
              </span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-0.5">
              {primaryNav.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`rounded-full px-3.5 py-[7px] font-valve-oracle text-[15px] font-medium tracking-[.02em] transition-colors ${
                    isActive(item.path)
                      ? 'bg-accent-bg-strong text-accent-light'
                      : 'text-secondary hover:bg-hover hover:text-primary'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Spacer pushes auth/toggle to the right */}
          <div className="flex-1" />

          {/* Auth + Hamburger */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMatchDarkMode((current) => !current)}
              className="hidden sm:inline-flex items-center rounded-full border border-border-light bg-white/5 p-0.5 text-xs font-semibold text-secondary transition-colors hover:bg-hover"
              aria-pressed={matchDarkMode}
              title="Toggle dark mode"
              style={{ width: '62px', height: '28px', position: 'relative' }}
            >
              <span style={{
                position: 'absolute',
                left: matchDarkMode ? '2px' : undefined,
                right: matchDarkMode ? undefined : '2px',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: matchDarkMode ? '#1e293b' : '#fbbf24',
                transition: 'all 0.25s ease',
                zIndex: 1,
                boxShadow: matchDarkMode ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.2)',
              }} />
              <span style={{ position: 'relative', zIndex: 2, width: '100%', display: 'flex', justifyContent: 'space-around', alignItems: 'center', lineHeight: 1 }}>
                <span style={{ opacity: matchDarkMode ? 1 : 0.4, transition: 'opacity 0.2s' }}>🌙</span>
                <span style={{ opacity: matchDarkMode ? 0.4 : 1, transition: 'opacity 0.2s' }}>☀️</span>
              </span>
            </button>

            {/* Auth desktop */}
            <div className="hidden sm:flex items-center gap-3">
              {user === undefined ? null : user ? (
                <>
                  <span className="text-secondary text-sm truncate max-w-[120px]">{user.username}</span>
                  <a href="/auth/logout" className="text-dim hover:text-primary text-xs transition-colors">Logout</a>
                </>
              ) : (
                <a href="/auth/login" className="bg-accent hover:opacity-90 text-[#170a26] text-[13px] font-bold px-3 py-1.5 rounded-xl transition-opacity">
                  Login
                </a>
              )}
            </div>

            {/* Hamburger button */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="sm:hidden p-2 text-secondary hover:text-primary rounded-md hover:bg-hover transition-colors"
              aria-label="Toggle menu"
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="sm:hidden border-t border-border bg-base">
          <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1">
            {primaryNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`block px-3 py-2 text-sm font-medium rounded-full transition-colors ${
                  isActive(item.path)
                    ? 'bg-accent-bg-strong text-accent-light'
                    : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <hr className="border-border my-2" />
            <button
              type="button"
              onClick={() => setMatchDarkMode((current) => !current)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium rounded-full transition-colors text-secondary hover:text-primary hover:bg-hover"
              aria-pressed={matchDarkMode}
            >
              <span className="text-sm">Appearance</span>
              <span className="flex items-center gap-1.5 text-xs">
                <span style={{ opacity: matchDarkMode ? 1 : 0.4 }}>🌙</span>
                <span style={{
                  display: 'inline-block',
                  width: '36px',
                  height: '20px',
                  borderRadius: '10px',
                  background: matchDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                  position: 'relative',
                  transition: 'background 0.25s',
                  verticalAlign: 'middle',
                }}>
                  <span style={{
                    position: 'absolute',
                    top: '2px',
                    left: matchDarkMode ? '16px' : '2px',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: matchDarkMode ? '#1e293b' : '#fbbf24',
                    transition: 'all 0.25s ease',
                    boxShadow: matchDarkMode ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </span>
                <span style={{ opacity: matchDarkMode ? 0.4 : 1 }}>☀️</span>
              </span>
            </button>
            {/* Auth mobile */}
            {user === undefined ? null : user ? (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-secondary text-sm">{user.username}</span>
                <a href="/auth/logout" className="text-dim hover:text-primary text-xs transition-colors">Logout</a>
              </div>
            ) : (
              <a href="/auth/login" className="block px-3 py-2 text-sm font-medium text-accent-light hover:text-primary transition-colors">
                Login
              </a>
            )}
          </nav>
        </div>
      )}

      {/* Stream status — rendered on every page. Skipped entirely when the
          status request failed so it never claims an unknown state. */}
      {stream !== null && <StreamStatusStrip stream={stream} />}
    </header>
  );
}

export default DLNS_Header;
