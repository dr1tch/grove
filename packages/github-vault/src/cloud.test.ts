// Runs against local Supabase (`npx supabase start`). Skipped when SUPABASE_URL is unset.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vite-plus/test";
import { CloudStore, blobSha } from "./cloud";
import { VaultSession } from "./sync";
import { MemoryCache } from "./test-cache";
import { GitHubError } from "./types";

const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY;

async function account() {
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const email = `qa-${crypto.randomUUID()}@grove.test`;
  const { data, error } = await db.auth.signUp({ email, password: crypto.randomUUID() });
  if (error || !data.user) throw error ?? new Error("No user");
  return { db, store: new CloudStore(db, data.user.id, "phone") };
}

describe.skipIf(!url || !key)("CloudStore on local Supabase", () => {
  it("matches Git blob hashes", async () => {
    // `printf hello | git hash-object --stdin`
    expect(await blobSha(new TextEncoder().encode("hello"))).toBe(
      "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",
    );
  });

  it("creates, reads, lists folders, saves and reports stale saves as conflicts", async () => {
    const { store } = await account();
    const created = await store.create("Notes/A.md", "first");
    await store.mkdir("Empty");
    const list = await store.list();
    expect(list.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      "folder:Empty",
      "folder:Notes",
      "markdown:Notes/A.md",
    ]);
    const saved = await store.write("Notes/A.md", "second", created.hash);
    if (saved.status !== "saved") throw new Error("expected save");
    const stale = await store.write("Notes/A.md", "from another device", created.hash);
    expect(stale.status).toBe("conflict");
    expect((await store.read("Notes/A.md")).content).toBe("second");
    await expect(store.create("Notes/A.md", "dupe")).rejects.toMatchObject({ kind: "conflict" });
    expect((await store.versions("Notes/A.md")).map((v) => v.content)).toEqual(["second", "first"]);
    expect(Number(await store.head())).toBeGreaterThan(0);
  });

  it("renames atomically and refuses an existing target", async () => {
    const { store } = await account();
    await store.create("a.md", "a");
    await store.create("b.md", "b");
    await expect(store.rename("a.md", "b.md")).rejects.toMatchObject({ kind: "conflict" });
    await store.rename("a.md", "c.md");
    expect((await store.list()).map((entry) => entry.path)).toEqual(["b.md", "c.md"]);
    await store.remove("b.md");
    await expect(store.read("b.md")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("never lets a file and a folder share a path", async () => {
    const { store, db } = await account();
    await store.create("Projects/a.md", "a");
    await store.create("x.md", "x");
    await expect(store.rename("x.md", "Projects")).rejects.toMatchObject({ kind: "conflict" });
    await expect(store.create("x.md/b.md", "b")).rejects.toMatchObject({ kind: "conflict" });
    await expect(store.create("Projects", "file")).rejects.toMatchObject({ kind: "conflict" });
    const bad = await db.rpc("vault_save", {
      p_path: "../escape.md",
      p_base: null,
      p_sha: "0".repeat(40),
      p_size: 0,
    });
    expect(bad.error).not.toBeNull();
    expect((await store.list()).map((entry) => entry.path)).toEqual([
      "Projects",
      "Projects/a.md",
      "x.md",
    ]);
  });

  it("only accepts content-addressed blob names", async () => {
    const { db, store } = await account();
    const upload = await db.storage
      .from("vaults")
      .upload(`${store.userId}/notes.txt`, new Blob(["x"]));
    expect(upload.error).not.toBeNull();
  });

  it("keeps each account's files private", async () => {
    const a = await account(),
      b = await account();
    const doc = await a.store.create("secret.md", "only mine");
    const rows = await b.db.from("vault_files").select("path").eq("user_id", a.store.userId);
    expect(rows.data).toEqual([]);
    const blob = await b.db.storage.from("vaults").download(`${a.store.userId}/${doc.hash}`);
    expect(blob.data).toBeNull();
    // B pretending to be A only reaches B's own rows.
    const spoof = new CloudStore(b.db, a.store.userId);
    await expect(spoof.read("secret.md")).rejects.toMatchObject({ kind: "not-found" });
    const upload = await b.db.storage
      .from("vaults")
      .upload(`${a.store.userId}/${"0".repeat(40)}`, new Blob(["x"]));
    expect(upload.error).not.toBeNull();
    expect((await a.store.read("secret.md")).content).toBe("only mine");
  });

  it("refuses rows that point at bytes that were never uploaded", async () => {
    const { db } = await account();
    const { error } = await db.rpc("vault_save", {
      p_path: "ghost.md",
      p_base: null,
      p_sha: "f".repeat(40),
      p_size: 1,
    });
    expect(error?.code).toBe("GR400");
  });

  it("syncs offline edits and keeps both versions on conflict through VaultSession", async () => {
    const { store } = await account();
    const base = await store.create("n.md", "base");
    const session = new VaultSession(store, new MemoryCache(store.root));
    expect((await session.read("n.md")).content).toBe("base");
    await store.write("n.md", "remote edit", base.hash);
    const local = await session.write("n.md", "local edit", base.hash);
    expect(local.status).toBe("saved");
    const status = await session.syncNow();
    expect(status.state).toBe("conflict");
    const paths = (await store.list()).map((entry) => entry.path);
    expect(paths).toContain("n.md");
    const copy = paths.find((path) => path.includes("(conflict phone"));
    expect(copy).toBeDefined();
    expect((await store.read(copy!)).content).toBe("local edit");
    expect((await store.read("n.md")).content).toBe("remote edit");
  });

  it("maps a signed-out client to an auth or access error, not a crash", async () => {
    const { db, store } = await account();
    await db.auth.signOut();
    const error = await store.create("x.md", "x").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GitHubError);
    expect(["auth", "no-access"]).toContain((error as GitHubError).kind);
  });
});

it("reports an unreachable server as offline so edits stay queued", async () => {
  const db = createClient("http://127.0.0.1:9", "anon", { auth: { persistSession: false } });
  const store = new CloudStore(db, crypto.randomUUID());
  await expect(store.list()).rejects.toMatchObject({ kind: "offline" });
  await expect(store.create("a.md", "a")).rejects.toMatchObject({ kind: "offline" });
}, 30_000); // supabase-js retries failed reads for about 7 s before reporting them.
