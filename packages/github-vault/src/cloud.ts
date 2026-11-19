import type { SupabaseClient } from "@supabase/supabase-js";
import { kindOf } from "@grove/core/files";
import { MAX_SYNC_BYTES } from "@grove/core/conflicts";
import type { Document, SaveResult, Version } from "@grove/core/types";
import { filePath, GitHubError, visiblePath } from "./types";
import type { VaultEntry } from "./types";
import type { RemoteStore } from "./remote";

const BUCKET = "vaults";
const PAGE = 1000;

// Git blob SHA-1, so cloud hashes match GitHub's and cached documents stay comparable.
export async function blobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Failure = { message?: string; code?: string; status?: number; statusCode?: string | number };
function fail(error: Failure, status = 0): GitHubError {
  const code = String(error.code ?? ""),
    // Storage errors carry the real HTTP code in statusCode; status is a generic 400.
    http = Number(error.statusCode ?? error.status ?? status) || 0;
  if (code === "GR409") return new GitHubError("conflict", "File changed elsewhere.", 409);
  if (http === 0 || /fetch|network/i.test(error.message ?? ""))
    return new GitHubError("offline", "Grove cloud is unreachable. Changes stay on this device.");
  if (
    http === 401 ||
    code === "28000" ||
    code.startsWith("PGRST3") ||
    code === "InvalidJWT" ||
    /jwt|exp claim/i.test(error.message ?? "")
  )
    return new GitHubError("auth", "Your session expired. Sign in again.", http);
  if (http === 403 || code === "42501")
    return new GitHubError("no-access", "Grove cloud denied access to this file.", http);
  if (http === 404) return new GitHubError("not-found", "File not found.", 404);
  if (http === 413) return new GitHubError("rejected", "File exceeds the 50 MiB sync limit.", 413);
  if (http === 429)
    return new GitHubError("rate-limit", "Too many requests; try again later.", 429);
  return new GitHubError("other", "Grove cloud request failed.", http);
}

