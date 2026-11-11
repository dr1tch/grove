import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  kindOf,
  type Document,
  type Entry,
  type SaveResult,
  type TrashItem,
  type Version,
} from "../shared/types";
const helper = fileURLToPath(new URL("../../resources/vault_io.py", import.meta.url)).replace(
  "app.asar/",
  "app.asar.unpacked/",
);
export class Vault {
  private pending: Promise<unknown> = Promise.resolve();
  private known = new Map<string, Document>();
  constructor(public root: string) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.pending.then(fn);
    this.pending = next.catch(() => {});
    return next;
  }
  private validate(path: string, internal = false) {
    if (
      typeof path !== "string" ||
      !path ||
      path.includes("\0") ||
      path.includes("\\") ||
      isAbsolute(path) ||
      path
        .split(/[\\/]/)
        .some((p) => !p || p === "." || p === ".." || (!internal && p.startsWith(".")))
    )
      throw new Error("Invalid vault path");
  }
  async path(path: string, internal = false): Promise<string> {
    this.validate(path, internal);
    const root = await realpath(this.root);
    const target = resolve(root, path);
    if (!relative(root, target) || relative(root, target).startsWith(".."))
      throw new Error("Path is outside vault");
    let current = root;
    for (const part of relative(root, target).split(sep)) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symbolic links are not accessible");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return target;
  }
  private io<T>(request: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/python3", [helper, this.root], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let error = "";
      child.stdout.on("data", (d) => {
        output += d;
      });
      child.stderr.on("data", (d) => {
        error += d;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          if (code !== 0) throw new Error(error || "Vault operation failed");
          const result = JSON.parse(output);
          if (!result.ok) throw new Error(result.error);
          resolve(result.value);
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request));
    });
  }
  async read(path: string): Promise<Document> {
    this.validate(path);
    const doc = await this.io<Document>({ action: "read", path });
    this.known.set(path, doc);
    return doc;
  }
  async list(): Promise<Entry[]> {
    const entries = await this.io<(Omit<Entry, "kind"> & { kind?: "folder" })[]>({
      action: "list",
    });
    return entries
      .map((e) => ({
        ...e,
        kind: e.kind === "folder" ? ("folder" as Entry["kind"]) : kindOf(e.path),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  checkpoint(path: string, content: string, author = "Unsaved draft"): Promise<void> {
    return this.serial(async () => {
      this.validate(path);
      this.content(content);
      await this.io({ action: "checkpoint", path, content, author });
    });
  }
  async observe(path: string): Promise<void> {
    const previous = this.known.get(path);
    const disk = await this.read(path);
    if (previous && previous.hash !== disk.hash) {
      await this.checkpoint(path, previous.content, "Before external change");
      await this.checkpoint(path, disk.content, "External change");
    }
  }
  private content(content: string) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 20 * 1024 * 1024)
      throw new Error("Invalid document content");
  }
  write(path: string, content: string, hash: string, author = "You"): Promise<SaveResult> {
    return this.serial(async () => {
      this.validate(path);
      this.content(content);
      return this.io({ action: "write", path, content, hash, author });
    });
  }
  create(path: string, content: string): Promise<Document> {
    return this.serial(async () => {
      this.validate(path);
      this.content(content);
      return this.io({ action: "create", path, content });
    });
  }
  mkdir(path: string): Promise<void> {
    return this.serial(async () => {
      this.validate(path);
      await this.io({ action: "mkdir", path });
    });
  }
  importAttachment(path: string, source: string): Promise<string> {
    this.validate(path);
    return this.serial(() => this.io<string>({ action: "importAttachment", path, source }));
  }
  linkJournal(): Promise<
    (import("../shared/types").RenamePlan & { location: "source" | "target" | "unknown" }) | null
  > {
    return this.io({ action: "getLinkJournal", path: "link-rename" });
  }
  putLinkJournal(
    journal: import("../shared/types").RenamePlan,
    initial = false,
  ): Promise<import("../shared/types").RenamePlan> {
    return this.serial(() =>
      this.io({ action: "putLinkJournal", path: "link-rename", journal, initial }),
    );
  }
  clearLinkJournal(id: string): Promise<void> {
    return this.serial(() => this.io({ action: "clearLinkJournal", path: "link-rename", id }));
  }
  rename(path: string, newPath: string): Promise<void> {
    return this.serial(async () => {
      this.validate(path);
      this.validate(newPath);
      try {
        await this.io({ action: "rename", path, newPath });
      } finally {
        // A failed metadata migration can follow a successful filesystem move.
        this.known.clear();
      }
    });
  }
  trashEntry(path: string): Promise<void> {
    return this.serial(async () => {
      this.validate(path);
      await this.io({ action: "trashEntry", path });
      this.known.clear();
    });
  }
  versions(path: string): Promise<Version[]> {
    return this.serial(() => {
      this.validate(path);
      return this.io<Version[]>({ action: "versions", path });
    });
  }
  async restore(path: string, id: string, hash: string): Promise<SaveResult> {
    const version = (await this.versions(path)).find((v) => v.id === id);
    if (!version) throw new Error("Version not found");
    return this.write(path, version.content, hash, "Restored");
  }
  trash(path: string, hash: string): Promise<void> {
    return this.serial(async () => {
      this.validate(path);
      await this.io({ action: "trash", path, hash });
    });
  }
  trashList(): Promise<TrashItem[]> {
    return this.io({ action: "trashList" });
  }
  undelete(
    id: string,
  ): Promise<Document | { path: string; directory: boolean; size: number; content?: never }> {
    return this.serial(() => this.io({ action: "undelete", id }));
  }
  info(path: string): Promise<{ size: number; modified: number; mime: string }> {
    this.validate(path);
    return this.io({ action: "info", path });
  }
  stream(path: string, start = 0, end?: number) {
    this.validate(path);
    const child = spawn("/usr/bin/python3", [helper, this.root], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(JSON.stringify({ action: "stream", path, start, end }));
    return child;
  }
  searchText(
    paths: string[],
    query: string,
    signal: AbortSignal,
    consume: (record: {
      hits?: import("../shared/types").SearchHit[];
      pdf?: string;
      error?: { path: string; error: string };
    }) => void,
  ): Promise<void> {
    for (const path of paths) this.validate(path);
    return new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/python3", [helper, this.root], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "",
        error = "";
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      child.on("error", reject);
      child.stderr.on("data", (chunk) => {
        if (error.length < 2000) error += chunk;
      });
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const record = JSON.parse(line);
            if (record.ok === false) throw new Error(record.error);
            consume(record);
          } catch (error) {
            child.kill();
            reject(error);
          }
        }
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted || code !== 0) reject(new Error(error || "Search canceled"));
        else resolve();
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ action: "searchText", path: "search", paths, query }));
      if (signal.aborted) child.kill();
    });
  }
}
