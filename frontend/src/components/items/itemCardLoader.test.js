import { describe, expect, it } from "vitest";
import { MAX_IDS_PER_REQUEST, createItemCardLoader } from "./itemCardLoader";

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return handler(url);
  };
  fn.calls = calls;
  return fn;
}

const ok = (items) => ({ ok: true, json: async () => ({ items }) });

describe("createItemCardLoader", () => {
  it("folds requests made in one tick into a single call", async () => {
    const fetchFn = fakeFetch(() => ok({ 1: { item: { id: 1 } }, 2: { item: { id: 2 } } }));
    const loader = createItemCardLoader(fetchFn);
    let notified = 0;
    loader.subscribe(() => (notified += 1));

    loader.request(1);
    loader.request(2);
    loader.request(1);
    expect(loader.get(1)).toBeUndefined();
    await loader.settle();

    expect(fetchFn.calls).toEqual(["/db/items/cards?ids=1,2"]);
    expect(loader.get(1)).toEqual({ item: { id: 1 } });
    expect(notified).toBe(1);
  });

  it("does not re-request a loaded id", async () => {
    const fetchFn = fakeFetch(() => ok({ 5: { item: { id: 5 } } }));
    const loader = createItemCardLoader(fetchFn);
    loader.request(5);
    await loader.settle();
    loader.request("5");
    await loader.settle();
    expect(fetchFn.calls).toHaveLength(1);
  });

  it("marks unknown ids and failures as null", async () => {
    const loader = createItemCardLoader(fakeFetch(() => ok({})));
    loader.request(9);
    await loader.settle();
    expect(loader.get(9)).toBeNull();

    const failing = createItemCardLoader(fakeFetch(() => ({ ok: false, status: 503 })));
    failing.request(3);
    await failing.settle();
    expect(failing.get(3)).toBeNull();
  });

  it("ignores invalid ids", async () => {
    const fetchFn = fakeFetch(() => ok({}));
    const loader = createItemCardLoader(fetchFn);
    loader.request(null);
    loader.request(0);
    loader.request("abc");
    await loader.settle();
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("splits large batches", async () => {
    const fetchFn = fakeFetch(() => ok({}));
    const loader = createItemCardLoader(fetchFn);
    for (let id = 1; id <= MAX_IDS_PER_REQUEST + 1; id += 1) loader.request(id);
    await loader.settle();
    expect(fetchFn.calls).toHaveLength(2);
  });
});
