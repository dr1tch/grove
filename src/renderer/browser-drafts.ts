import type { WorkingTab } from "../shared/recovery";
type Draft = { path: string; value: string; original: string };
type Locks = Pick<LockManager, "request" | "query">;
// Each browser tab owns its new-note drafts under its own key, so one tab never erases
// another's. A held lock marks the owner alive; drafts of closed tabs are claimed on load.
const prefix = (root: string) => `grove:web:new-drafts:${root}:`;
let owner: string | undefined;
let claiming: Promise<string> | undefined;

function tabId(session: Storage, locks?: Locks): Promise<string> {
  return (claiming ??= (async () => {
    let id = session.getItem("grove:web:tab") ?? crypto.randomUUID();
    // A duplicated tab copies sessionStorage, so take a fresh id when the lock is taken.
    while (
      locks &&
      !(await new Promise<boolean>((held) => {
        void locks.request(`grove-tab:${id}`, { ifAvailable: true }, (lock) => {
          held(!!lock);
          return lock ? new Promise<never>(() => {}) : undefined;
        });
      }))
    )
      id = crypto.randomUUID();
    session.setItem("grove:web:tab", id);
    return (owner = id);
  })());
}

export function writeBrowserDrafts(storage: Storage, root: string, tabs: WorkingTab[]) {
  if (!owner) return;
  const drafts: Draft[] = tabs
    .filter((tab) => tab.path.startsWith("draft://"))
    .map((tab) => ({ path: tab.path, value: tab.value, original: tab.doc.content }));
  if (drafts.length) storage.setItem(prefix(root) + owner, JSON.stringify(drafts));
  else storage.removeItem(prefix(root) + owner);
}

const parse = (raw: string | null): Draft[] => {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(values)
      ? values.filter(
          (value): value is Draft =>
            !!value &&
            typeof value === "object" &&
            typeof value.path === "string" &&
            /^draft:\/\/[a-z\d-]+\.md$/i.test(value.path) &&
            typeof value.value === "string" &&
            typeof value.original === "string",
        )
      : [];
  } catch {
    return [];
  }
};

export async function readBrowserDrafts(
  storage: Storage,
  root: string,
  session: Storage = sessionStorage,
  locks: Locks | undefined = globalThis.navigator?.locks,
): Promise<WorkingTab[]> {
  const id = await tabId(session, locks);
  const claim = async () => {
    const alive = new Set(
      ((await locks?.query())?.held ?? []).map((lock) => lock.name?.replace(/^grove-tab:/, "")),
    );
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(
      (key) => key.startsWith(prefix(root)) && !alive.has(key.slice(prefix(root).length)),
    );
    const mine = prefix(root) + id;
    const drafts = new Map<string, Draft>();
    for (const key of [mine, ...keys.filter((key) => key !== mine)])
      for (const draft of parse(storage.getItem(key)))
        if (!drafts.has(draft.path)) drafts.set(draft.path, draft);
    if (drafts.size) storage.setItem(mine, JSON.stringify([...drafts.values()]));
    for (const key of keys) if (key !== mine) storage.removeItem(key);
    return [...drafts.values()];
  };
  const drafts = locks ? await locks.request(`grove-drafts:${root}`, claim) : await claim();
  return drafts.map((draft) => ({
    id: crypto.randomUUID(),
    path: draft.path,
    value: draft.value,
    kind: "markdown" as const,
    mode: "edit" as const,
    doc: { path: draft.path, content: draft.original, hash: "", modified: 0 },
  }));
}
