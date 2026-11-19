import { randomUUID, createHash } from "node:crypto";
import type { Vault } from "./vault";
import type { Document, LinkRef, RenamePlan } from "../shared/types";
import { parseLinks, renameReferences } from "../shared/links";
const moved = (path: string, source: string, target: string) =>
  path === source || path.startsWith(source + "/") ? target + path.slice(source.length) : path;
export class Links {
  private plans = new Map<string, RenamePlan>();
  private busy = false;
  private cache = new Map<
    string,
    { fingerprint: string; doc: Document; paths?: string; refs?: LinkRef[] }
  >();
  constructor(private vault: Vault) {}
  invalidate(path: string) {
    this.cache.delete(path);
  }
  private async documents(fresh = false) {
    const entries = await this.vault.list(),
      paths = entries.filter((e) => e.kind !== "folder").map((e) => e.path),
      docs = new Map<string, Document>();
    const markdown = entries.filter((e) => e.kind === "markdown"),
      pending = [];
    for (const entry of markdown) {
      const key = `${entry.modified}:${entry.size}`,
        cached = this.cache.get(entry.path);
      if (!fresh && cached?.fingerprint === key) {
        docs.set(entry.path, cached.doc);
        continue;
      }
      pending.push(entry);
    }
    let cursor = 0;
    while (cursor < pending.length) {
      const batch = [];
      let bytes = 0;
      while (
        cursor < pending.length &&
        batch.length < 32 &&
        (!batch.length || bytes + pending[cursor].size <= 1024 * 1024)
      ) {
        const entry = pending[cursor++];
        batch.push(entry);
        bytes += entry.size;
      }
      const records = await this.vault.readMany(batch.map((entry) => entry.path));
      for (const [index, record] of records.entries()) {
        if (record.document) {
          const entry = batch[index];
          this.cache.set(entry.path, {
            fingerprint: `${entry.modified}:${entry.size}`,
            doc: record.document,
          });
          docs.set(entry.path, record.document);
        } else if (fresh) {
          throw new Error(
            `Cannot inspect ${record.path}; fix the file or choose Rename only. ${record.error}`,
          );
        }
      }
    }
    const valid = new Set(paths);
    for (const path of this.cache.keys()) if (!valid.has(path)) this.cache.delete(path);
    return { paths, docs: markdown.flatMap((entry) => docs.get(entry.path) ?? []) };
  }
  async forPath(path: string) {
    const { paths, docs } = await this.documents(),
      pathsKey = JSON.stringify(paths);
    const refs = docs.flatMap((doc) => {
      const cached = this.cache.get(doc.path);
      if (!cached || cached.doc.hash !== doc.hash) return parseLinks(doc.path, doc.content, paths);
      if (cached.paths !== pathsKey || !cached.refs) {
        cached.refs = parseLinks(doc.path, doc.content, paths);
        cached.paths = pathsKey;
      }
      return cached.refs;
    });
    return {
      incoming: refs.filter((ref) => ref.targetPath === path && !ref.ambiguous),
      outgoing: refs.filter((ref) => ref.sourcePath === path),
      broken: refs.filter((ref) => ref.missing || ref.ambiguous),
    };
  }
  async plan(source: string, target: string): Promise<RenamePlan> {
    if (source === target) throw new Error("Choose a different name");
    await this.vault.path(source);
    await this.vault.path(target);
    if (await this.vault.linkJournal())
      throw new Error("Resolve the pending link rename from Backlinks first");
    const { paths, docs } = await this.documents(true);
    const files = docs.flatMap((doc) => {
      const content = renameReferences(doc.path, doc.content, paths, source, target);
      return content !== doc.content
        ? [
            {
              path: doc.path,
              newPath: moved(doc.path, source, target),
              hash: doc.hash,
              content,
              original: doc.content,
            },
          ]
        : [];
    });
    const plan = { id: randomUUID(), source, target, files };
    if (Buffer.byteLength(JSON.stringify(plan)) > 20 * 1024 * 1024)
      throw new Error("Link recovery plan exceeds 20 MB; use smaller moves");
    this.plans.clear();
    this.plans.set(plan.id, plan);
    return plan;
  }
  async recovery() {
    return this.vault.linkJournal();
  }
  async apply(id: string) {
    if (this.busy) throw new Error("A link rename is already running");
    this.busy = true;
    try {
      let recovery = await this.vault.linkJournal(),
        plan = recovery || this.plans.get(id);
      if (!plan || plan.id !== id || !Array.isArray(plan.files))
        throw new Error("Rename plan is missing or changed");
      if (!recovery) {
        for (const file of plan.files)
          if ((await this.vault.read(file.path)).hash !== file.hash)
            throw new Error(`${file.path} changed after planning. Preview the rename again.`);
        await this.vault.putLinkJournal(plan, true);
        recovery = await this.vault.linkJournal();
      }
      if (!recovery || recovery.location === "unknown")
        throw new Error("Rename source changed. Recovery journal retained for inspection.");
      if (recovery.location === "source") {
        for (const file of plan.files)
          if (!file.done && (await this.vault.read(file.path)).hash !== file.hash)
            throw new Error(
              `${file.path} changed. The rename has not started; recovery journal is retained.`,
            );
        await this.vault.rename(plan.source, plan.target);
      }
      plan = { ...plan, renamed: true };
      await this.vault.putLinkJournal(plan);
      for (const file of plan.files) {
        if (file.done) continue;
        const current = await this.vault.read(file.newPath),
          writtenHash = createHash("sha256").update(file.content).digest("hex");
        if (current.hash !== writtenHash) {
          if (current.hash !== file.hash)
            throw new Error(
              `${file.newPath} changed during rename. Both versions and recovery journal are retained. Restore or resolve this file before resuming.`,
            );
          const result = await this.vault.write(
            file.newPath,
            file.content,
            file.hash,
            "Rename link update",
          );
          if (result.status !== "saved")
            throw new Error(
              `${file.newPath} changed while updating links. Recovery journal retained.`,
            );
        }
        file.done = true;
        await this.vault.putLinkJournal(plan);
      }
      await this.vault.clearLinkJournal(plan.id);
      this.plans.delete(id);
      this.cache.clear();
    } finally {
      this.busy = false;
    }
  }
}
