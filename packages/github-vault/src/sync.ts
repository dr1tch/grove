import { kindOf } from "@grove/core/files";
import { conflictCopyName, MAX_SYNC_BYTES } from "@grove/core/conflicts";
import type { Document, SaveResult, SyncStatus, Version } from "@grove/core/types";
import { CacheConflict, pendingDocument } from "./cache";
import type { PendingEdit, VaultCache } from "./cache";
import { filePath, GitHubError } from "./types";
import type { VaultEntry } from "./types";
import { VaultStore } from "./store";

const copyStatus = (status: SyncStatus): SyncStatus => ({
  ...status,
  conflicts: [...status.conflicts],
  skipped: [...status.skipped],
});

export class VaultSession {
  #running?: Promise<SyncStatus>;
  #changes = new Set<(path: string) => void>();
  #sync = new Set<(status: SyncStatus) => void>();
  #status: SyncStatus = { state: "off", conflicts: [], skipped: [] };
  constructor(
    readonly store: VaultStore,
    readonly cache: VaultCache,
  ) {
    if (cache.root !== store.root)
      throw new GitHubError("rejected", "The cache belongs to a different vault.");
  }
  onChange(callback: (path: string) => void): () => void {
    this.#changes.add(callback);
    return () => {
      this.#changes.delete(callback);
    };
  }
  onSync(callback: (status: SyncStatus) => void): () => void {
    this.#sync.add(callback);
    return () => {
      this.#sync.delete(callback);
    };
  }
  #emit<T>(listeners: Set<(value: T) => void>, value: T) {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        /* Observer failures must not invalidate durable saves. */
      }
    }
  }
  #state(status: SyncStatus): SyncStatus {
    this.#status = copyStatus(status);
    this.#emit(this.#sync, copyStatus(status));
    return copyStatus(status);
  }
  status(): SyncStatus {
    return copyStatus(this.#status);
  }
  async list(): Promise<VaultEntry[]> {
    let tree: VaultEntry[];
    try {
      tree = await this.store.list();
      await this.cache.putTree(tree);
    } catch (error) {
      if (!(error instanceof GitHubError && error.kind === "offline")) throw error;
      const saved = await this.cache.getTree();
      if (!saved && !(await this.cache.pending()).length) throw error;
      tree = saved ?? [];
    }
    const entries = new Map(tree.map((entry) => [entry.path, entry]));
    for (const edit of await this.cache.pending()) {
      entries.set(edit.path, {
        path: edit.path,
        name: edit.path.split("/").pop()!,
        sha: edit.revision,
        kind: kindOf(edit.path),
        size: new TextEncoder().encode(edit.content).length,
        modified: 0,
      });
      const segments = edit.path.split("/");
      for (let count = 1; count < segments.length; count++) {
        const path = segments.slice(0, count).join("/");
        if (!entries.has(path))
          entries.set(path, {
            path,
            name: segments[count - 1],
            sha: "",
            kind: "folder",
            size: 0,
            modified: 0,
          });
      }
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  async read(path: string): Promise<Document> {
    filePath(path);
    const pending = (await this.cache.pending()).find((edit) => edit.path === path);
    if (pending) return pendingDocument(pending);
    const before = await this.cache.getDocument(path);
    try {
      const document = await this.store.read(path);
      await this.cache.putBlob(document.hash, new TextEncoder().encode(document.content));
      const accepted = await this.cache.putDocument(document, before?.hash ?? "");
      // A local edit could have arrived while the remote read was in flight.
      const latest = (await this.cache.pending()).find((edit) => edit.path === path);
      return latest
        ? pendingDocument(latest)
        : accepted
          ? document
          : ((await this.cache.getDocument(path)) ?? document);
    } catch (error) {
      if (!(error instanceof GitHubError && error.kind === "offline")) throw error;
      const latest = (await this.cache.pending()).find((edit) => edit.path === path);
      if (latest) return pendingDocument(latest);
      const document = await this.cache.getDocument(path);
      if (!document?.hash) throw error;
      return document;
    }
  }
  async write(path: string, content: string, baseHash: string): Promise<SaveResult> {
    filePath(path);
    if (new TextEncoder().encode(content).length > MAX_SYNC_BYTES)
      throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
    try {
      const edit = await this.cache.queue(path, content, baseHash, baseHash);
      this.#emit(this.#changes, path);
      return { status: "saved", document: pendingDocument(edit) };
    } catch (error) {
      if (error instanceof CacheConflict) return { status: "conflict", disk: error.document };
      throw error;
    }
  }
  async create(path: string, content: string): Promise<Document> {
    filePath(path);
    const tree = await this.cache.getTree();
    if (tree?.some((entry) => entry.path === path || entry.path.startsWith(path + "/")))
      throw new GitHubError("conflict", "The destination already exists.");
    const saved = await this.write(path, content, "");
    if (saved.status === "conflict")
      throw new GitHubError("conflict", "The destination already exists locally.");
    return saved.document;
  }
  async #copyConflict(edit: PendingEdit): Promise<string> {
    const occupied = new Set<string>();
    const day = new Date();
    for (let attempt = 0; attempt < 100; attempt++) {
      const path = conflictCopyName(edit.path, this.store.device, day, (candidate) =>
        occupied.has(candidate),
      );
      try {
        const copy = await this.store.create(path, edit.content);
        await this.cache.putDocument(copy);
        return path;
      } catch (error) {
        if (!(error instanceof GitHubError && error.kind === "conflict")) throw error;
        occupied.add(path);
      }
    }
    throw new GitHubError(
      "conflict",
      "Could not reserve a unique conflict filename. Your edit remains queued.",
    );
  }
  syncNow(): Promise<SyncStatus> {
    if (this.#running) return this.#running;
    this.#running = this.#flush().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }
  async #flush(): Promise<SyncStatus> {
    const conflicts: string[] = [];
    this.#state({ state: "syncing", conflicts, skipped: [], lastSync: this.#status.lastSync });
    try {
      for (const edit of await this.cache.pending()) {
        let result: SaveResult;
        if (edit.baseSha) result = await this.store.write(edit.path, edit.content, edit.baseSha);
        else {
          try {
            result = {
              status: "saved",
              document: await this.store.create(edit.path, edit.content),
            };
          } catch (error) {
            if (!(error instanceof GitHubError && error.kind === "conflict")) throw error;
            result = { status: "conflict", disk: await this.store.read(edit.path) };
          }
        }
        if (
          result.status === "saved" ||
          (result.disk.hash && result.disk.content === edit.content)
        ) {
          const document = result.status === "saved" ? result.document : result.disk;
          await this.cache.ack(edit.path, edit.revision, {
            baseSha: edit.baseSha,
            document,
            rebase: true,
          });
        } else {
          const copy = await this.#copyConflict(edit);
          await this.cache.ack(edit.path, edit.revision, {
            baseSha: edit.baseSha,
            document: result.disk,
            rebase: false,
          });
          conflicts.push(copy);
          this.#emit(this.#changes, copy);
        }
        this.#emit(this.#changes, edit.path);
      }
      await this.cache.putTree(await this.store.list());
      const more = (await this.cache.pending()).length > 0;
      return this.#state({
        state: conflicts.length ? "conflict" : more ? "syncing" : "synced",
        lastSync: Date.now(),
        conflicts,
        skipped: [],
        ...(more ? { message: "Newer local changes remain queued." } : {}),
      });
    } catch (error) {
      const state =
        error instanceof GitHubError && error.kind === "offline"
          ? "offline"
          : error instanceof GitHubError && error.kind === "conflict"
            ? "conflict"
            : "error";
      return this.#state({
        state,
        lastSync: this.#status.lastSync,
        conflicts,
        skipped: [],
        message:
          error instanceof GitHubError
            ? error.message
            : "Sync could not complete. Pending edits remain recoverable locally.",
      });
    }
  }
  async #requireClean(...paths: string[]): Promise<void> {
    if (
      (await this.cache.pending()).some((edit) =>
        paths.some((path) => edit.path === path || edit.path.startsWith(path + "/")),
      )
    )
      throw new GitHubError(
        "conflict",
        "Sync or recover pending edits before moving, replacing or deleting this file.",
      );
  }
  async remove(path: string): Promise<void> {
    await this.#requireClean(path);
    await this.store.remove(path);
    await this.cache.drop(path);
    this.#emit(this.#changes, path);
  }
  async rename(path: string, target: string): Promise<void> {
    await this.#requireClean(path, target);
    const cached = await this.cache.getDocument(path);
    await this.store.rename(path, target);
    if (cached) await this.cache.putDocument(await this.store.read(target));
    await this.cache.putTree(await this.store.list());
    await this.cache.drop(path);
    this.#emit(this.#changes, path);
    this.#emit(this.#changes, target);
  }
  async mkdir(path: string): Promise<void> {
    await this.store.mkdir(path);
    this.#emit(this.#changes, path);
  }
  async createBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.#requireClean(path);
    await this.store.createBytes(path, bytes);
    this.#emit(this.#changes, path);
  }
  async assetBytes(path: string): Promise<Uint8Array> {
    filePath(path);
    const before = await this.cache.getAsset(path);
    try {
      const asset = await this.store.readAsset(path);
      const accepted = await this.cache.putAsset(path, asset, before?.hash ?? "");
      return accepted ? asset.bytes : ((await this.cache.getAsset(path))?.bytes ?? asset.bytes);
    } catch (error) {
      if (!(error instanceof GitHubError && error.kind === "offline")) throw error;
      const cached = await this.cache.getAsset(path);
      if (!cached) throw error;
      return cached.bytes;
    }
  }
  versions(path: string): Promise<Version[]> {
    return this.store.versions(path);
  }
  head(): Promise<string> {
    return this.store.head();
  }
}
