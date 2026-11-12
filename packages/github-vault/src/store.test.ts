import { expect, it } from "vite-plus/test";
import { VaultStore } from "./store";
import { createFakeGitHub } from "../../../scripts/fake-github.mjs";

const ref = { owner: "test", repo: "vault", branch: "main" };
it("lists, reads and conditionally writes Unicode files without exposing metadata", async () => {
  const path = "dir/Café #[1] 🌱.md";
  const fake = createFakeGitHub({ [path]: "# Before", ".folio/history/private.md": "hidden" });
  const store = new VaultStore(ref, "fake-token", { fetch: fake.fetch, device: "test" });
  expect((await store.list()).map((entry) => entry.path)).toEqual(["dir", path]);
  const before = await store.read(path);
  expect(before.content).toBe("# Before");
  expect((await store.write(path, "# After", before.hash)).status).toBe("saved");
  fake.set(path, "# Elsewhere");
  const conflict = await store.write(path, "# Mine", before.hash);
  expect(conflict.status).toBe("conflict");
  expect((await store.read(path)).content).toBe("# Elsewhere");
});

it("sends credentials only to the fixed API origin and refuses redirects", async () => {
  const fake = createFakeGitHub({ "Note.md": "text" });
  const store = new VaultStore(ref, "fake-token", { fetch: fake.fetch });
  await store.read("Note.md");
  expect(
    fake.requests.every(
      (request) =>
        new URL(request.url).origin === "https://api.github.com" &&
        request.headers.authorization === "Bearer fake-token" &&
        request.redirect === "error" &&
        request.credentials === "omit" &&
        request.cache === "no-store",
    ),
  ).toBe(true);
  expect(JSON.stringify(store)).not.toContain("fake-token");
  fake.faults.push({ status: 302, headers: { location: "https://elsewhere.test/leak" } });
  const before = fake.requests.length;
  await expect(store.head()).rejects.toMatchObject({ kind: "no-access" });
  expect(fake.requests).toHaveLength(before + 1);
});

