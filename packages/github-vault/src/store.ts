import { kindOf } from "@grove/core/files";
import { MAX_SYNC_BYTES } from "@grove/core/conflicts";
import type { Document, SaveResult, Version } from "@grove/core/types";
import { documentAt, GitHub } from "./github";
import {
  base64,
  encodePath,
  filePath,
  GitHubError,
  object,
  rootOf,
  sha,
  size,
  string,
  vaultPath,
  visiblePath,
} from "./types";
import type { RepoRef, VaultEntry } from "./types";

export class VaultStore {
  readonly ref: Readonly<RepoRef>;
  readonly root: string;
  readonly device: string;
  #api: GitHub;
  #mutating: Promise<unknown> = Promise.resolve();
  constructor(
    ref: RepoRef,
    token: string,
    options: { fetch?: typeof fetch; device?: string } = {},
  ) {
    this.root = rootOf(ref);
    this.ref = Object.freeze({ ...ref });
    this.device = (options.device ?? "Grove client").replace(/[\r\n]/g, " ").slice(0, 80);
    this.#api = new GitHub(ref, token, options.fetch);
  }
  #message() {
    return `Grove: ${this.device} ${new Date().toISOString()}`;
  }
  #contents(path: string, ref = this.ref.branch) {
    return `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
  }
  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutating.then(operation);
    this.#mutating = result.catch(() => {});
    return result;
  }
  async #commit() {
    const value = object(await this.#api.json(`/commits/${encodeURIComponent(this.ref.branch)}`));
    return { hash: sha(value.sha), tree: sha(object(object(value.commit).tree).sha) };
  }
  async head(): Promise<string> {
    return (await this.#commit()).hash;
  }
  async list(): Promise<VaultEntry[]> {
    const { tree } = await this.#commit();
    const result: VaultEntry[] = [];
    const load = async (
      hash: string,
      prefix: string,
      recursive: boolean,
      depth: number,
    ): Promise<void> => {
      if (depth > 100 || result.length > 200_000)
        throw new GitHubError(
          "rejected",
          "Repository tree is too large or deeply nested to list safely.",
        );
      const data = object(
        await this.#api.json(`/git/trees/${hash}${recursive ? "?recursive=1" : ""}`),
      );
      if (!Array.isArray(data.tree) || typeof data.truncated !== "boolean")
        throw new GitHubError("other", "GitHub returned an invalid tree.");
      if (data.truncated) {
        if (!recursive)
          throw new GitHubError(
            "rejected",
            "GitHub returned an incomplete directory. No partial vault was opened.",
          );
        return load(hash, prefix, false, depth);
      }
      for (const raw of data.tree) {
        const item = object(raw);
        const path = vaultPath(prefix + string(item.path));
        if (!visiblePath(path)) continue;
        const mode = string(item.mode);
        const folder = item.type === "tree" && mode === "040000";
        if (!folder && !(item.type === "blob" && (mode === "100644" || mode === "100755")))
          continue;
        const itemSha = sha(item.sha);
        result.push({
          path,
          name: path.split("/").pop()!,
          kind: folder ? "folder" : kindOf(path),
          size: folder ? 0 : size(item.size),
          modified: 0,
          sha: itemSha,
        });
        if (folder && !recursive) await load(itemSha, path + "/", false, depth + 1);
      }
    };
    await load(tree, "", true, 0);
    if (
      result.length > 200_000 ||
      new Set(result.map((entry) => entry.path)).size !== result.length
    )
      throw new GitHubError("other", "GitHub returned an invalid or oversized vault tree.");
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  async #metadata(path: string, ref?: string) {
    const data = documentAt(await this.#api.json(this.#contents(path, ref)));
    return { hash: sha(data.sha), size: size(data.size) };
  }
  async #bytes(hash: string, length: number): Promise<Uint8Array> {
    if (length > MAX_SYNC_BYTES)
      throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
    const bytes = await this.#api.bytes(`/git/blobs/${sha(hash)}`);
    if (bytes.length !== length)
      throw new GitHubError("other", "GitHub file size changed unexpectedly.");
    return bytes;
  }
  async read(path: string): Promise<Document> {
    filePath(path);
    const info = await this.#metadata(path);
    const bytes = await this.#bytes(info.hash, info.size);
    return {
      path,
      hash: info.hash,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      modified: 0,
    };
  }
  async assetBytes(path: string): Promise<Uint8Array> {
    return (await this.readAsset(path)).bytes;
  }
  async readAsset(path: string): Promise<{ hash: string; bytes: Uint8Array }> {
    filePath(path);
    const info = await this.#metadata(path);
    return { hash: info.hash, bytes: await this.#bytes(info.hash, info.size) };
  }
  async #write(path: string, bytes: Uint8Array, hash?: string): Promise<string> {
    if (bytes.byteLength > MAX_SYNC_BYTES)
      throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
    const result = object(
      await this.#api.json(`/contents/${encodePath(path)}`, {
        method: "PUT",
        body: {
          message: this.#message(),
          branch: this.ref.branch,
          content: base64(bytes),
          ...(hash ? { sha: sha(hash) } : {}),
        },
      }),
    );
    return sha(object(result.content).sha);
  }
  async #remote(path: string): Promise<Document> {
    try {
      return await this.read(path);
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found")
        return { path, content: "", hash: "", modified: 0 };
      throw error;
    }
  }
  async write(path: string, content: string, baseHash: string): Promise<SaveResult> {
    filePath(path);
    sha(baseHash);
    return this.#exclusive(async () => {
      try {
        const hash = await this.#write(path, new TextEncoder().encode(content), baseHash);
        return { status: "saved", document: { path, content, hash, modified: Date.now() } };
      } catch (error) {
        if (error instanceof GitHubError && [404, 409, 422].includes(error.status)) {
          const disk = await this.#remote(path);
          if (disk.hash !== baseHash) return { status: "conflict", disk };
        }
        throw error;
      }
    });
  }
  async #createBytes(path: string, bytes: Uint8Array): Promise<string> {
    // No SHA is sent: GitHub must reject an existing destination, including a race.
    try {
      return await this.#write(path, bytes);
    } catch (error) {
      if (error instanceof GitHubError && [409, 422].includes(error.status)) {
        try {
          await this.#metadata(path);
        } catch (missing) {
          if (missing instanceof GitHubError && missing.kind === "not-found") throw error;
          throw missing;
        }
        throw new GitHubError(
          "conflict",
          "A file already exists at the destination.",
          error.status,
        );
      }
      throw error;
    }
  }
  async create(path: string, content: string): Promise<Document> {
    filePath(path);
    return this.#exclusive(async () => ({
      path,
      content,
      hash: await this.#createBytes(path, new TextEncoder().encode(content)),
      modified: Date.now(),
    }));
  }
  async createBytes(path: string, bytes: Uint8Array): Promise<void> {
    filePath(path);
    await this.#exclusive(() => this.#createBytes(path, bytes));
  }
  async #delete(path: string, hash: string): Promise<void> {
    await this.#api.json(`/contents/${encodePath(path)}`, {
      method: "DELETE",
      body: { branch: this.ref.branch, message: this.#message(), sha: hash },
    });
  }
  async remove(path: string): Promise<void> {
    filePath(path);
    await this.#exclusive(async () => {
      const info = await this.#metadata(path);
      await this.#delete(path, info.hash);
    });
  }
  async rename(path: string, target: string): Promise<void> {
    filePath(path);
    filePath(target);
    if (path === target) return;
    await this.#exclusive(async () => {
      const info = await this.#metadata(path);
      const bytes = await this.#bytes(info.hash, info.size);
      await this.#createBytes(target, bytes);
      // Two writes, not an atomic move. If deletion fails the created copy remains safe.
      try {
        await this.#delete(path, info.hash);
      } catch {
        throw new GitHubError(
          "conflict",
          `A copy was created at ${target}. The source could not be removed; review both paths before retrying.`,
        );
      }
    });
  }
  async mkdir(path: string): Promise<void> {
    filePath(path);
    await this.#exclusive(async () => {
      if (
        (await this.list()).some(
          (entry) => entry.path === path || entry.path.startsWith(path + "/"),
        )
      )
        throw new GitHubError("conflict", "The destination already exists.");
      await this.#createBytes(`${path}/.gitkeep`, new Uint8Array());
    });
  }
  async versions(path: string): Promise<Version[]> {
    filePath(path);
    const values = await this.#api.json(
      `/commits?sha=${encodeURIComponent(this.ref.branch)}&path=${encodeURIComponent(path)}&per_page=30`,
    );
    if (!Array.isArray(values)) throw new GitHubError("other", "GitHub returned invalid history.");
    const versions: Version[] = [];
    for (const raw of values.slice(0, 30)) {
      const value = object(raw),
        id = sha(value.sha),
        commit = object(value.commit),
        author = object(commit.author);
      const at = Date.parse(string(author.date));
      if (!Number.isFinite(at))
        throw new GitHubError("other", "GitHub returned an invalid history timestamp.");
      try {
        const info = await this.#metadata(path, id);
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          await this.#bytes(info.hash, info.size),
        );
        versions.push({ id, path, content, at, author: string(author.name) });
      } catch (error) {
        if (!(error instanceof GitHubError && error.kind === "not-found")) throw error;
      }
    }
    return versions;
  }
}
