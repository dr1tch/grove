import type { Document } from "@grove/core/types";
import type { RepoRef, VaultEntry } from "@grove/github-vault/types";
import { filePath, rootOf } from "@grove/github-vault/types";
import type { CachedAsset, PendingEdit, RemoteUpdate, VaultCache } from "@grove/github-vault/cache";
import { CacheConflict, pendingDocument } from "@grove/github-vault/cache";

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export class BrowserCache implements VaultCache {
  readonly root: string;
  #database: Promise<IDBDatabase>;
  constructor(ref: RepoRef) {
    this.root = rootOf(ref);
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDB.open(`grove-vault:${this.root}`, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const name of ["blobs", "meta", "documents", "pending"])
          request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        if (blocked) database.close();
        else resolve(database);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Close other Grove tabs before upgrading local storage."));
      };
    });
  }
  async #transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const database = await this.#database;
    const transaction = database.transaction(stores, mode, { durability: "strict" });
    const complete = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Local storage transaction failed. Changes were not saved."),
        );
    });
    try {
      const value = await action(transaction);
      await complete;
      return value;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Transaction may already have aborted. */
      }
      await complete.catch(() => {});
      throw error;
    }
  }
  getAsset(path: string): Promise<CachedAsset | undefined> {
    filePath(path);
    return this.#transaction(["meta", "blobs"], "readonly", async (tx) => {
      const hash: string | undefined = await result(tx.objectStore("meta").get(`asset:${path}`));
      if (!hash) return undefined;
      const bytes: Uint8Array | undefined = await result(tx.objectStore("blobs").get(hash));
      return bytes ? { hash, bytes } : undefined;
    });
  }
  async putAsset(path: string, asset: CachedAsset, expectedHash?: string): Promise<boolean> {
    filePath(path);
    return this.#transaction(["meta", "blobs"], "readwrite", async (tx) => {
      const meta = tx.objectStore("meta");
      const current: string | undefined = await result(meta.get(`asset:${path}`));
      if (expectedHash !== undefined && (current ?? "") !== expectedHash) return false;
      await result(tx.objectStore("blobs").put(asset.bytes, asset.hash));
      await result(meta.put(asset.hash, `asset:${path}`));
      return true;
    });
  }
  getBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.#transaction(["blobs"], "readonly", async (tx) =>
      result(tx.objectStore("blobs").get(hash)),
    );
  }
  async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    await this.#transaction(["blobs"], "readwrite", async (tx) => {
      await result(tx.objectStore("blobs").put(bytes, hash));
    });
  }
  getTree(): Promise<VaultEntry[] | undefined> {
    return this.#transaction(["meta"], "readonly", async (tx) =>
      result(tx.objectStore("meta").get("tree")),
    );
  }
  async putTree(tree: VaultEntry[]): Promise<void> {
    await this.#transaction(["meta"], "readwrite", async (tx) => {
      await result(tx.objectStore("meta").put(tree, "tree"));
    });
  }
  getDocument(path: string): Promise<Document | undefined> {
    filePath(path);
    return this.#transaction(["documents"], "readonly", async (tx) =>
      result(tx.objectStore("documents").get(path)),
    );
  }
  async putDocument(document: Document, expectedHash?: string): Promise<boolean> {
    filePath(document.path);
    return this.#transaction(["documents", "pending"], "readwrite", async (tx) => {
      const documents = tx.objectStore("documents");
      const current: Document | undefined = await result(documents.get(document.path));
      const pending = await result(tx.objectStore("pending").get(document.path));
      if (expectedHash !== undefined && (pending || (current?.hash ?? "") !== expectedHash))
        return false;
      await result(documents.put(document, document.path));
      return true;
    });
  }
  async drop(path: string): Promise<void> {
    filePath(path);
    await this.#transaction(["documents", "meta"], "readwrite", async (tx) => {
      await result(tx.objectStore("documents").delete(path));
      await result(tx.objectStore("meta").delete(`asset:${path}`));
      const tree: VaultEntry[] | undefined = await result(tx.objectStore("meta").get("tree"));
      if (tree)
        await result(
          tx.objectStore("meta").put(
            tree.filter((entry) => entry.path !== path),
            "tree",
          ),
        );
    });
  }
  pending(): Promise<PendingEdit[]> {
    return this.#transaction(["pending"], "readonly", async (tx) =>
      result(tx.objectStore("pending").getAll()),
    );
  }
  async queue(
    path: string,
    content: string,
    baseSha: string,
    expectedHash?: string,
  ): Promise<PendingEdit> {
    filePath(path);
    return this.#transaction(["pending", "documents"], "readwrite", async (tx) => {
      const edits = tx.objectStore("pending");
      const previous: PendingEdit | undefined = await result(edits.get(path));
      const saved: Document | undefined = await result(tx.objectStore("documents").get(path));
      const current = previous ? pendingDocument(previous) : saved;
      if (expectedHash !== undefined && expectedHash !== (current?.hash ?? ""))
        throw new CacheConflict(current ?? { path, hash: "", content: "", modified: 0 });
      const edit = {
        path,
        content,
        baseSha: previous?.baseSha ?? baseSha,
        revision: `local:${crypto.randomUUID()}`,
      };
      await result(edits.put(edit, path));
      return edit;
    });
  }
  async ack(path: string, revision: string, remote?: RemoteUpdate): Promise<boolean> {
    filePath(path);
    return this.#transaction(["pending", "documents"], "readwrite", async (tx) => {
      const edits = tx.objectStore("pending");
      const current: PendingEdit | undefined = await result(edits.get(path));
      const documents = tx.objectStore("documents");
      const saved: Document | undefined = await result(documents.get(path));
      if (
        remote &&
        (!saved || saved.hash === remote.baseSha || current?.baseSha === remote.baseSha)
      )
        await result(documents.put(remote.document, path));
      if (!current) return false;
      if (current.revision === revision) {
        await result(edits.delete(path));
        return true;
      }
      // Advance only through our own upload, never through a conflicting remote edit.
      if (remote?.rebase && current.baseSha === remote.baseSha)
        await result(edits.put({ ...current, baseSha: remote.document.hash }, path));
      return false;
    });
  }
  async close(): Promise<void> {
    (await this.#database).close();
  }
}
