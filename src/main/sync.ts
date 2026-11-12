import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SyncConnectRequest, SyncStatus } from "../shared/types";
import { GitError, ensureLock, runGit } from "./git";

import { conflictCopyName, MAX_SYNC_BYTES } from "@grove/core/conflicts";
export { conflictCopyName, MAX_SYNC_BYTES } from "@grove/core/conflicts";

export const SYNC_DEBOUNCE_MS = Number(process.env.GROVE_SYNC_DEBOUNCE_MS) || 30_000;
export const SYNC_INTERVAL_MS = 300_000;
const SKIP_HEADER = "# Grove: not synced, over 50 MB";

const WRITE_SCRIPTS = {
  create: 'set -C; cat > "$1"', // noclobber: fails if the file already exists
  append: 'cat >> "$1"',
  // Replace only while the file still hashes to $2; otherwise discard the input.
  "replace-if":
    'if [ "$(git hash-object -- "$1")" = "$2" ]; then cat > "$1"; else cat > /dev/null; fi',
};

/** Writes a file while holding the vault io lock. */
async function writeLocked(
  root: string,
  file: string,
  data: Buffer | string,
  mode: keyof typeof WRITE_SCRIPTS,
  expectedHash = "",
) {
  const lock = await ensureLock(root);
  const script = WRITE_SCRIPTS[mode];
  await new Promise<void>((done, fail) => {
    const child = execFile(
      "flock",
      [lock, "/bin/sh", "-c", script, "sh", file, expectedHash],
      { cwd: root },
      (error, _o, stderr) =>
        error ? fail(new GitError("other", stderr.trim() || error.message, "", stderr)) : done(),
    );
    // The shell may exit without reading (e.g. noclobber refused); the callback reports it.
    child.stdin?.on("error", () => {});
    child.stdin?.end(data);
  });
}

const isRejected = (error: unknown) =>
  error instanceof GitError &&
  /\[(remote )?rejected\]|non-fast-forward|fetch first/.test(error.stderr);

export const GITIGNORE_LINES = [
  ".folio/",
  ".trash/",
  "*.before-export*",
  ".DS_Store",
  "Thumbs.db",
  "node_modules/",
];

type Options = {
  device?: string;
  debounceMs?: number;
  onStatus?: (s: SyncStatus) => void;
};

export class GitSync {
  private current: SyncStatus = { state: "off", conflicts: [], skipped: [] };
  private device: string;
  private running?: Promise<SyncStatus>;
  private debounce?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;

  constructor(
    readonly root: string,
    private options: Options = {},
  ) {
    this.device = options.device ?? hostname();
  }

  status(): SyncStatus {
    return this.current;
  }

