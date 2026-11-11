import { randomUUID, createHash } from "node:crypto";
import type { Vault } from "./vault";
import type { Document, LinkRef, RenamePlan } from "../shared/types";
import { parseLinks, renameReferences } from "../shared/links";
const moved = (path: string, source: string, target: string) =>
  path === source || path.startsWith(source + "/") ? target + path.slice(source.length) : path;
export class Links {
  private plans = new Map<string, RenamePlan>();
  private busy = false;
  private cache = new Map<string, { fingerprint: string; doc: Document }>();
  constructor(private vault: Vault) {}
  invalidate(path: string) {
    this.cache.delete(path);
  }
  private async documents(fresh = false) {
    const entries = await this.vault.list(),
      paths = entries.filter((e) => e.kind !== "folder").map((e) => e.path),
      docs: Document[] = [];
    for (const entry of entries.filter((e) => e.kind === "markdown")) {
      const key = `${entry.modified}:${entry.size}`,
        cached = this.cache.get(entry.path);
      if (!fresh && cached?.fingerprint === key) {
        docs.push(cached.doc);
        continue;
      }
      try {
        const doc = await this.vault.read(entry.path);
        this.cache.set(entry.path, { fingerprint: key, doc });
        docs.push(doc);
      } catch (error) {
        if (fresh)
          throw new Error(
            `Cannot inspect ${entry.path}; fix the file or choose Rename only. ${String(error)}`,
          );
      }
    }
    for (const path of this.cache.keys()) if (!paths.includes(path)) this.cache.delete(path);
    return { paths, docs };
  }
  async forPath(path: string) {
    const { paths, docs } = await this.documents(),
      refs: LinkRef[] = docs.flatMap((doc) => parseLinks(doc.path, doc.content, paths));
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