it("distinguishes auth, missing access, missing paths, protected branches and rate limits", async () => {
  for (const [status, kind, headers] of [
    [401, "auth", {}],
    [403, "no-access", {}],
    [404, "not-found", {}],
    [422, "rejected", {}],
    [429, "rate-limit", { "retry-after": "30" }],
    [403, "rate-limit", { "x-ratelimit-remaining": "0" }],
  ] as const) {
    const fake = createFakeGitHub();
    fake.faults.push({ status, headers });
    await expect(new VaultStore(ref, "test", { fetch: fake.fetch }).head()).rejects.toMatchObject({
      kind,
      status,
    });
  }
  const fake = createFakeGitHub({ "a.md": "a" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  const before = await store.read("a.md");
  fake.protected = true;
  await expect(store.write("a.md", "new", before.hash)).rejects.toMatchObject({
    kind: "no-access",
  });
  expect(fake.text("a.md")).toBe("a");
});

it("completes truncated recursive trees through full subtrees and refuses incomplete directories", async () => {
  const fake = createFakeGitHub({ "a/b/one.md": "one", "a/two.md": "two", "root.md": "root" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  const complete = (await store.list()).map((entry) => entry.path);
  fake.truncated = true;
  expect((await store.list()).map((entry) => entry.path)).toEqual(complete);
  fake.truncatedDirectories = true;
  await expect(store.list()).rejects.toMatchObject({ kind: "rejected" });
});

it("never overwrites a create/rename destination and keeps both copies after interrupted rename", async () => {
  const fake = createFakeGitHub({ "a.md": "original", "b.md": "existing" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  await expect(store.create("a.md", "wrong")).rejects.toMatchObject({ kind: "conflict" });
  await expect(store.rename("a.md", "b.md")).rejects.toMatchObject({ kind: "conflict" });
  expect(fake.text("b.md")).toBe("existing");
  fake.beforeWrite = (path, method) => {
    if (path === "a.md" && method === "DELETE") fake.set(path, "changed during rename");
  };
  await expect(store.rename("a.md", "moved.md")).rejects.toThrow(/copy was created/);
  expect(fake.text("moved.md")).toBe("original");
  expect(fake.text("a.md")).toBe("changed during rename");
});

it("performs binary creation, safe removal and empty folders while rejecting folder moves/deletion", async () => {
  const fake = createFakeGitHub({ "dir/a.md": "a" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  const bytes = new Uint8Array([0, 255, 100, 1]);
  await store.createBytes("image.png", bytes);
  expect(await store.assetBytes("image.png")).toEqual(bytes);
  await store.mkdir("empty");
  expect((await store.list()).map((entry) => entry.path)).toContain("empty");
  expect((await store.list()).map((entry) => entry.path)).not.toContain("empty/.gitkeep");
  await expect(store.remove("dir")).rejects.toMatchObject({ kind: "rejected" });
  await expect(store.rename("dir", "new")).rejects.toMatchObject({ kind: "rejected" });
  await store.remove("image.png");
  expect(fake.text("image.png")).toBeUndefined();
});

it("rejects oversized files, unsafe paths and non-Git editor revisions before a write", async () => {
  const fake = createFakeGitHub({ "a.md": "a" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  for (const path of ["../a.md", "/a.md", "a//b.md", ".folio/private.md", "a\\b.md"])
    await expect(store.create(path, "no")).rejects.toBeInstanceOf(Error);
  await expect(store.write("a.md", "bad", "local:revision")).rejects.toBeInstanceOf(Error);
  await expect(
    store.createBytes("big.bin", new Uint8Array(50 * 1024 * 1024 + 1)),
  ).rejects.toMatchObject({ kind: "rejected" });
  expect(fake.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
});

it("preserves the caller base SHA during races and reports remote deletion as conflict", async () => {
  const fake = createFakeGitHub({ "a.md": "base" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch });
  const base = await store.read("a.md");
  fake.beforeWrite = (path) => {
    fake.beforeWrite = undefined;
    fake.set(path, "concurrent");
  };
  const result = await store.write("a.md", "mine", base.hash);
  expect(result).toMatchObject({ status: "conflict", disk: { content: "concurrent" } });
  expect(fake.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  fake.delete("a.md");
  expect(await store.write("a.md", "mine", base.hash)).toMatchObject({
    status: "conflict",
    disk: { hash: "", content: "" },
  });
});

it("reads historical bytes and skips deletion revisions instead of substituting current content", async () => {
  const fake = createFakeGitHub({ "a.md": "old" });
  const store = new VaultStore(ref, "test", { fetch: fake.fetch, device: "phone" });
  const base = await store.read("a.md");
  await store.write("a.md", "new", base.hash);
  fake.delete("a.md");
  expect((await store.versions("a.md")).map((version) => version.content)).toEqual(["new", "old"]);
  expect(fake.requests.find((request) => request.method === "PUT")?.body?.message).toMatch(
    /^Grove: phone \d{4}-\d\d-\d\dT/,
  );
});

it("validates malformed API responses and refuses symlink metadata", async () => {
  const badTree: typeof fetch = async (input) => {
    if (typeof input === "string" && input.includes("/commits/"))
      return new Response(
        JSON.stringify({ sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } }),
      );
    return new Response(
      JSON.stringify({
        tree: [
          { path: "../escape.md", mode: "100644", type: "blob", sha: "a".repeat(40), size: 1 },
        ],
        truncated: false,
      }),
    );
  };
  await expect(new VaultStore(ref, "test", { fetch: badTree }).list()).rejects.toMatchObject({
    kind: "rejected",
  });
  await expect(
    new VaultStore(ref, "test", {
      fetch: async () =>
        new Response(JSON.stringify({ type: "symlink", sha: "a".repeat(40), size: 1 })),
    }).read("link.md"),
  ).rejects.toMatchObject({ kind: "rejected" });
});

it("preserves malformed JSON and size failures as validation errors", async () => {
  const store = new VaultStore(ref, "test", { fetch: async () => new Response("not JSON") });
  await expect(store.head()).rejects.toMatchObject({ kind: "other" });
  const fake = createFakeGitHub({ "a.md": "base" });
  const transport: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/git/blobs/"))
      return new Response("x", { headers: { "content-length": String(51 * 1024 * 1024) } });
    return fake.fetch(input, init);
  };
  await expect(
    new VaultStore(ref, "test", { fetch: transport }).read("a.md"),
  ).rejects.toMatchObject({ kind: "rejected" });
});
