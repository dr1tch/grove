import type { Document } from "@grove/core/types";
import type { RepoRef, VaultEntry } from "@grove/github-vault/types";
import { filePath, rootOf } from "@grove/github-vault/types";
import {
  ackedDocument,
  CacheConflict,
  pendingDocument,
  uploadedFrom,
} from "@grove/github-vault/cache";
import type { CachedAsset, PendingEdit, RemoteUpdate, VaultCache } from "@grove/github-vault/cache";

// Expo and node:sqlite run the same SQL through this small synchronous seam.
// No await occurs inside a transaction, so other work cannot join it accidentally.
export type SQLValue = string | number | null | Uint8Array;
export interface SQLiteAdapter {
  execSync(sql: string): void;
  runSync(sql: string, ...params: SQLValue[]): unknown;
  getFirstSync<T>(sql: string, ...params: SQLValue[]): T | null;
  getAllSync<T>(sql: string, ...params: SQLValue[]): T[];
  withTransactionSync(action: () => void): void;
}

export function cacheRoot(source: RepoRef | string): string {
  if (typeof source !== "string") return rootOf(source);
  if (source === "sample:grove" || /^cloud:[\da-f-]{36}$/.test(source)) return source;
  throw new Error("Invalid vault root.");
}

export class SQLiteVaultCache implements VaultCache {
  readonly root: string;
  constructor(
    private db: SQLiteAdapter,
    source: RepoRef | string,
    private uuid: () => string,
  ) {
    this.root = cacheRoot(source);
    db.execSync(`
      CREATE TABLE IF NOT EXISTS vault_values (
        root TEXT NOT NULL, store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (root, store, key)
      );
      CREATE TABLE IF NOT EXISTS vault_blobs (
        root TEXT NOT NULL, hash TEXT NOT NULL, bytes BLOB NOT NULL,
        PRIMARY KEY (root, hash)
      );
    `);
  }
  private transaction<T>(action: () => T): T {
    let value!: T;
    this.db.withTransactionSync(() => {
      value = action();
    });
    return value;
  }
  private get<T>(store: string, key: string): T | undefined {
    const row = this.db.getFirstSync<{ value: string }>(
      "SELECT value FROM vault_values WHERE root = ? AND store = ? AND key = ?",
      this.root,
      store,
      key,
    );
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private put(store: string, key: string, value: unknown): void {
    this.db.runSync(
      "INSERT OR REPLACE INTO vault_values (root, store, key, value) VALUES (?, ?, ?, ?)",
      this.root,
      store,
      key,
      JSON.stringify(value),
    );
  }
  private remove(store: string, key: string): void {
    this.db.runSync(
      "DELETE FROM vault_values WHERE root = ? AND store = ? AND key = ?",
      this.root,
      store,
      key,
    );
  }
  private blob(hash: string): Uint8Array | undefined {
    const row = this.db.getFirstSync<{ bytes: Uint8Array }>(
      "SELECT bytes FROM vault_blobs WHERE root = ? AND hash = ?",
      this.root,
      hash,
    );
    return row ? new Uint8Array(row.bytes) : undefined;
  }
  private storeBlob(hash: string, bytes: Uint8Array): void {
    // A SHA identifies immutable bytes. Never let an asset overwrite an older blob.
    this.db.runSync(
      "INSERT OR IGNORE INTO vault_blobs (root, hash, bytes) VALUES (?, ?, ?)",
      this.root,
      hash,
      bytes,
    );
  }
  async getAsset(path: string): Promise<CachedAsset | undefined> {
    filePath(path);
    return this.transaction(() => {
      const hash = this.get<string>("assets", path);
      const bytes = hash ? this.blob(hash) : undefined;
      return hash && bytes ? { hash, bytes } : undefined;
    });
  }
  async putAsset(path: string, asset: CachedAsset, expectedHash?: string): Promise<boolean> {
    filePath(path);
    return this.transaction(() => {
      if (expectedHash !== undefined && (this.get<string>("assets", path) ?? "") !== expectedHash)
        return false;
      this.storeBlob(asset.hash, asset.bytes);
      this.put("assets", path, asset.hash);
      return true;
    });
  }
  async getBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.blob(hash);
  }
  async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    this.storeBlob(hash, bytes);
  }
  async getTree(): Promise<VaultEntry[] | undefined> {
    return this.get("meta", "tree");
  }
  async putTree(tree: VaultEntry[]): Promise<void> {
    this.put("meta", "tree", tree);
  }
  async getDocument(path: string): Promise<Document | undefined> {
    filePath(path);
    return this.get("documents", path);
  }
  async putDocument(document: Document, expectedHash?: string): Promise<boolean> {
    filePath(document.path);
    return this.transaction(() => {
      const current = this.get<Document>("documents", document.path);
      if (
        expectedHash !== undefined &&
        (this.get("pending", document.path) || (current?.hash ?? "") !== expectedHash)
      )
        return false;
      this.put("documents", document.path, document);
      return true;
    });
  }
  async drop(path: string): Promise<void> {
    filePath(path);
    this.transaction(() => {
      this.remove("documents", path);
      this.remove("assets", path);
      const tree = this.get<VaultEntry[]>("meta", "tree");
      if (tree)
        this.put(
          "meta",
          "tree",
          tree.filter((entry) => entry.path !== path),
        );
    });
  }
  async pending(): Promise<PendingEdit[]> {
    return this.db
      .getAllSync<{ value: string }>(
        "SELECT value FROM vault_values WHERE root = ? AND store = ? ORDER BY key",
        this.root,
        "pending",
      )
      .map((row) => JSON.parse(row.value) as PendingEdit);
  }
  async queue(
    path: string,
    content: string,
    baseSha: string,
    expectedHash?: string,
  ): Promise<PendingEdit> {
    filePath(path);
    return this.transaction(() => {
      const previous = this.get<PendingEdit>("pending", path);
      const saved = this.get<Document>("documents", path);
      const current = previous ? pendingDocument(previous) : saved;
      const uploaded =
        !previous && expectedHash !== undefined && uploadedFrom(saved) === expectedHash;
      if (expectedHash !== undefined && !uploaded && expectedHash !== (current?.hash ?? ""))
        throw new CacheConflict(current ?? { path, hash: "", content: "", modified: 0 });
      const edit: PendingEdit = {
        path,
        content,
        baseSha: previous?.baseSha ?? (uploaded ? saved!.hash : baseSha),
        revision: `local:${this.uuid()}`,
      };
      this.put("pending", path, edit);
      return edit;
    });
  }
  async ack(path: string, revision: string, remote?: RemoteUpdate): Promise<boolean> {
    filePath(path);
    return this.transaction(() => {
      const current = this.get<PendingEdit>("pending", path);
      const saved = this.get<Document>("documents", path);
      if (
        remote &&
        (!saved || saved.hash === remote.baseSha || current?.baseSha === remote.baseSha)
      )
        this.put(
          "documents",
          path,
          ackedDocument(remote, current?.revision === revision ? revision : undefined),
        );
      if (!current) return false;
      if (current.revision === revision) {
        this.remove("pending", path);
        return true;
      }
      if (remote?.rebase && current.baseSha === remote.baseSha)
        this.put("pending", path, {
          ...current,
          baseSha: remote.document.hash,
        });
      return false;
    });
  }
}
