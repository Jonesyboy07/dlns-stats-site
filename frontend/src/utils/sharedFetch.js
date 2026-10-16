/**
 * Shares read-only /db/* requests across the app.
 *
 * Pages each fetch the same dictionaries (heroes, items, weeks, players...). This
 * dedupes identical in-flight GETs and keeps successful answers for a short time, so
 * moving between pages shows data instantly instead of waiting on the network again.
 * Callers keep using plain fetch(); each gets its own cloned Response.
 */

const TTL_MS = 30_000;
const MAX_ENTRIES = 200;
const SHAREABLE = /^\/db\//;
const NEVER_SHARE = /^\/db\/(help-config|site-banner|stream\/status)|\/bans$/;

const entries = new Map();

function keyFor(input, init) {
  const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  if (method !== 'GET' || init?.body || init?.signal || (typeof input === 'object' && input?.signal)) {
    return null;
  }
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!SHAREABLE.test(url.pathname) || NEVER_SHARE.test(url.pathname)) return null;
  return url.pathname + url.search;
}

export function installSharedFetch() {
  if (typeof window === 'undefined' || window.__sharedFetchInstalled) return;
  window.__sharedFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    const key = keyFor(input, init);
    if (!key) return nativeFetch(input, init);

    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < TTL_MS) {
      return hit.promise.then((res) => res.clone());
    }

    const promise = nativeFetch(input, init).then((res) => {
      if (!res.ok) entries.delete(key);
      return res;
    });
    promise.catch(() => entries.delete(key));

    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    entries.set(key, { at: now, promise });
    return promise.then((res) => res.clone());
  };
}
