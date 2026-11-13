/**
 * Batched, cached loader for `/db/items/cards`: the data a deadlock-api
 * `dl-item-card` needs (the upstream item plus its build paths), served from
 * our own cached catalogue so no visitor downloads deadlock-api's full ~6 MB
 * item list.
 *
 * Every `request()` made in the same tick is folded into one HTTP call, so a
 * page with forty item icons asks once. Results are kept for the page's life:
 * a card is `undefined` while unknown, an object once loaded, `null` when the
 * item doesn't exist or the request failed (callers then keep their fallback).
 */

export const MAX_IDS_PER_REQUEST = 200;

export function createItemCardLoader(fetchFn = (url) => fetch(url)) {
  const cards = new Map();
  const listeners = new Set();
  let queued = new Set();
  let scheduled = false;

  const notify = () => listeners.forEach((listener) => listener());

  async function fetchBatch(ids) {
    try {
      const res = await fetchFn(`/db/items/cards?ids=${ids.join(",")}`);
      if (!res.ok) throw new Error(`items/cards ${res.status}`);
      const data = await res.json();
      const items = data?.items || {};
      for (const id of ids) cards.set(id, items[String(id)] || null);
    } catch {
      for (const id of ids) cards.set(id, null);
    }
  }

  async function flush() {
    scheduled = false;
    const ids = [...queued];
    queued = new Set();
    const batches = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      batches.push(fetchBatch(ids.slice(i, i + MAX_IDS_PER_REQUEST)));
    }
    await Promise.all(batches);
    notify();
  }

  return {
    /** The card for `id`: undefined (not loaded yet), an object, or null. */
    get(id) {
      return cards.get(Number(id));
    },

    /** Ask for `id`; repeat and in-flight requests are free. */
    request(id) {
      const key = Number(id);
      if (!Number.isFinite(key) || key <= 0 || cards.has(key) || queued.has(key)) return;
      queued.add(key);
      if (!scheduled) {
        scheduled = true;
        // One tick: every icon rendered in this pass joins the same request.
        Promise.resolve().then(flush);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Resolves once everything queued so far has loaded (tests). */
    settle() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

export const itemCardLoader = createItemCardLoader();
