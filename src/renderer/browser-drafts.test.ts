import { expect, it, vi } from "vite-plus/test";
import type { WorkingTab } from "../shared/recovery";

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}
// Minimal LockManager: held named locks mark live tabs.
function locks(held: Set<string>) {
  return {
    async request(name: string, a: unknown, b?: unknown) {
      const callback = (typeof a === "function" ? a : b) as (lock: unknown) => unknown;
      if (typeof a === "object" && held.has(name)) return callback(null);
      if (typeof a === "object") held.add(name);
      return callback({ name });
    },
    async query() {
      return { held: [...held].map((name) => ({ name })), pending: [] };
    },
  } as unknown as LockManager;
}
const draft = (path: string, value: string) =>
  ({ path, value, doc: { content: "" } }) as unknown as WorkingTab;

it("keeps another tab's drafts and recovers them once that tab is gone", async () => {
  const local = memory(),
    held = new Set<string>();
  // Tab A saves a draft.
  vi.resetModules();
  const a = await import("./browser-drafts");
  await a.readBrowserDrafts(local, "v", memory(), locks(held));
  a.writeBrowserDrafts(local, "v", [draft("draft://one.md", "A text")]);
  // Tab B, with no drafts, writes while A is alive: A's draft survives and B does not take it.
  vi.resetModules();
  const b = await import("./browser-drafts");
  expect(await b.readBrowserDrafts(local, "v", memory(), locks(held))).toEqual([]);
  b.writeBrowserDrafts(local, "v", []);
  // Tab A closes (its lock is released); a newly loaded tab recovers the draft exactly once.
  held.delete([...held][0]); // Tab A's lock was taken first.
  vi.resetModules();
  const c = await import("./browser-drafts");
  const recovered = await c.readBrowserDrafts(local, "v", memory(), locks(held));
  expect(recovered.map((t) => t.value)).toEqual(["A text"]);
  vi.resetModules();
  const d = await import("./browser-drafts");
  expect(await d.readBrowserDrafts(local, "v", memory(), locks(held))).toEqual([]);
});

it("restores large drafts instead of dropping them", async () => {
  vi.resetModules();
  const m = await import("./browser-drafts");
  const local = memory(),
    session = memory(),
    held = new Set<string>();
  await m.readBrowserDrafts(local, "v", session, locks(held));
  m.writeBrowserDrafts(local, "v", [draft("draft://big.md", "x".repeat(2_200_000))]);
  vi.resetModules();
  const again = await import("./browser-drafts");
  held.clear();
  const [restored] = await again.readBrowserDrafts(local, "v", session, locks(held));
  expect(restored.value.length).toBe(2_200_000);
});
