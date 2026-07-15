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
    <header className={`w-full bg-slate-800/90 text-white shadow-panel ${className}`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14">
          {/* Brand + Desktop nav together on the left */}
          <div className="flex items-center gap-4">
            <Link to="/home" className="shrink-0 flex items-center" title="Home">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
                <rect x="2" y="12" width="24" height="4" rx="1" fill="#ae7afc" transform="rotate(-12 14 14)"></rect>
                <rect x="5" y="19" width="18" height="4" rx="1" fill="#cb8eff" transform="rotate(-12 14 21)"></rect>
                <rect x="8" y="5" width="12" height="4" rx="1" fill="#00c57c" transform="rotate(-12 14 7)"></rect>
              </svg>
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
          </div>

          {/* Spacer pushes auth/toggle to the right */}
          <div className="flex-1" />

          {/* Auth + Hamburger */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMatchDarkMode((current) => !current)}
              className="hidden sm:inline-flex items-center rounded-full border border-white/10 bg-white/5 p-0.5 text-xs font-semibold text-white/90 hover:bg-white/10 transition-colors"
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
            <button
              type="button"
              onClick={() => setMatchDarkMode((current) => !current)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium rounded-md transition-colors text-white/80 hover:text-white hover:bg-white/10"
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
