import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * DLNS Header — responsive navigation with hamburger menu for mobile.
 */
function DLNS_Header({ className = "" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(undefined);
  const [matchDarkMode, setMatchDarkMode] = useState(false);
  const location = useLocation();
  const darkModeStorageKey = 'dlns.matchlist.darkMode';

  const showMatchThemeToggle =
    location.pathname === '/' ||
    location.pathname === '/matchlist' ||
    location.pathname.startsWith('/match/') ||
    location.pathname.startsWith('/series/') ||
    location.pathname === '/week' ||
    location.pathname.startsWith('/week/');

  useEffect(() => {
    fetch('/auth/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setUser(data.ok ? data.user : null))
      .catch(() => setUser(null));
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
    root.classList.toggle('matchlist-theme-dark', matchDarkMode && showMatchThemeToggle);

    try {
      localStorage.setItem(darkModeStorageKey, matchDarkMode ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }

    return () => {
      root.classList.remove('matchlist-theme-dark');
    };
  }, [matchDarkMode, showMatchThemeToggle]);

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const primaryNav = [
    { path: "/", label: "Matches" },
    { path: "/players", label: "Players" },
    { path: "/teams", label: "Teams" },
    { path: "/heroes", label: "Heroes" },
    { path: "/stats", label: "Stats" },
    { path: "/community", label: "Community" },
  ];

  const secondaryNav = [
    { path: "/sounds", label: "Sounds" },
    { path: "/sounds-dev", label: "Sounds Dev" },
    { path: "/vo", label: "VO Hub" },
    { path: "/vo-admin", label: "VO Admin" },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <header className={`w-full bg-slate-800/90 text-white shadow-panel ${className}`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <Link to="/" className="text-lg font-bold text-white shrink-0">
            DLNS Stats
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            {primaryNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isActive(item.path)
                    ? 'text-purple-300 bg-purple-500/15'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Auth + Hamburger */}
          <div className="flex items-center gap-3">
            {showMatchThemeToggle && (
              <button
                type="button"
                onClick={() => setMatchDarkMode((current) => !current)}
                className="hidden sm:inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/10 transition-colors"
                aria-pressed={matchDarkMode}
                title="Toggle darker match theme"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${matchDarkMode ? 'bg-emerald-300' : 'bg-slate-500'}`} />
                {matchDarkMode ? 'Lighten matches' : 'Darker matches'}
              </button>
            )}

            {/* Auth desktop */}
            <div className="hidden sm:flex items-center gap-3">
              {user === undefined ? null : user ? (
                <>
                  <span className="text-white/70 text-sm truncate max-w-[120px]">{user.username}</span>
                  <a href="/auth/logout" className="text-white/60 hover:text-white text-xs transition-colors">Logout</a>
                </>
              ) : (
                <a href="/auth/login" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors">
                  Login
                </a>
              )}
            </div>

            {/* Hamburger button */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="sm:hidden p-2 text-white/80 hover:text-white rounded-md hover:bg-white/10 transition-colors"
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
        <div className="sm:hidden border-t border-white/10 bg-slate-800/95">
          <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1">
            {primaryNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`block px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive(item.path)
                    ? 'text-purple-300 bg-purple-500/15'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <hr className="border-white/10 my-2" />
            <p className="px-3 text-xs text-white/40 uppercase tracking-wider font-semibold">More</p>
            {secondaryNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`block px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive(item.path)
                    ? 'text-purple-300 bg-purple-500/15'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <hr className="border-white/10 my-2" />
            {showMatchThemeToggle && (
              <button
                type="button"
                onClick={() => setMatchDarkMode((current) => !current)}
                className="block w-full px-3 py-2 text-left text-sm font-medium rounded-md transition-colors text-white/80 hover:text-white hover:bg-white/10"
                aria-pressed={matchDarkMode}
              >
                {matchDarkMode ? 'Lighten matches' : 'Darker matches'}
              </button>
            )}
            {/* Auth mobile */}
            {user === undefined ? null : user ? (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-white/70 text-sm">{user.username}</span>
                <a href="/auth/logout" className="text-white/60 hover:text-white text-xs transition-colors">Logout</a>
              </div>
            ) : (
              <a href="/auth/login" className="block px-3 py-2 text-sm font-medium text-indigo-300 hover:text-white transition-colors">
                Login
              </a>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

export default DLNS_Header;
