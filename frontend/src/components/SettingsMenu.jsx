import React, { forwardRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSpoilerState, setSpoilerFree } from "../spoilers/spoilerStore";
import { FOCUS_RING, SECTION_LABEL } from "./nav/navStyles";
import usePresence from "./nav/usePresence";

function Switch({ on }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ${
        on ? "border-accent-border bg-accent-bg" : "border-border bg-input"
      }`}
    >
      <span
        className={`absolute left-[2px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-transform duration-150 ease-out motion-reduce:transition-none ${
          on ? "translate-x-4 bg-accent-light" : "translate-x-0 bg-muted"
        }`}
      />
    </span>
  );
}

function SwitchRow({ label, hint, on, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left transition-colors hover:bg-hover ${FOCUS_RING}`}
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-primary">{label}</span>
        {hint && <span className="block text-[12px] font-medium text-muted">{hint}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

function LinkRow({ to, label, onNavigate }) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-[14px] font-semibold text-primary transition-colors hover:bg-hover ${FOCUS_RING}`}
    >
      {label}
      <span aria-hidden="true" className="text-muted">→</span>
    </Link>
  );
}

function Section({ label, children }) {
  return (
    <div className="border-t border-border pt-2 mt-2 first:mt-0 first:border-t-0 first:pt-0">
      <p className={`px-3 pb-1 pt-1 ${SECTION_LABEL}`}>{label}</p>
      {children}
    </div>
  );
}

function Avatar({ user }) {
  const [failed, setFailed] = useState(false);
  const src =
    user.avatar && user.id
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full bg-card object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[13px] font-bold text-accent-light"
    >
      {(user.username || "?").charAt(0).toUpperCase()}
    </span>
  );
}

function AccountSlot({ user, isAdmin }) {
  /* Still loading: render nothing in this slot. */
  if (user === undefined) return null;

  if (!user) {
    return (
      <div className="px-1.5 pb-2">
        <a
          href="/auth/login"
          className={`flex h-10 w-full items-center justify-center rounded-full border border-accent-border bg-accent-bg text-[14px] font-semibold text-accent-light transition-colors hover:bg-accent-bg-strong ${FOCUS_RING}`}
        >
          Login
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 pb-2 pt-1">
      <Avatar user={user} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-primary">{user.username}</span>
        <span className="block text-[12px] font-medium text-muted">{isAdmin ? "Admin" : "Signed in"}</span>
      </span>
      <a
        href="/auth/logout"
        className={`shrink-0 whitespace-nowrap rounded-md text-[13px] font-semibold text-accent-secondary-light hover:underline ${FOCUS_RING}`}
      >
        Logout
      </a>
    </div>
  );
}

/** Menu body: account, display switches and site links. Shared by both layouts. */
export function SettingsPanel({ id, user, isAdmin, darkMode, onToggleDark, onNavigate, variant = "desktop", isOpen }) {
  const { enabled: spoilerFree } = useSpoilerState();
  const { mounted, closing } = usePresence(isOpen);
  if (!mounted) return null;

  const isDesktop = variant === "desktop";
  const account = user === undefined ? null : <AccountSlot user={user} isAdmin={isAdmin} />;

  return (
    <div
      id={id}
      className={`rounded-lg border border-border-light bg-panel p-1.5 ${
        isDesktop ? "absolute right-0 top-[52px] z-40 w-[300px] shadow-heavy" : "w-full"
      } ${closing ? "nav-pop-out pointer-events-none" : "nav-pop-in"}`}
    >
      {/* The Display section's top rule divides it from the account row. */}
      {account && <div className="pt-1.5">{account}</div>}

      <Section label="Display">
        <SwitchRow label="Darker theme" on={darkMode} onClick={onToggleDark} />
        <SwitchRow
          label="Spoiler-free"
          hint="Hide winners, scores and team names"
          on={spoilerFree}
          onClick={() => setSpoilerFree(!spoilerFree)}
        />
      </Section>

      <Section label="Site">
        <LinkRow to="/updates" label="Site updates" onNavigate={onNavigate} />
        <LinkRow to="/help" label="Help" onNavigate={onNavigate} />
      </Section>

      {isAdmin && (
        <Section label="Admin">
          <LinkRow to="/react-admin" label="Admin tools" onNavigate={onNavigate} />
        </Section>
      )}
    </div>
  );
}

/** 44px round settings button. */
export const SettingsButton = forwardRef(function SettingsButton({ isOpen, onToggle, controlsId }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label="Settings"
      aria-expanded={isOpen}
      aria-controls={controlsId}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border transition-colors ${
        isOpen ? "bg-hover text-primary" : "bg-panel text-secondary hover:bg-hover hover:text-primary"
      } ${FOCUS_RING}`}
    >
      <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 3.3a1.7 1.7 0 013.4 0l.2.9a1.7 1.7 0 002.4 1.1l.8-.4a1.7 1.7 0 012.4 2.4l-.4.8a1.7 1.7 0 001.1 2.4l.9.2a1.7 1.7 0 010 3.4l-.9.2a1.7 1.7 0 00-1.1 2.4l.4.8a1.7 1.7 0 01-2.4 2.4l-.8-.4a1.7 1.7 0 00-2.4 1.1l-.2.9a1.7 1.7 0 01-3.4 0l-.2-.9a1.7 1.7 0 00-2.4-1.1l-.8.4a1.7 1.7 0 01-2.4-2.4l.4-.8a1.7 1.7 0 00-1.1-2.4l-.9-.2a1.7 1.7 0 010-3.4l.9-.2a1.7 1.7 0 001.1-2.4l-.4-.8a1.7 1.7 0 012.4-2.4l.8.4a1.7 1.7 0 002.4-1.1l.2-.9z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
});

/**
 * Settings for the header. Open state is owned by DLNS_Header so only one
 * menu is open at a time.
 *
 * - `desktop`: the button plus a 300px dropdown right-aligned under it.
 * - `mobile`: the inline panel only; the header renders `SettingsButton` in
 *   the top bar and places this panel directly under it.
 */
export default function SettingsMenu({
  user,
  isAdmin = false,
  darkMode,
  onToggleDark,
  isOpen,
  onToggle,
  onNavigate,
  buttonRef,
  variant = "desktop",
  id = `settings-${variant}`,
}) {
  const panel = (
    <SettingsPanel
      id={id}
      user={user}
      isAdmin={isAdmin}
      darkMode={darkMode}
      onToggleDark={onToggleDark}
      onNavigate={onNavigate}
      variant={variant}
      isOpen={isOpen}
    />
  );

  if (variant === "mobile") return panel;

  return (
    <div data-menu-root="settings" className="relative">
      <SettingsButton ref={buttonRef} isOpen={isOpen} onToggle={onToggle} controlsId={id} />
      {panel}
    </div>
  );
}