export class CloudStore implements RemoteStore {
  readonly root: string;
  constructor(
    private readonly db: SupabaseClient,
    readonly userId: string,
    readonly device = "Grove client",
  ) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(userId))
      throw new GitHubError("rejected", "Invalid Grove account.");
    this.root = `cloud:${userId.toLowerCase()}`;
  }
  dispose(): void {
    // The Supabase client belongs to the sign-in layer, which signs out and disposes it.
  }
  async #rpc(name: string, args: Record<string, unknown>): Promise<void> {
    const { error, status } = await this.db.rpc(name, args);
    if (error) throw fail(error, status);
  }
  async #row(path: string): Promise<{ sha: string; size: number }> {
    const { data, error, status } = await this.db
      .from("vault_files")
      .select("sha, size")
      .eq("user_id", this.userId)
      .eq("path", path)
      .maybeSingle();
    if (error) throw fail(error, status);
    if (!data) throw new GitHubError("not-found", "File not found.", 404);
    return data;
  }
  async #download(hash: string, size: number): Promise<Uint8Array> {
    if (size > MAX_SYNC_BYTES)
      throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
    const { data, error } = await this.db.storage.from(BUCKET).download(`${this.userId}/${hash}`);
    if (error) throw fail(error as Failure);
    const bytes = new Uint8Array(await new Response(data).arrayBuffer());
    if (bytes.length !== size || (await blobSha(bytes)) !== hash)
      throw new GitHubError("other", "Grove cloud returned damaged file contents.");
    return bytes;
  }
  async #upload(bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > MAX_SYNC_BYTES)
      throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
    const hash = await blobSha(bytes);
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(`${this.userId}/${hash}`, bytes.slice().buffer, {
        upsert: false,
        contentType: "application/octet-stream",
      });
    // Blobs are content-addressed: an existing object already holds these exact bytes.
    if (error && !/exists|duplicate/i.test(error.message)) throw fail(error as Failure);
    return hash;
  }
  async #create(path: string, bytes: Uint8Array): Promise<string> {
    const hash = await this.#upload(bytes);
    try {
      await this.#rpc("vault_save", {
        p_path: path,
        p_base: null,
        p_sha: hash,
        p_size: bytes.length,
      });
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "conflict")
        throw new GitHubError("conflict", "A file already exists at the destination.", 409);
      throw error;
    }
    return hash;
  }
  async head(): Promise<string> {
    const { data, error, status } = await this.db
      .from("vault_heads")
      .select("revision")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (error) throw fail(error, status);
    return String(data?.revision ?? 0);
  }
  async list(): Promise<VaultEntry[]> {
    const rows: { path: string; sha: string; size: number; updated_at: string }[] = [];
    // Keyset paging: a concurrent delete cannot shift a later page and skip a file.
    for (let after: string | undefined; ;) {
      let query = this.db
        .from("vault_files")
        .select("path, sha, size, updated_at")
        .eq("user_id", this.userId);
      if (after !== undefined) query = query.gt("path", after);
      const { data, error, status } = await query.order("path").limit(PAGE);
      if (error) throw fail(error, status);
      rows.push(...data);
      after = data.at(-1)?.path;
      if (data.length < PAGE) break;
      if (rows.length > 200_000)
        throw new GitHubError("rejected", "Vault is too large to list safely.");
    }
    const entries = new Map<string, VaultEntry>();
    for (const row of rows) {
      const parts = row.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const folder = parts.slice(0, index).join("/");
        if (!entries.has(folder) && visiblePath(folder))
          entries.set(folder, {
            path: folder,
            name: parts[index - 1],
            kind: "folder",
            size: 0,
            modified: 0,
            sha: "",
          });
      }
      if (!visiblePath(row.path)) continue;
      entries.set(row.path, {
        path: row.path,
        name: parts[parts.length - 1],
        kind: kindOf(row.path),
        size: row.size,
        modified: Date.parse(row.updated_at) || 0,
        sha: row.sha,
      });
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  async read(path: string): Promise<Document> {
    filePath(path);
    const row = await this.#row(path);
    const bytes = await this.#download(row.sha, row.size);
    return {
      path,
      hash: row.sha,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      modified: 0,
    };
  }
  async readAsset(path: string): Promise<{ hash: string; bytes: Uint8Array }> {
    filePath(path);
    const row = await this.#row(path);
    return { hash: row.sha, bytes: await this.#download(row.sha, row.size) };
  }
  async write(path: string, content: string, baseHash: string): Promise<SaveResult> {
    filePath(path);
    const bytes = new TextEncoder().encode(content);
    const hash = await this.#upload(bytes);
    try {
      await this.#rpc("vault_save", {
        p_path: path,
        p_base: baseHash,
        p_sha: hash,
        p_size: bytes.length,
      });
      return { status: "saved", document: { path, content, hash, modified: Date.now() } };
    } catch (error) {
      if (!(error instanceof GitHubError && error.kind === "conflict")) throw error;
      let disk: Document = { path, content: "", hash: "", modified: 0 };
      try {
        disk = await this.read(path);
      } catch (missing) {
        if (!(missing instanceof GitHubError && missing.kind === "not-found")) throw missing;
      }
      if (disk.hash !== baseHash) return { status: "conflict", disk };
      throw error;
    }
  }
  async create(path: string, content: string): Promise<Document> {
    filePath(path);
    const hash = await this.#create(path, new TextEncoder().encode(content));
    return { path, content, hash, modified: Date.now() };
  }
  async createBytes(path: string, bytes: Uint8Array): Promise<void> {
    filePath(path);
    await this.#create(path, bytes);
  }
  async remove(path: string): Promise<void> {
    filePath(path);
    const row = await this.#row(path);
    await this.#rpc("vault_delete", { p_path: path, p_sha: row.sha });
  }
  async rename(path: string, target: string): Promise<void> {
    filePath(path);
    filePath(target);
    if (path === target) return;
    const row = await this.#row(path);
    try {
      await this.#rpc("vault_rename", { p_path: path, p_target: target, p_sha: row.sha });
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "conflict")
        throw new GitHubError("conflict", "The destination already exists.", 409);
      throw error;
    }
  }
  async mkdir(path: string): Promise<void> {
    filePath(path);
    if (
      (await this.list()).some((entry) => entry.path === path || entry.path.startsWith(path + "/"))
    )
      throw new GitHubError("conflict", "The destination already exists.");
    await this.#create(`${path}/.gitkeep`, new Uint8Array());
  }
  async versions(path: string): Promise<Version[]> {
    filePath(path);
    const { data, error, status } = await this.db
      .from("vault_versions")
      .select("id, sha, size, created_at")
      .eq("user_id", this.userId)
      .eq("path", path)
      .order("id", { ascending: false })
      .limit(30);
    if (error) throw fail(error, status);
    const versions: Version[] = [];
    for (const row of data) {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await this.#download(row.sha, row.size),
      );
      versions.push({
        id: String(row.id),
        path,
        content,
        at: Date.parse(row.created_at),
        author: "Grove",
      });
    }
    return versions;
  }
}
