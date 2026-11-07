import React, { useEffect, useRef, useState } from "react";
import { useSpoilerState, setSpoilerFree } from "../spoilers/spoilerStore";

function Switch({ on }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </span>
  );
}

function Row({ label, hint, on, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-primary">{label}</span>
        {hint && <span className="block text-[11px] text-dim">{hint}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

/**
 * Settings dropdown for the top bar: account (login / logout), dark mode and
 * spoiler-free mode in one place.
 */
export default function SettingsMenu({ user, darkMode, onToggleDark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { enabled: spoilerFree } = useSpoilerState();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          open
            ? "border-accent-border bg-accent-bg-strong text-accent-light"
            : "border-border-light bg-white/5 text-secondary hover:bg-hover hover:text-primary"
        }`}
      >
        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 3.3a1.7 1.7 0 013.4 0l.2.9a1.7 1.7 0 002.4 1.1l.8-.4a1.7 1.7 0 012.4 2.4l-.4.8a1.7 1.7 0 001.1 2.4l.9.2a1.7 1.7 0 010 3.4l-.9.2a1.7 1.7 0 00-1.1 2.4l.4.8a1.7 1.7 0 01-2.4 2.4l-.8-.4a1.7 1.7 0 00-2.4 1.1l-.2.9a1.7 1.7 0 01-3.4 0l-.2-.9a1.7 1.7 0 00-2.4-1.1l-.8.4a1.7 1.7 0 01-2.4-2.4l.4-.8a1.7 1.7 0 00-1.1-2.4l-.9-.2a1.7 1.7 0 010-3.4l.9-.2a1.7 1.7 0 001.1-2.4l-.4-.8a1.7 1.7 0 012.4-2.4l.8.4a1.7 1.7 0 002.4-1.1l.2-.9z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-border bg-panel p-1.5 shadow-panel"
        >
          <div className="px-3 pb-2 pt-1.5">
            {user === undefined ? null : user ? (
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-primary">{user.username}</span>
                <a href="/auth/logout" className="shrink-0 text-xs text-dim transition-colors hover:text-primary">
                  Logout
                </a>
              </div>
            ) : (
              <a
                href="/auth/login"
                className="block rounded-xl bg-accent px-3 py-1.5 text-center text-[13px] font-bold text-[#170a26] transition-opacity hover:opacity-90"
              >
                Login
              </a>
            )}
          </div>
          <div className="my-1 border-t border-border" />
          <Row label="Dark mode" on={darkMode} onClick={onToggleDark} />
          <Row
            label="Spoiler-free"
            hint="Hide winners, scores and team names"
            on={spoilerFree}
            onClick={() => setSpoilerFree(!spoilerFree)}
          />
        </div>
      )}
    </div>
  );
}
