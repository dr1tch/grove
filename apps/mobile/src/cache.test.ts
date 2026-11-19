import { afterEach, describe, expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheConflict, uploadedFrom } from "@grove/github-vault/cache";
import { SQLiteVaultCache, type SQLiteAdapter, type SQLValue } from "./sqlite-cache";

const directories: string[] = [];
const databases: DatabaseSync[] = [];
function adapter(path = ":memory:"): SQLiteAdapter {
  const db = new DatabaseSync(path);
  databases.push(db);
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => db.prepare(sql).run(...params),
    getFirstSync: <T>(sql: string, ...params: SQLValue[]) =>
      (db.prepare(sql).get(...params) ?? null) as T | null,
    getAllSync: <T>(sql: string, ...params: SQLValue[]) => db.prepare(sql).all(...params) as T[],
    withTransactionSync(action) {
      db.exec("BEGIN");
      try {
        action();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
function cache(db = adapter(), root = "sample:grove") {
  return new SQLiteVaultCache(db, root, randomUUID);
}
const document = (hash: string, content = hash) => ({
  path: "Notes/été.md",
  hash,
  content,
  modified: 0,
});
afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      /* Already closed for reopen test. */
    }
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("native SQLite vault durability and concurrency", () => {
  it("recovers pending revisions, documents, trees and binary assets after reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grove-cache-"));
    directories.push(dir);
    const file = join(dir, "vault.db");
    const first = cache(adapter(file));
    await first.putDocument(document("base"));
    await first.putTree([
      {
        path: "Notes/été.md",
        name: "été.md",
        kind: "markdown",
        sha: "base",
        size: 4,
        modified: 0,
      },
    ]);
    await first.putAsset("image.png", {
      hash: "blob",
      bytes: new Uint8Array([0, 128, 255]),
    });
    const edit = await first.queue("Notes/été.md", "offline", "base", "base");
    databases.at(-1)!.close();
    const restored = cache(adapter(file));
    expect(await restored.pending()).toEqual([edit]);
    expect(await restored.getDocument("Notes/été.md")).toEqual(document("base"));
    expect((await restored.getTree())?.[0].path).toBe("Notes/été.md");
    expect(await restored.getAsset("image.png")).toEqual({
      hash: "blob",
      bytes: new Uint8Array([0, 128, 255]),
    });
  });

  it("allows only one concurrent CAS save and preserves the original remote base", async () => {
    const db = adapter();
    const a = cache(db),
      b = cache(db);
    await a.putDocument(document("base"));
    const results = await Promise.allSettled([
      a.queue("Notes/été.md", "first", "base", "base"),
      b.queue("Notes/été.md", "second", "base", "base"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const first = (await a.pending())[0];
    await expect(b.queue("Notes/été.md", "stale", "changed", "base")).rejects.toBeInstanceOf(
      CacheConflict,
    );
    const latest = await b.queue("Notes/été.md", "latest", "changed", first.revision);
    expect(latest.baseSha).toBe("base");
    expect(await a.putDocument(document("remote"), "base")).toBe(false);
    expect((await a.pending())[0]).toEqual(latest);
  });

  it("acks only the exact revision and rebases a newer edit through its own upload", async () => {
    const c = cache();
    await c.putDocument(document("base"));
    const sent = await c.queue("Notes/été.md", "sent", "base", "base");
    const newer = await c.queue("Notes/été.md", "newer", "base", sent.revision);
    expect(
      await c.ack(sent.path, sent.revision, {
        baseSha: "base",
        document: document("uploaded", "sent"),
        rebase: true,
      }),
    ).toBe(false);
    expect(await c.pending()).toEqual([{ ...newer, baseSha: "uploaded" }]);
    expect(
      await c.ack(sent.path, "unrelated", {
        baseSha: "different",
        document: document("conflict"),
        rebase: false,
      }),
    ).toBe(false);
    expect((await c.pending())[0].baseSha).toBe("uploaded");
    expect((await c.getDocument(sent.path))?.hash).toBe("uploaded");
    expect(
      await c.ack(newer.path, newer.revision, {
        baseSha: "uploaded",
        document: document("final", "newer"),
        rebase: true,
      }),
    ).toBe(true);
    const saved = await c.getDocument(newer.path);
    expect(uploadedFrom(saved)).toBe(newer.revision);
    expect(await c.pending()).toEqual([]);
    const next = await c.queue(newer.path, "continue typing", "old-base", newer.revision);
    expect(next.baseSha).toBe("final");
  });

  it("keeps blobs immutable, checks asset CAS and retains pending work when dropping a path", async () => {
    const c = cache();
    await c.putBlob("old", new Uint8Array([1]));
    await c.putBlob("old", new Uint8Array([2]));
    expect(await c.getBlob("old")).toEqual(new Uint8Array([1]));
    expect(await c.putAsset("image.png", { hash: "old", bytes: new Uint8Array([3]) }, "")).toBe(
      true,
    );
    expect(
      await c.putAsset("image.png", { hash: "new", bytes: new Uint8Array([4]) }, "wrong"),
    ).toBe(false);
    expect(await c.getBlob("new")).toBeUndefined();
    expect((await c.getAsset("image.png"))?.bytes).toEqual(new Uint8Array([1]));
    const edit = await c.queue("image.png", "pending", "");
    await c.drop("image.png");
    expect(await c.getAsset("image.png")).toBeUndefined();
    expect(await c.pending()).toEqual([edit]);
  });

  it("isolates vaults and rolls back a failed multi-row asset write", async () => {
    const db = adapter();
    const a = cache(db),
      b = cache(db, "cloud:00000000-0000-0000-0000-000000000001");
    await a.queue("private.md", "private", "");
    expect(await b.pending()).toEqual([]);
    db.execSync(
      "CREATE TRIGGER fail_meta BEFORE INSERT ON vault_values WHEN NEW.store = 'assets' BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;",
    );
    await expect(
      a.putAsset("image.png", { hash: "rollback", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow("disk write failed");
    expect(await a.getBlob("rollback")).toBeUndefined();
    expect(() => cache(db, "github:unchecked")).toThrow("Invalid vault root");
    await expect(a.queue("../outside.md", "bad", "")).rejects.toThrow();
  });
});
