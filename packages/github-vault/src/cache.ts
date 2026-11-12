import type { Document } from "@grove/core/types";
import type { VaultEntry } from "./types";

export type PendingEdit = { path: string; content: string; baseSha: string; revision: string };
export type RemoteUpdate = { baseSha: string; document: Document; rebase: boolean };
export type CachedAsset = { hash: string; bytes: Uint8Array };
export interface VaultCache {
  readonly root: string;
  getAsset(path: string): Promise<CachedAsset | undefined>;
  putAsset(path: string, asset: CachedAsset, expectedHash?: string): Promise<boolean>;
  getBlob(sha: string): Promise<Uint8Array | undefined>;
  putBlob(sha: string, bytes: Uint8Array): Promise<void>;
  getTree(): Promise<VaultEntry[] | undefined>;
  putTree(tree: VaultEntry[]): Promise<void>;
  getDocument(path: string): Promise<Document | undefined>;
  putDocument(document: Document, expectedHash?: string): Promise<boolean>;
  drop(path: string): Promise<void>;
  pending(): Promise<PendingEdit[]>;
  queue(
    path: string,
    content: string,
    baseSha: string,
    expectedHash?: string,
  ): Promise<PendingEdit>;
  ack(path: string, revision: string, remote?: RemoteUpdate): Promise<boolean>;
}
export class CacheConflict extends Error {
  constructor(public document: Document) {
    super("A newer local revision exists. Review it before saving.");
    this.name = "CacheConflict";
  }
}
export function pendingDocument(edit: PendingEdit): Document {
  return { path: edit.path, content: edit.content, hash: edit.revision, modified: 0 };
}
