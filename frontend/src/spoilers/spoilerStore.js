import { useSyncExternalStore } from "react";

/*
 * Spoiler-free mode state, persisted in localStorage so every page (and every
 * React entry bundle) shares it:
 *   - enabled:  master switch
 *   - revealed: ids the user has clicked to reveal while the mode is on
 */
const KEY = "dlns.spoilerFree.v1";
const DEFAULT = { enabled: false, revealed: [] };

const listeners = new Set();
let state = read();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") {
      return {
        enabled: raw.enabled === true,
        revealed: Array.isArray(raw.revealed) ? raw.revealed.map(String) : [],
      };
    }
  } catch {
    // Unreadable storage: fall back to the default.
  }
  return DEFAULT;
}

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the in-memory state still applies.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  // Keep other tabs in sync.
  const onStorage = (e) => {
    if (e.key === KEY) {
      state = read();
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => state;

export function useSpoilerState() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT);
}

export function setSpoilerFree(enabled) {
  // Switching the mode starts from a clean slate of reveals.
  commit({ enabled: !!enabled, revealed: [] });
}

export function revealSpoiler(id) {
  const key = String(id);
  if (state.revealed.includes(key)) return;
  commit({ ...state, revealed: [...state.revealed, key] });
}

export function hideSpoiler(id) {
  const key = String(id);
  commit({ ...state, revealed: state.revealed.filter((k) => k !== key) });
}

/** True when the value for `id` should currently be hidden. Usable outside React. */
export function isSpoilerHidden(id) {
  return state.enabled && !state.revealed.includes(String(id));
}

/**
 * Headers for API calls so the backend can omit spoiler data when it supports
 * it. Empty when the mode is off, so normal requests are unchanged.
 */
export function spoilerHeaders() {
  return state.enabled ? { "X-Spoiler-Free": "1" } : {};
}
