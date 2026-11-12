// Real IndexedDB transactions and browser restarts against the synthetic GitHub fixture.
import { chromium } from "playwright";
import { build } from "vite-plus";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const scratch = resolve(".superpowers/sdd/2026-11-12-grove-clients-workspaces");
await mkdir(scratch, { recursive: true });
const entry = join(scratch, "cache-browser.ts");
await writeFile(
  entry,
  [
    `export { BrowserCache } from ${JSON.stringify(resolve("apps/web/src/cache.ts"))};`,
    `export { VaultSession } from ${JSON.stringify(resolve("packages/github-vault/src/sync.ts"))};`,
    `export { VaultStore } from ${JSON.stringify(resolve("packages/github-vault/src/store.ts"))};`,
    `export { createFakeGitHub } from ${JSON.stringify(resolve("scripts/fake-github.mjs"))};`,
  ].join("\n"),
);
let code;
try {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: { write: false, minify: false, lib: { entry, name: "GroveCacheQA", formats: ["iife"] } },
  });
  const chunks = (Array.isArray(output) ? output : [output])
    .flatMap((output) => output.output)
    .filter((item) => item.type === "chunk");
  assert.equal(chunks.length, 1);
  code = chunks[0].code;
} finally {
  await unlink(entry);
}
const profile = await mkdtemp(join(tmpdir(), "grove-cache-qa-"));
let context;
const errors = [];
async function open() {
  context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true });
  await context.route("https://grove-cache.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: route.request().url().endsWith("bundle.js")
        ? "application/javascript"
        : "text/html",
      body: route.request().url().endsWith("bundle.js")
        ? code
        : '<!doctype html><title>Grove cache fixture</title><script src="/bundle.js"></script>',
    });
  });
  const page = context.pages()[0];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("https://grove-cache.test/");
  return page;
}
try {
  let page = await open();
  await page.evaluate(async () => {
    const { BrowserCache, VaultSession, VaultStore, createFakeGitHub } = window.GroveCacheQA;
    const ref = { owner: "fixture", repo: "vault", branch: "main" };
    const fake = createFakeGitHub({ "a.md": "base" });
    const cache = new BrowserCache(ref),
      store = new VaultStore(ref, "fake-only", { fetch: fake.fetch });
    const session = new VaultSession(store, cache);
    const base = await session.read("a.md");
    fake.set("image.png", new Uint8Array([1]));
    const oldTree = await session.list();
    fake.set("image.png", new Uint8Array([2]));
    await session.assetBytes("image.png");
    await cache.putTree(oldTree);
    fake.offline = true;
    const first = await session.write("a.md", "first", base.hash);
    if (first.status !== "saved") throw new Error("First local save failed");
    const second = await session.write("a.md", "newest", first.document.hash);
    if (second.status !== "saved") throw new Error("Coalesced save failed");
    const pending = await cache.pending();
    if (pending.length !== 1 || pending[0].content !== "newest" || pending[0].baseSha !== base.hash)
      throw new Error("Original base/newest edit not retained");
    await cache.close();
  });
  await context.close();
  page = await open();
  const result = await page.evaluate(async () => {
    const { BrowserCache, VaultSession, VaultStore, createFakeGitHub } = window.GroveCacheQA;
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const ref = { owner: "fixture", repo: "vault", branch: "main" };
    const fake = createFakeGitHub({ "a.md": "base" });
    const cache = new BrowserCache(ref),
      other = new BrowserCache({ ...ref, repo: "other" });
    const store = new VaultStore(ref, "fake-only", { fetch: fake.fetch, device: "browser" });
    const session = new VaultSession(store, cache);
    fake.offline = true;
    check(
      (await session.read("a.md")).content === "newest",
      "Queued text lost across browser restart",
    );
    check(
      (await session.assetBytes("image.png"))[0] === 2,
      "Opened asset pointer lost after an older tree refresh or restart",
    );
    const base = await cache.getDocument("a.md");
    check(new TextDecoder().decode(await cache.getBlob(base.hash)) === "base", "SHA cache lost");
    check(
      (await session.list()).some((entry) => entry.path === "a.md"),
      "Cached tree lost",
    );
    check(
      (await other.pending()).length === 0 && (await other.getBlob(base.hash)) === undefined,
      "Vault roots leaked",
    );
    fake.offline = false;
    let entered, release;
    const entering = new Promise((resolve) => {
        entered = resolve;
      }),
      blocked = new Promise((resolve) => {
        release = resolve;
      });
    fake.beforeWrite = async () => {
      fake.beforeWrite = undefined;
      entered();
      await blocked;
    };
    const before = (await cache.pending())[0];
    const uploading = session.syncNow();
    await entering;
    const newest = await session.write("a.md", "typed during upload", before.revision);
    check(newest.status === "saved", "Concurrent local edit rejected");
    release();
    check((await uploading).state === "syncing", "Pending newer edit reported as synced");
    const pending = (await cache.pending())[0];
    check(
      pending.content === "typed during upload" && pending.baseSha !== base.hash,
      "Older acknowledgement removed or failed to rebase newer edit",
    );
    const reloaded = new BrowserCache(ref),
      restarted = new VaultSession(store, reloaded);
    check(
      (await restarted.read("a.md")).content === "typed during upload",
      "Reopened cache lost concurrent edit",
    );
    check((await restarted.syncNow()).state === "synced", "Rebased edit did not sync");
    check(fake.text("a.md") === "typed during upload", "Newest content did not reach fake GitHub");
    const current = await reloaded.getDocument("a.md");
    await reloaded.ack("a.md", before.revision, {
      baseSha: base.hash,
      document: { ...base, content: "old acknowledgement" },
      rebase: true,
    });
    check(
      (await reloaded.getDocument("a.md")).hash === current.hash,
      "Late acknowledgement rolled cached text backward",
    );
    const contenders = await Promise.all([
      session.write("a.md", "tab one", current.hash),
      restarted.write("a.md", "tab two", current.hash),
    ]);
    check(
      contenders.filter((value) => value.status === "saved").length === 1 &&
        contenders.filter((value) => value.status === "conflict").length === 1,
      "Concurrent tabs overwrote each other",
    );
    const queued = (await reloaded.pending())[0],
      originalDocument = await reloaded.getDocument("a.md");
    // oxlint-disable-next-line typescript/unbound-method -- Called with apply and restored after the rollback probe.
    const originalDelete = IDBObjectStore.prototype.delete;
    let rejected = false;
    try {
      IDBObjectStore.prototype.delete = function (...args) {
        if (this.name === "pending") throw new Error("Fixture storage failure");
        return originalDelete.apply(this, args);
      };
      await reloaded.ack("a.md", queued.revision, {
        baseSha: queued.baseSha,
        document: { ...current, content: "must roll back", hash: "f".repeat(40) },
        rebase: true,
      });
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
    check(rejected, "Storage failure did not reject acknowledgement");
    check(
      (await reloaded.pending())[0].revision === queued.revision &&
        (await reloaded.getDocument("a.md")).hash === originalDocument.hash,
      "Aborted acknowledgement did not roll both stores back",
    );
    fake.protected = true;
    check(
      (await restarted.syncNow()).state === "error" &&
        (await reloaded.pending())[0].revision === queued.revision,
      "Server rejection discarded queued work",
    );
    fake.protected = false;
    fake.set("a.md", "other device");
    const conflict = await restarted.syncNow();
    check(
      conflict.state === "conflict" &&
        fake.text(conflict.conflicts[0]) === queued.content &&
        fake.text("a.md") === "other device",
      "Conflict did not preserve both versions",
    );
    await cache.close();
    await reloaded.close();
    await other.close();
    return "restart, SHA/tree cache, root isolation, upload/edit race, rebase, stale ack, cross-tab compare, real transaction rollback, server rejection, conflict preservation";
  });
  assert.deepEqual(errors, []);
  console.log(`PASS: real Chromium IndexedDB ${result}. Profile: ${profile}`);
} finally {
  await context?.close();
}
