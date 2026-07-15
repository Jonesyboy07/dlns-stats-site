import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { logout } from '../utils/api';

const darkModeStorageKey = 'dlns.matchlist.darkMode';

export function Header({
  onRecordClick,
  isAuthenticated,
  onNormalizeChange,
  onAutoplayChange,
  normalize,
  autoplay,
  volume,
  boostDb,
  onVolumeChange,
  onBoostChange,
  searchValue,
  onSearchChange,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    try {
      setDarkMode(localStorage.getItem(darkModeStorageKey) === '1');
    } catch {
      setDarkMode(false);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('matchlist-theme-dark', darkMode);
    try {
      localStorage.setItem(darkModeStorageKey, darkMode ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }
  }, [darkMode]);

  return (
    <header className="header" style={{
      background: 'linear-gradient(180deg, rgba(22, 22, 34, 0.4), transparent)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(10px)',
      padding: '16px 20px',
    }}>
      <div className="wrap" style={{ width: '100%', padding: 0 }}>
        <div style={{
          maxWidth: '1600px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontWeight: 700,
            fontSize: '18px',
            background: 'linear-gradient(90deg, #1db954, #00d8ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              background: '#1db954',
              borderRadius: '50%',
              animation: 'pulse 2s infinite',
            }}></div>
            <span>DLNS-stats</span>
          </div>

          <div className="search" style={{
            flex: 1,
            maxWidth: '400px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '20px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <input
              type="text"
              placeholder="Search audio…"
              value={searchValue || ''}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                flex: 1,
                outline: 'none',
                fontSize: '14px',
              }}
            />
          </div>

          <div className="header-actions" style={{
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}>
            {onAutoplayChange && (
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                cursor: 'pointer',
                color: '#b2b2b8',
              }}>
                <input
                  type="checkbox"
                  checked={autoplay}
                  onChange={(e) => onAutoplayChange(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Autoplay
              </label>
            )}

            {onNormalizeChange && (
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                cursor: 'pointer',
                color: '#b2b2b8',
              }}>
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => onNormalizeChange(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Normalize
              </label>
            )}

            {isAuthenticated && onRecordClick && (
              <button
                onClick={onRecordClick}
                style={{
                  background: 'linear-gradient(90deg, #1db954, #1ed760)',
                  border: 'none',
                  color: '#000',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.boxShadow = '0 10px 30px rgba(29, 185, 84, 0.3)';
                  e.target.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.boxShadow = 'none';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                🎙️ Record
              </button>
            )}

            {isAuthenticated && (
              <button
                onClick={() => logout()}
                style={{
                  background: 'rgba(255, 68, 68, 0.16)',
                  border: '1px solid rgba(255, 68, 68, 0.3)',
                  color: '#ff4444',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(255, 68, 68, 0.24)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(255, 68, 68, 0.16)';
                }}
              >
                🚪 Logout
              </button>
            )}

            <button
              onClick={() => setDarkMode((current) => !current)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '60px',
                height: '32px',
                position: 'relative',
                transition: 'all 0.2s ease',
              }}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.12)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
            >
              <span style={{
                position: 'absolute',
                left: darkMode ? '4px' : undefined,
                right: darkMode ? undefined : '4px',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: darkMode ? '#1e293b' : '#fbbf24',
                transition: 'all 0.25s ease',
                zIndex: 1,
                boxShadow: darkMode ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.2)',
              }} />
              <span style={{ position: 'relative', zIndex: 2, width: '100%', display: 'flex', justifyContent: 'space-around', alignItems: 'center', fontSize: '13px', lineHeight: 1 }}>
                <span style={{ opacity: darkMode ? 1 : 0.4, transition: 'opacity 0.2s' }}>🌙</span>
                <span style={{ opacity: darkMode ? 0.4 : 1, transition: 'opacity 0.2s' }}>☀️</span>
              </span>
            </button>

            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSettings(!showSettings)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#ffffff',
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.12)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
              >
                ⚙️
              </button>

              {showSettings && (
                <div style={{ position: 'absolute', right: 0, top: '48px', width: '240px', background: 'rgba(12,12,18,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', zIndex: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '13px' }}>Playback</span>
                    <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: '#7a7a82', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', color: '#b2b2b8', marginBottom: '6px', fontWeight: 600 }}>Volume</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="range" min="0" max="100" value={volume} onChange={(e) => onVolumeChange && onVolumeChange(Number(e.target.value))} style={{ flex: 1 }} />
                      <span style={{ fontSize: '12px', color: '#dcdce0', minWidth: '40px', textAlign: 'right' }}>{volume}%</span>
                    </div>
                  </div>

                  <div style={{ marginBottom: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#b2b2b8', marginBottom: '6px', fontWeight: 600 }}>Boost</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="range" min="0" max="12" value={boostDb} onChange={(e) => onBoostChange && onBoostChange(Number(e.target.value))} style={{ flex: 1 }} />
                      <span style={{ fontSize: '12px', color: '#dcdce0', minWidth: '40px', textAlign: 'right' }}>{boostDb} dB</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
