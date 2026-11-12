// Session-test adapter; the same transaction contract is checked against Chromium IndexedDB.
import type { Document } from "@grove/core/types";
import { CacheConflict, pendingDocument } from "./cache";
import type { CachedAsset, PendingEdit, RemoteUpdate, VaultCache } from "./cache";
import type { VaultEntry } from "./types";
export class MemoryCache implements VaultCache {
  assets = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
  documents = new Map<string, Document>();
  edits = new Map<string, PendingEdit>();
  tree?: VaultEntry[];
  constructor(readonly root: string) {}
  async getAsset(path: string): Promise<CachedAsset | undefined> {
    const hash = this.assets.get(path),
      bytes = hash && this.blobs.get(hash);
    return hash && bytes ? { hash, bytes } : undefined;
  }
  async putAsset(path: string, asset: CachedAsset, expectedHash?: string) {
    if (expectedHash !== undefined && (this.assets.get(path) ?? "") !== expectedHash) return false;
    this.assets.set(path, asset.hash);
    this.blobs.set(asset.hash, asset.bytes);
    return true;
  }
  async getBlob(hash: string) {
    return this.blobs.get(hash);
  }
  async putBlob(hash: string, bytes: Uint8Array) {
    this.blobs.set(hash, bytes);
  }
  async getTree() {
    return this.tree;
  }
  async putTree(tree: VaultEntry[]) {
    this.tree = structuredClone(tree);
  }
  async getDocument(path: string) {
    return this.documents.get(path);
  }
  async putDocument(document: Document, expectedHash?: string) {
    if (
      expectedHash !== undefined &&
      (this.edits.has(document.path) ||
        (this.documents.get(document.path)?.hash ?? "") !== expectedHash)
    )
      return false;
    this.documents.set(document.path, structuredClone(document));
    return true;
  }
  async drop(path: string) {
    this.documents.delete(path);
    this.assets.delete(path);
    if (this.tree) this.tree = this.tree.filter((entry) => entry.path !== path);
  }
  async pending() {
    return [...this.edits.values()].map((edit) => ({ ...edit }));
  }
  async queue(path: string, content: string, baseSha: string, expectedHash?: string) {
    const previous = this.edits.get(path),
      saved = this.documents.get(path);
    const current = previous ? pendingDocument(previous) : saved;
    if (expectedHash !== undefined && expectedHash !== (current?.hash ?? ""))
      throw new CacheConflict(current ?? { path, hash: "", content: "", modified: 0 });
    const edit = {
      path,
      content,
      baseSha: previous?.baseSha ?? baseSha,
      revision: `local:${crypto.randomUUID()}`,
    };
    this.edits.set(path, edit);
    return { ...edit };
  }
  async ack(path: string, revision: string, remote?: RemoteUpdate) {
    const current = this.edits.get(path),
      saved = this.documents.get(path);
    if (remote && (!saved || saved.hash === remote.baseSha || current?.baseSha === remote.baseSha))
      this.documents.set(path, structuredClone(remote.document));
    if (!current) return false;
    if (current.revision === revision) {
      this.edits.delete(path);
      return true;
    }
    if (remote?.rebase && current.baseSha === remote.baseSha)
      this.edits.set(path, { ...current, baseSha: remote.document.hash });
    return false;
  }
}
