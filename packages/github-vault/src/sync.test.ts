import { expect, it } from "vite-plus/test";
import { VaultSession } from "./sync";
import { VaultStore } from "./store";
import { MemoryCache } from "./test-cache";
import { createFakeGitHub } from "../../../scripts/fake-github.mjs";
const ref = { owner: "test", repo: "vault", branch: "main" };
it("keeps the newest offline edit across a session restart", async () => {
  const fake = createFakeGitHub({ "a.md": "base" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  const cache = new MemoryCache(store.root);
  const session = new VaultSession(store, cache);
  const base = await session.read("a.md");
  fake.offline = true;
  const saved = await session.write("a.md", "first", base.hash);
  if (saved.status !== "saved") throw new Error("Expected durable local save");
  await session.write("a.md", "newest", saved.document.hash);
  const restarted = new VaultSession(store, cache);
  expect((await restarted.read("a.md")).content).toBe("newest");
  fake.offline = false;
  expect((await restarted.syncNow()).state).toBe("synced");
  expect(fake.text("a.md")).toBe("newest");
});

function setup(seed: Record<string, string> = { "a.md": "base" }) {
  const fake = createFakeGitHub(seed);
  const store = new VaultStore(ref, "test", { fetch: fake.fetch, device: "phone" });
  const cache = new MemoryCache(store.root);
  return { fake, store, cache, session: new VaultSession(store, cache) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function save(session: VaultSession, path: string, content: string, hash: string) {
  const result = await session.write(path, content, hash);
  if (result.status !== "saved") throw new Error("Expected local save");
  return result.document;
}

it("keeps a newer revision when an older upload is acknowledged, then syncs it without a false conflict", async () => {
  const { fake, store, cache, session } = setup();
  const base = await session.read("a.md");
  const first = await save(session, "a.md", "first", base.hash);
  const entered = deferred(),
    release = deferred();
  fake.beforeWrite = async () => {
    fake.beforeWrite = undefined;
    entered.resolve();
    await release.promise;
  };
  const uploading = session.syncNow();
  await entered.promise;
  const second = await save(session, "a.md", "newest", first.hash);
  release.resolve();
  expect((await uploading).state).toBe("syncing");
  const pending = await cache.pending();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    revision: second.hash,
    content: "newest",
    baseSha: (await store.read("a.md")).hash,
  });
  const restarted = new VaultSession(store, cache);
  expect((await restarted.read("a.md")).content).toBe("newest");
  expect((await restarted.syncNow()).state).toBe("synced");
  expect(fake.text("a.md")).toBe("newest");
  expect((await store.list()).filter((entry) => entry.path.includes("conflict"))).toHaveLength(0);
});

it("preserves both versions using create-if-absent conflict names including collisions", async () => {
  const { fake, store, cache, session } = setup();
  const base = await session.read("a.md");
  await save(session, "a.md", "mine", base.hash);
  fake.set("a.md", "remote");
  const date = new Date(),
    day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const occupied = `a (conflict phone ${day}).md`;
  fake.set(occupied, "earlier copy");
  const status = await session.syncNow();
  expect(status.state).toBe("conflict");
  expect(status.conflicts).toEqual([`a (conflict phone ${day}) 2.md`]);
  expect(fake.text(occupied)).toBe("earlier copy");
  expect(fake.text(status.conflicts[0])).toBe("mine");
  expect(fake.text("a.md")).toBe("remote");
  expect(await cache.pending()).toHaveLength(0);
  fake.offline = true;
  expect((await session.read(status.conflicts[0])).content).toBe("mine");
  expect((await session.read("a.md")).content).toBe("remote");
  expect((await session.list()).map((entry) => entry.path)).toContain(status.conflicts[0]);
  await expect(store.head()).rejects.toMatchObject({ kind: "offline" });
});

it("does not rebase a newer pending edit onto a conflicting remote revision", async () => {
  const { fake, cache, session } = setup();
  const base = await session.read("a.md");
  const first = await save(session, "a.md", "first", base.hash);
  fake.set("a.md", "remote");
  const entered = deferred(),
    release = deferred();
  fake.beforeWrite = async (path) => {
    if (!path.includes("conflict")) return;
    fake.beforeWrite = undefined;
    entered.resolve();
    await release.promise;
  };
  const syncing = session.syncNow();
  await entered.promise;
  const newest = await save(session, "a.md", "newest", first.hash);
  release.resolve();
  await syncing;
  expect((await cache.pending())[0]).toMatchObject({ baseSha: base.hash, revision: newest.hash });
  await session.syncNow();
  expect(fake.text("a.md")).toBe("remote");
  expect((await cache.getTree())?.filter((entry) => entry.path.includes("conflict"))).toHaveLength(
    2,
  );
});

it("keeps remotely deleted notes recoverable without overwriting the deletion", async () => {
  const { fake, cache, session } = setup();
  const base = await session.read("a.md");
  await save(session, "a.md", "mine", base.hash);
  fake.delete("a.md");
  const status = await session.syncNow();
  expect(status.state).toBe("conflict");
  expect(fake.text("a.md")).toBeUndefined();
  expect(fake.text(status.conflicts[0])).toBe("mine");
  expect(await cache.pending()).toHaveLength(0);
});

it("retains pending content on network, permission, rate-limit and storage failures", async () => {
  const { fake, cache, session } = setup();
  const base = await session.read("a.md");
  await save(session, "a.md", "mine", base.hash);
  fake.offline = true;
  expect((await session.syncNow()).state).toBe("offline");
  fake.offline = false;
  fake.protected = true;
  expect((await session.syncNow()).state).toBe("error");
  fake.protected = false;
  fake.faults.push({ status: 429, headers: { "retry-after": "20" } });
  expect((await session.syncNow()).state).toBe("error");
  expect((await cache.pending())[0].content).toBe("mine");
  const oldQueue = cache.queue.bind(cache);
  cache.queue = async () => {
    throw new Error("Quota exceeded");
  };
  const current = await session.read("a.md");
  await expect(session.write("a.md", "not saved", current.hash)).rejects.toThrow("Quota exceeded");
  cache.queue = oldQueue;
  expect((await cache.pending())[0].content).toBe("mine");
});

it("acknowledges a lost successful response without creating an unnecessary conflict copy", async () => {
  const { fake, cache, session } = setup();
  const base = await session.read("a.md");
  await save(session, "a.md", "mine", base.hash);
  fake.afterWrite = () => {
    fake.afterWrite = undefined;
    throw new TypeError("Connection lost after acceptance");
  };
  expect((await session.syncNow()).state).toBe("offline");
  expect((await cache.pending())[0].content).toBe("mine");
  expect((await session.syncNow()).state).toBe("synced");
  expect(await cache.pending()).toHaveLength(0);
  expect((await session.list()).filter((entry) => entry.path.includes("conflict"))).toHaveLength(0);
});

it("creates offline files durably, handles existing remote destinations and never deletes pending edits", async () => {
  const { fake, session, cache } = setup();
  fake.offline = true;
  const document = await session.create("notes/new.md", "offline new");
  expect(document.hash).toMatch(/^local:/);
  expect((await session.list()).map((entry) => entry.path)).toEqual(["notes", "notes/new.md"]);
  await expect(session.remove("notes/new.md")).rejects.toMatchObject({ kind: "conflict" });
  fake.set("notes/new.md", "another device");
  fake.offline = false;
  const status = await session.syncNow();
  expect(status.state).toBe("conflict");
  expect(fake.text("notes/new.md")).toBe("another device");
  expect(fake.text(status.conflicts[0])).toBe("offline new");
  expect(await cache.pending()).toHaveLength(0);
});

it("rejects stale local saves, caches binary assets by the actual SHA and isolates vault roots", async () => {
  const { fake, store, cache, session } = setup();
  const base = await session.read("a.md");
  await save(session, "a.md", "new", base.hash);
  expect(await session.write("a.md", "stale", base.hash)).toMatchObject({
    status: "conflict",
    disk: { content: "new" },
  });
  fake.set("asset.png", new Uint8Array([0, 255, 5]));
  expect(await session.assetBytes("asset.png")).toEqual(new Uint8Array([0, 255, 5]));
  fake.offline = true;
  expect(await session.assetBytes("asset.png")).toEqual(new Uint8Array([0, 255, 5]));
  expect(() => new VaultSession(store, new MemoryCache("other"))).toThrow(/different vault/);
  expect(await cache.pending()).toHaveLength(1);
});

it("does not let a stale acknowledgement roll cached content back after a newer upload", async () => {
  const { cache, session } = setup();
  const base = await session.read("a.md");
  const first = await save(session, "a.md", "first", base.hash);
  await cache.ack("a.md", first.hash, {
    baseSha: base.hash,
    document: { ...base, hash: "1".repeat(40), content: "first" },
    rebase: true,
  });
  const next = await save(session, "a.md", "newest", "1".repeat(40));
  await cache.ack("a.md", next.hash, {
    baseSha: "1".repeat(40),
    document: { ...base, hash: "2".repeat(40), content: "newest" },
    rebase: true,
  });
  await cache.ack("a.md", first.hash, {
    baseSha: base.hash,
    document: { ...base, hash: "1".repeat(40), content: "first" },
    rebase: true,
  });
  expect((await cache.getDocument("a.md"))?.content).toBe("newest");
});

it("does not let an old in-flight read replace text saved and uploaded after it started", async () => {
  const fake = createFakeGitHub({ "a.md": "base" });
  const entered = deferred(),
    release = deferred();
  let delay = false;
  const transport: typeof fetch = async (input, init) => {
    const response = await fake.fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (delay && url.includes("/git/blobs/")) {
      delay = false;
      entered.resolve();
      await release.promise;
    }
    return response;
  };
  const store = new VaultStore(ref, "test", { fetch: transport });
  const cache = new MemoryCache(store.root),
    session = new VaultSession(store, cache);
  const base = await session.read("a.md");
  delay = true;
  const stale = session.read("a.md");
  await entered.promise;
  await save(session, "a.md", "newest", base.hash);
  await session.syncNow();
  release.resolve();
  expect((await stale).content).toBe("newest");
  expect((await cache.getDocument("a.md"))?.content).toBe("newest");
});

it("serializes flushes and isolates failing listeners from durable saves", async () => {
  const { session, cache } = setup();
  const base = await session.read("a.md");
  const unsubscribe = session.onChange(() => {
    throw new Error("Observer failed");
  });
  const saved = await save(session, "a.md", "mine", base.hash);
  expect((await cache.pending())[0].revision).toBe(saved.hash);
  const one = session.syncNow(),
    two = session.syncNow();
  expect(one).toBe(two);
  await one;
  unsubscribe();
});

it("keeps opened binary assets available offline even after an older tree refresh", async () => {
  const { fake, cache, session } = setup();
  fake.set("asset.png", new Uint8Array([1]));
  const oldTree = await session.list();
  fake.set("asset.png", new Uint8Array([2]));
  expect(await session.assetBytes("asset.png")).toEqual(new Uint8Array([2]));
  await cache.putTree(oldTree);
  fake.offline = true;
  expect(await session.assetBytes("asset.png")).toEqual(new Uint8Array([2]));
});

it("opens cached notes and trees when a response body disconnects after headers", async () => {
  const fake = createFakeGitHub({ "a.md": "base" });
  let failBody = false;
  const transport: typeof fetch = async (input, init) => {
    if (failBody)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("Network failed after headers"));
          },
        }),
      );
    return fake.fetch(input, init);
  };
  const store = new VaultStore(ref, "test", { fetch: transport });
  const cache = new MemoryCache(store.root),
    session = new VaultSession(store, cache);
  await session.read("a.md");
  await session.list();
  failBody = true;
  expect((await session.read("a.md")).content).toBe("base");
  expect((await session.list()).map((entry) => entry.path)).toEqual(["a.md"]);
});

it("opens cached text when only a binary response body disconnects after headers", async () => {
  const fake = createFakeGitHub({ "a.md": "base" });
  let failBody = false;
  const transport: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (failBody && url.includes("/git/blobs/"))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("Network failed after headers"));
          },
        }),
      );
    return fake.fetch(input, init);
  };
  const store = new VaultStore(ref, "test", { fetch: transport });
  const session = new VaultSession(store, new MemoryCache(store.root));
  await session.read("a.md");
  failBody = true;
  expect((await session.read("a.md")).content).toBe("base");
});