  /** Commits and syncs once saves stop for the debounce period; repeated calls restart the wait. */
  schedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.syncNow();
    }, this.options.debounceMs ?? SYNC_DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Runs a first sync and then one every SYNC_INTERVAL_MS. */
  start(): void {
    this.stop();
    void this.syncNow();
    this.interval = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    this.interval.unref();
  }

  stop(): void {
    clearTimeout(this.debounce);
    clearInterval(this.interval);
    this.debounce = this.interval = undefined;
  }

  disable(): void {
    this.stop();
    this.setStatus({ state: "off", conflicts: [], skipped: [] });
  }

  /** Connects the vault; waits for a running cycle and holds the same slot as syncNow. */
  async connect(request: SyncConnectRequest): Promise<SyncStatus | { needsConfirm: number }> {
    while (this.running) await this.running;
    const result = this.connectNow(request);
    this.running = result
      .then((r) => ("needsConfirm" in r ? this.current : r))
      .finally(() => (this.running = undefined));
    return result;
  }

  private async connectNow(
    request: SyncConnectRequest,
  ): Promise<SyncStatus | { needsConfirm: number }> {
    try {
      const target = request.createName ?? request.url;
      if (target?.startsWith("-")) throw new GitError("other", "Invalid repository URL or name.");
      await this.ensureRepo();
      await this.assertNotMerging();
      const branch = await this.branch();
      const origin = (await this.git("remote", "get-url", "origin").catch(() => "")).trim();
      if (origin && (request.createName || (request.url && request.url !== origin)))
        throw new GitError(
          "other",
          `This repository's origin already points to ${origin}. Use that URL or change it in a terminal.`,
        );
      const hasCommits = await this.ok("rev-parse", "--verify", "-q", "HEAD");
      const dirty = await this.dirtyCount();
      if (hasCommits && dirty > 0 && !request.confirmDirty) return { needsConfirm: dirty };
      await this.writeGitignore();
      if (request.createName) await this.createRemote(request.createName);
      else if (request.url && !origin)
        await this.git("remote", "add", "origin", "--", request.url, { locked: true });
      const remote = (await this.git("remote", "get-url", "origin")).trim();
      this.current = { ...this.current, remote };
      await this.sync(branch, true);
    } catch (error) {
      this.fail(error);
    }
    return this.current;
  }

  /** Commit, fetch, merge and push. A call during a running cycle returns that cycle. */
  syncNow(): Promise<SyncStatus> {
    this.running ??= (async () => {
      try {
        await this.assertNotMerging();
        await this.sync(await this.branch(), false);
      } catch (error) {
        this.fail(error);
      }
      return this.current;
    })().finally(() => (this.running = undefined));
    return this.running;
  }

  private async sync(branch: string, upstream: boolean): Promise<void> {
    this.setStatus({
      ...this.current,
      state: "syncing",
      branch,
      conflicts: [],
      message: undefined,
    });
    await this.cycle(branch, upstream);
    const state = this.current.conflicts.length ? "conflict" : "synced";
    this.setStatus({ ...this.current, state, lastSync: Date.now() });
  }

  /** Maps any failure to a status; never rethrows, so the state cannot stay "syncing". */
  private fail(error: unknown): void {
    const kind = error instanceof GitError ? error.kind : "other";
    const state = kind === "offline" ? "offline" : kind === "conflict" ? "conflict" : "error";
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus({ ...this.current, state, message });
  }

  private async cycle(branch: string, upstream: boolean): Promise<void> {
    const skipped = await this.excludeLarge();
    this.current = { ...this.current, skipped };
    const keepOut = skipped.map((p) => `:(exclude,literal)${p}`);
    await this.git("add", "-A", "--", ".", ...keepOut, { locked: true });
    if (!(await this.ok("diff", "--cached", "--quiet", { locked: true })))
      await this.commit("-m", `Grove: ${this.device} ${new Date().toISOString()}`);
    for (let attempt = 0; ; attempt++) {
      await this.git("fetch", "origin");
      await this.merge(branch);
      if (!(await this.ok("rev-parse", "--verify", "-q", "HEAD"))) return;
      try {
        await this.git("push", ...(upstream ? ["-u"] : []), "origin", branch);
        return;
      } catch (error) {
        if (attempt > 0 || !isRejected(error)) throw error;
      }
    }
  }

  /** Merges origin/<branch>, keeping local versions and writing remote ones as conflict copies. */
  private async merge(branch: string): Promise<void> {
    const theirs = `origin/${branch}`;
    if (!(await this.ok("rev-parse", "--verify", "-q", `refs/remotes/${theirs}`))) return;
    const hasHead = await this.ok("rev-parse", "--verify", "-q", "HEAD");
    if (hasHead && (await this.ok("merge-base", "--is-ancestor", theirs, "HEAD"))) return;
    const merge = async (...extra: string[]) =>
      this.git(
        ...(await this.identity()),
        "merge",
        "--no-edit",
        "--allow-unrelated-histories",
        ...extra,
        theirs,
        { locked: true },
      );
    let conflicted: string[] = [];
    if (hasHead)
      try {
        await this.git(
          "merge-tree",
          "--write-tree",
          "--name-only",
          "-z",
          "--allow-unrelated-histories",
          "HEAD",
          theirs,
        );
      } catch (error) {
        if (!(error instanceof GitError) || error.code !== 1) throw error;
        // <tree>\0<path>\0...\0\0<messages>
        const fields = error.stdout.split("\0");
        conflicted = fields.slice(1, fields.indexOf("", 1));
      }
    if (!conflicted.length) return void (await merge());

    const device = await this.remoteDevice(theirs);
    try {
      await merge("-X", "ours");
    } catch (error) {
      if (!(await this.merging())) throw error; // stopped before writing anything
    }
    const now = new Date();
    const copies: string[] = [];
    const resolved: string[] = [];
    const renamed: string[] = [];
    const unmerged = await this.unmerged();
    for (const [path, stages] of unmerged) {
      if (Object.values(stages).some((s) => !/^100(644|755)$/.test(s.mode)))
        throw new GitError(
          "conflict",
          `Could not merge ${path} automatically. Finish the merge in a terminal.`,
        );
    }
    for (const [path, { 2: ours, 3: remote }] of unmerged) {
      const abs = join(this.root, path);
      if (ours && remote) {
        // Local wins and stays as it is on disk; the remote side becomes a conflict copy.
        await this.dropConflictMarkers(path, await this.blob(ours.oid));
        copies.push(await this.writeCopy(path, device, now, await this.blob(remote.oid)));
      } else if (ours) {
        // Edited here, deleted there: keep local.
        if (!existsSync(abs)) await this.writeFile(path, await this.blob(ours.oid));
      } else if (remote) {
        // Deleted here, edited there: restore the remote file.
        if (!existsSync(abs)) await this.writeFile(path, await this.blob(remote.oid));
      } else {
        // Deleted on both sides (rename leftovers): drop the index entry only.
        await this.git("--literal-pathspecs", "rm", "--cached", "-q", "--", path, {
          locked: true,
        });
        continue;
      }
      resolved.push(path);
      // A path missing from its own side was renamed by git (e.g. `x.md~HEAD` beside a folder).
      if (!(await this.ok("cat-file", "-e", `${ours ? "HEAD" : theirs}:${path}`)))
        renamed.push(path);
    }
    for (const path of conflicted) {
      if (unmerged.has(path) || !(await this.ok("cat-file", "-e", `${theirs}:${path}`))) continue;
      const remote = await this.blob(`${theirs}:${path}`);
      const local = await readFile(join(this.root, path)).catch(() => null);
      if (local?.equals(remote)) continue;
      copies.push(await this.writeCopy(path, device, now, remote));
    }
    const kept = [...copies, ...renamed];
    this.current = { ...this.current, conflicts: [...this.current.conflicts, ...kept] };
    // Literal pathspecs: a file named `a*.md` must not stage `abc.md`.
    if (resolved.length)
      await this.git("--literal-pathspecs", "add", "--", ...resolved, { locked: true });
    if (copies.length)
      await this.git("--literal-pathspecs", "add", "-f", "--", ...copies, { locked: true });
    const message = ["-m", `Grove: keep both versions of ${kept.length} files`];
    if (await this.merging()) await this.commit(...(kept.length ? message : ["--no-edit"]));
    else if (copies.length) await this.commit(...message);
  }

  private async writeCopy(path: string, device: string, date: Date, data: Buffer): Promise<string> {
    const name = conflictCopyName(path, device, date, (p) => existsSync(join(this.root, p)));
    await this.writeFile(name, data);
    return name;
  }

  /** Writes a new vault file under the io lock; never replaces an existing file. */
  private async writeFile(path: string, data: Buffer): Promise<void> {
    const abs = join(this.root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeLocked(this.root, abs, data, "create");
  }

  /**
   * If the merge left conflict markers in `path`, puts the local version back, but only when
   * the file still has the bytes the merge wrote (checked under the same lock hold as the
   * write). Anything else on disk, such as a save made since, is kept.
   */
  private async dropConflictMarkers(path: string, ours: Buffer): Promise<void> {
    const disk = await readFile(join(this.root, path)).catch(() => null);
    if (!disk || !/^<{7} [^]*^>{7} /m.test(disk.toString("latin1"))) return;
    // Hash the bytes checked above, not a re-read: a save after this point must not match.
    const merged = (
      await runGit(this.root, ["hash-object", "--stdin", "--path", path], { input: disk })
    ).stdout
      .toString()
      .trim();
    await writeLocked(this.root, join(this.root, path), ours, "replace-if", merged);
  }

  private async blob(spec: string): Promise<Buffer> {
    return (await runGit(this.root, ["cat-file", "blob", spec], { raw: true })).stdout;
  }

  private async unmerged(): Promise<Map<string, Record<number, { mode: string; oid: string }>>> {
    const map = new Map<string, Record<number, { mode: string; oid: string }>>();
    for (const line of (await this.git("ls-files", "-u", "-z")).split("\0").filter(Boolean)) {
      const [info, path] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1)];
      const [mode, oid, stage] = info.split(" ");
      map.set(path, { ...map.get(path), [Number(stage)]: { mode, oid } });
    }
    return map;
  }

  /** Device name from the newest `Grove: <device> <ISO time>` commit only on the remote. */
  private async remoteDevice(theirs: string): Promise<string> {
    const subjects = await this.git("log", "--format=%s", "-n", "200", `HEAD..${theirs}`).catch(
      () => "",
    );
    for (const subject of subjects.split("\n")) {
      const match = /^Grove: (\S+) \d{4}-\d{2}-\d{2}T/.exec(subject);
      if (match) return match[1];
    }
    return "remote";
  }

  /** Adds untracked files over MAX_SYNC_BYTES to info/exclude; returns every file skipped for size. */
  private async excludeLarge(): Promise<string[]> {
    const file = resolve(
      this.root,
      (await this.git("rev-parse", "--git-path", "info/exclude")).trim(),
    );
    const text = await readFile(file, "utf8").catch(() => "");
    const lines = text.split("\n");
    const at = lines.indexOf(SKIP_HEADER);
    const listed =
      at < 0
        ? []
        : lines
            .slice(at + 1)
            .filter((l) => l.startsWith("/"))
            .map((l) => l.slice(1).replace(/\\(.)/g, "$1"));
    const out = await this.git("ls-files", "-o", "-m", "--exclude-standard", "-z");
    const skipped: string[] = [];
    for (const path of new Set([...out.split("\0").filter(Boolean), ...listed])) {
      const stat = await lstat(join(this.root, path)).catch(() => null);
      if (stat?.isFile() && stat.size > MAX_SYNC_BYTES) skipped.push(path);
    }
    const add = skipped.filter((p) => !listed.includes(p) && !p.includes("\n"));
    if (add.length) {
      const header = at < 0 ? `${text && !text.endsWith("\n") ? "\n" : ""}${SKIP_HEADER}\n` : "";
      const entries = add.map((p) => `/${p.replace(/[\\*?[\]!# ]/g, "\\$&")}\n`).join("");
      await mkdir(dirname(file), { recursive: true });
      await writeLocked(this.root, file, header + entries, "append");
    }
    return skipped.sort();
  }

  private async commit(...args: string[]): Promise<void> {
    await this.git(...(await this.identity()), "commit", "-q", ...args, { locked: true });
  }

  private async merging(): Promise<boolean> {
    const path = (await this.git("rev-parse", "--git-path", "MERGE_HEAD")).trim();
    return existsSync(resolve(this.root, path));
  }

  private async assertNotMerging(): Promise<void> {
    for (const marker of ["MERGE_HEAD", "rebase-merge", "rebase-apply"]) {
      const path = (await this.git("rev-parse", "--git-path", marker)).trim();
      if (existsSync(resolve(this.root, path)))
        throw new GitError("conflict", "Finish the merge in a terminal first.");
    }
  }

  private async branch(): Promise<string> {
    try {
      return (await this.git("symbolic-ref", "--short", "HEAD")).trim();
    } catch {
      throw new GitError("other", "Check out a branch first.");
    }
  }

  private async ensureRepo(): Promise<void> {
    try {
      const top = (await this.git("rev-parse", "--show-toplevel")).trim();
      if ((await realpath(top)) === (await realpath(this.root))) return;
    } catch (error) {
      if (!(error instanceof GitError) || error.kind !== "not-repo") throw error;
    }
    await this.git("init", "-b", "main", { locked: true });
  }

  private async dirtyCount(): Promise<number> {
    const out = await this.git("status", "--porcelain");
    return out
      .split("\n")
      .filter(Boolean)
      .filter((line) => !/^.. "?\.(folio|trash)\//.test(line)).length;
  }

  private async writeGitignore(): Promise<void> {
    const file = join(this.root, ".gitignore");
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {}
    const have = new Set(text.split("\n").map((l) => l.trim()));
    const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
    if (!missing.length) return;
    const prefix = text && !text.endsWith("\n") ? "\n" : "";
    await writeFile(file, `${text}${prefix}${missing.join("\n")}\n`);
  }

  private createRemote(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        "gh",
        ["repo", "create", name, "--private", "--source", this.root, "--remote", "origin"],
        (error, _out, stderr) =>
          error
            ? reject(new GitError("other", stderr.trim() || error.message, "", stderr))
            : resolve(),
      );
    });
  }

  private async identity(): Promise<string[]> {
    const email = await this.git("config", "user.email").catch(() => "");
    return email.trim()
      ? []
      : ["-c", `user.name=${this.device}`, "-c", `user.email=grove@${this.device}`];
  }

  private async git(...args: (string | { locked?: boolean })[]): Promise<string> {
    const last = args[args.length - 1];
    const options = typeof last === "object" ? last : {};
    const argv = args.filter((a): a is string => typeof a === "string");
    return (await runGit(this.root, argv, options)).stdout;
  }

  private async ok(...args: (string | { locked?: boolean })[]): Promise<boolean> {
    try {
      await this.git(...args);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  private setStatus(status: SyncStatus): void {
    this.current = status;
    this.options.onStatus?.(status);
  }
}
