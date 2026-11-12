import { it, expect } from "vite-plus/test";
import { spawn, execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGit } from "./git";
import { GitSync, MAX_SYNC_BYTES, conflictCopyName } from "./sync";

async function tempDir(files: Record<string, string | Buffer> = {}) {
  const root = await mkdtemp(join(tmpdir(), "grove-sync-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return root;
}
async function tempRepo(files: Record<string, string | Buffer> = {}, branch = "main") {
  const root = await tempDir(files);
  execFileSync("git", ["init", "-q", "-b", branch, root]);
  if (Object.keys(files).length) {
    const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, ...id, "commit", "-q", "-m", "init"]);
  }
  return root;
}
async function bareRepo() {
  const root = await mkdtemp(join(tmpdir(), "grove-remote-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", root]);
  return root;
}
async function gitIn(root: string, args: string[]) {
  return (await runGit(root, args)).stdout;
}
type SyncOptions = ConstructorParameters<typeof GitSync>[1];
async function twoDevices(files: Record<string, string | Buffer>, options: SyncOptions = {}) {
  const remote = await bareRepo();
  const device = async (name: string, content: Record<string, string | Buffer>) => {
    const root = await tempDir(content);
    const sync = new GitSync(root, { ...options, device: name });
    expect(await sync.connect({ url: remote })).toMatchObject({ state: "synced" });
    return { root, sync };
  };
  const a = await device("a", files);
  const b = await device("b", {});
  return { a, b, remote };
}

it("runs git in the vault and returns stdout", async () => {
  const root = await tempRepo();
  expect((await runGit(root, ["symbolic-ref", "--short", "HEAD"])).stdout.trim()).toBe("main");
});
function holdLock(root: string) {
  const holder = spawn("flock", [join(root, ".folio/io.lock"), "sh", "-c", "echo locked; sleep 1"]);
  return new Promise<typeof holder>((resolve) => holder.stdout.once("data", () => resolve(holder)));
}
it("waits for the vault io lock before a locked command", async () => {
  const root = await tempRepo();
  await mkdir(join(root, ".folio"));
  const holder = await holdLock(root);
  const started = Date.now();
  await runGit(root, ["status"], { locked: true });
  expect(Date.now() - started).toBeGreaterThanOrEqual(800);
  holder.kill();
});
it("a save waits for a running locked git command", async () => {
  const root = await tempRepo();
  const git = runGit(root, ["-c", "alias.wait=!sleep 1", "wait"], { locked: true });
  let gitDone = 0;
  void git.then(() => (gitDone = Date.now()));
  await new Promise((r) => setTimeout(r, 300));
  const helper = fileURLToPath(new URL("../../resources/vault_io.py", import.meta.url));
  const save = new Promise<number>((resolve, reject) => {
    const child = spawn("/usr/bin/python3", [helper, root]);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Date.now()) : reject(new Error(`exit ${code}`)),
    );
    child.stdin.end(JSON.stringify({ action: "create", path: "a.md", content: "saved" }));
  });
  const saved = await save;
  await git;
  expect(saved).toBeGreaterThanOrEqual(gitDone);
  expect(await readFile(join(root, "a.md"), "utf8")).toBe("saved");
});
it("classifies an unreachable remote as offline", async () => {
  const root = await tempRepo();
  await runGit(root, ["remote", "add", "origin", "https://127.0.0.1:9/none.git"]);
  await expect(runGit(root, ["fetch", "origin"])).rejects.toMatchObject({ kind: "offline" });
});
it("classifies offline even under a non-English locale", async () => {
  const saved = { LANG: process.env.LANG, LANGUAGE: process.env.LANGUAGE };
  process.env.LANG = process.env.LANGUAGE = "fr_FR.UTF-8";
  try {
    const root = await tempRepo();
    await runGit(root, ["remote", "add", "origin", "https://127.0.0.1:9/none.git"]);
    await expect(runGit(root, ["fetch", "origin"])).rejects.toMatchObject({ kind: "offline" });
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

it("initialises a plain folder, writes .gitignore and pushes to an empty remote", async () => {
  const remote = await bareRepo();
  const vault = await tempDir({ "Note.md": "# Hi\n" });
  const sync = new GitSync(vault, { device: "laptop" });
  const status = await sync.connect({ url: remote });
  expect(status).toMatchObject({ state: "synced", branch: "main" });
  expect(await readFile(join(vault, ".gitignore"), "utf8")).toContain(".folio/");
  expect(await gitIn(remote, ["show", "main:Note.md"])).toBe("# Hi\n");
  expect((await gitIn(vault, ["rev-parse", "--abbrev-ref", "@{u}"])).trim()).toBe("origin/main");
});
it("asks before enabling on a repo with uncommitted changes", async () => {
  const vault = await tempRepo({ "a.md": "1" });
  await writeFile(join(vault, "a.md"), "2");
  await writeFile(join(vault, "b.md"), "new");
  await mkdir(join(vault, ".folio"));
  await writeFile(join(vault, ".folio/x"), "state");
  const result = await new GitSync(vault).connect({ url: await bareRepo() });
  expect(result).toEqual({ needsConfirm: 2 });
  expect((await gitIn(vault, ["log", "--oneline"])).trim().split("\n")).toHaveLength(1);
  await expect(readFile(join(vault, ".gitignore"), "utf8")).rejects.toThrow();
});
it("uses the current branch name when it is not main", async () => {
  const vault = await tempRepo({ "a.md": "1" }, "notes");
  const remote = await bareRepo();
  const status = await new GitSync(vault).connect({ url: remote, confirmDirty: true });
  expect(status).toMatchObject({ branch: "notes" });
  expect((await gitIn(remote, ["rev-parse", "--verify", "notes"])).trim()).toMatch(
    /^[0-9a-f]{40}$/,
  );
  expect((await gitIn(vault, ["rev-parse", "--abbrev-ref", "@{u}"])).trim()).toBe("origin/notes");
});
it("gives a vault nested in another repo its own repository", async () => {
  const parent = await tempRepo({ "parent.txt": "p" });
  const parentRemote = await bareRepo();
  await runGit(parent, ["remote", "add", "origin", parentRemote]);
  const configBefore = await readFile(join(parent, ".git/config"), "utf8");
  const vault = join(parent, "vault");
  await mkdir(vault);
  await writeFile(join(vault, "Note.md"), "n");
  const remote = await bareRepo();
  await new GitSync(vault, { device: "laptop" }).connect({ url: remote });
  const files = (await gitIn(remote, ["ls-tree", "-r", "--name-only", "main"])).split("\n");
  expect(files).toContain("Note.md");
  expect(files).not.toContain("parent.txt");
  expect(await readFile(join(parent, ".git/config"), "utf8")).toBe(configBefore);
});
it("reports an error status on a detached HEAD and writes nothing", async () => {
  const vault = await tempRepo({ "a.md": "1" });
  await runGit(vault, ["checkout", "-q", "--detach"]);
  const status = await new GitSync(vault).connect({ url: await bareRepo(), confirmDirty: true });
  expect(status).toMatchObject({ state: "error", message: expect.stringContaining("branch") });
  await expect(readFile(join(vault, ".gitignore"), "utf8")).rejects.toThrow();
});
it("refuses a different existing origin and writes nothing", async () => {
  const vault = await tempRepo({ "a.md": "1" });
  const other = await bareRepo();
  await runGit(vault, ["remote", "add", "origin", other]);
  const status = await new GitSync(vault).connect({ url: await bareRepo(), confirmDirty: true });
  expect(status).toMatchObject({ state: "error", message: expect.stringContaining(other) });
  await expect(readFile(join(vault, ".gitignore"), "utf8")).rejects.toThrow();
});
it("rejects a url that looks like an option", async () => {
  const vault = await tempDir({ "a.md": "1" });
  const status = await new GitSync(vault).connect({ url: "--upload-pack=evil" });
  expect(status).toMatchObject({ state: "error" });
});

it("brings a change from device A into device B", async () => {
  const { a, b } = await twoDevices({ "Note.md": "one\n" });
  expect(await readFile(join(b.root, "Note.md"), "utf8")).toBe("one\n");
  await writeFile(join(a.root, "Note.md"), "two\n");
  await a.sync.syncNow();
  await b.sync.syncNow();
  expect(await readFile(join(b.root, "Note.md"), "utf8")).toBe("two\n");
});
it("keeps both versions when both devices edit the same line", async () => {
  const { a, b } = await twoDevices({ "Note.md": "one\n" });
  await writeFile(join(a.root, "Note.md"), "from a\n");
  await a.sync.syncNow();
  await writeFile(join(b.root, "Note.md"), "from b\n");
  const status = await b.sync.syncNow();
  expect(await readFile(join(b.root, "Note.md"), "utf8")).toBe("from b\n");
  const copy = status.conflicts[0];
  expect(copy).toMatch(/^Note \(conflict a \d{4}-\d{2}-\d{2}\)\.md$/);
  expect(await readFile(join(b.root, copy), "utf8")).toBe("from a\n");
  await a.sync.syncNow();
  expect(await readFile(join(a.root, copy), "utf8")).toBe("from a\n");
});
it("keeps an edited file that the other device deleted", async () => {
  const { a, b } = await twoDevices({ "Note.md": "one\n" });
  await rm(join(a.root, "Note.md"));
  await a.sync.syncNow();
  await writeFile(join(b.root, "Note.md"), "edited\n");
  await b.sync.syncNow();
  expect(await readFile(join(b.root, "Note.md"), "utf8")).toBe("edited\n");
  expect(await gitIn(b.root, ["show", "origin/main:Note.md"])).toBe("edited\n");
  await a.sync.syncNow();
  expect(await readFile(join(a.root, "Note.md"), "utf8")).toBe("edited\n");
});
it("restores a file deleted here that the other device edited", async () => {
  const { a, b } = await twoDevices({ "Note.md": "one\n" });
  await writeFile(join(a.root, "Note.md"), "edited on a\n");
  await a.sync.syncNow();
  await rm(join(b.root, "Note.md"));
  const status = await b.sync.syncNow();
  expect(status).toMatchObject({ state: "synced", conflicts: [] });
  expect(await readFile(join(b.root, "Note.md"), "utf8")).toBe("edited on a\n");
  expect(await gitIn(b.root, ["status", "--porcelain"])).toBe("");
  expect(await gitIn(b.root, ["show", "origin/main:Note.md"])).toBe("edited on a\n");
});
it("keeps both copies of a binary changed on both devices", async () => {
  const { a, b } = await twoDevices({ "photo.png": Buffer.from([1]) });
  await writeFile(join(a.root, "photo.png"), Buffer.from([2]));
  await a.sync.syncNow();
  await writeFile(join(b.root, "photo.png"), Buffer.from([3]));
  const status = await b.sync.syncNow();
  expect(status.conflicts[0]).toMatch(/^photo \(conflict a .+\)\.png$/);
});
it("writes a binary conflict copy byte-identical to the remote blob", async () => {
  const bytes = (seed: number) =>
    Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * seed) % 256));
  const { a, b } = await twoDevices({ "photo.png": bytes(1) });
  await writeFile(join(a.root, "photo.png"), bytes(7));
  await a.sync.syncNow();
  await writeFile(join(b.root, "photo.png"), bytes(13));
  const status = await b.sync.syncNow();
  expect((await readFile(join(b.root, status.conflicts[0]))).equals(bytes(7))).toBe(true);
  expect((await readFile(join(b.root, "photo.png"))).equals(bytes(13))).toBe(true);
});
it("skips files over 50 MB and lists them", async () => {
  const { a } = await twoDevices({});
  await truncate(join(a.root, "big.bin"), 51 * 1024 * 1024).catch(async () => {
    await writeFile(join(a.root, "big.bin"), "");
    await truncate(join(a.root, "big.bin"), 51 * 1024 * 1024);
  });
  const status = await a.sync.syncNow();
  expect(status.skipped).toEqual(["big.bin"]);
  expect(await gitIn(a.root, ["ls-files"])).not.toContain("big.bin");
});
it("does not commit a tracked file that grew over the limit", async () => {
  const { a } = await twoDevices({ "grow.bin": "small" });
  await truncate(join(a.root, "grow.bin"), MAX_SYNC_BYTES + 1);
  const status = await a.sync.syncNow();
  expect(status.skipped).toEqual(["grow.bin"]);
  expect(await gitIn(a.root, ["show", "HEAD:grow.bin"])).toBe("small");
});
it("queues commits while offline and pushes when back", async () => {
  const { a, remote } = await twoDevices({ "Note.md": "1\n" });
  await gitIn(a.root, ["remote", "set-url", "origin", "/nonexistent/repo.git"]);
  await writeFile(join(a.root, "Note.md"), "2\n");
  expect((await a.sync.syncNow()).state).toBe("offline");
  await gitIn(a.root, ["remote", "set-url", "origin", remote]);
  expect((await a.sync.syncNow()).state).toBe("synced");
  expect(await gitIn(remote, ["show", "main:Note.md"])).toBe("2\n");
});
it("returns the running cycle to a second syncNow call", async () => {
  const { a } = await twoDevices({ "Note.md": "1\n" });
  await a.sync.syncNow();
  const count = async () => (await gitIn(a.root, ["rev-list", "--count", "HEAD"])).trim();
  const before = Number(await count());
  await writeFile(join(a.root, "Note.md"), "2\n");
  const first = a.sync.syncNow();
  expect(a.sync.syncNow()).toBe(first);
  await first;
  expect(Number(await count())).toBe(before + 1);
  const next = a.sync.syncNow();
  expect(next).not.toBe(first);
  await next;
});
it("names conflict copies with the device and date, adding a number when taken", () => {
  const date = new Date(2026, 10, 12, 9, 30);
  expect(conflictCopyName("dir/Note.md", "a", date)).toBe("dir/Note (conflict a 2026-11-12).md");
  const taken = new Set(["Note (conflict a 2026-11-12).md", "Note (conflict a 2026-11-12) 2.md"]);
  expect(conflictCopyName("Note.md", "a", date, (p) => taken.has(p))).toBe(
    "Note (conflict a 2026-11-12) 3.md",
  );
  expect(conflictCopyName("README", "a", date)).toBe("README (conflict a 2026-11-12)");
});
it("keeps both versions of a file added on both devices", async () => {
  const { a, b } = await twoDevices({ "Note.md": "1\n" });
  await writeFile(join(a.root, "new.bin"), Buffer.from([0, 1, 2]));
  await a.sync.syncNow();
  await writeFile(join(b.root, "new.bin"), Buffer.from([0, 9, 9]));
  const status = await b.sync.syncNow();
  expect(status.state).toBe("conflict");
  expect((await readFile(join(b.root, "new.bin"))).equals(Buffer.from([0, 9, 9]))).toBe(true);
  expect((await readFile(join(b.root, status.conflicts[0]))).equals(Buffer.from([0, 1, 2]))).toBe(
    true,
  );
  expect(await gitIn(b.root, ["status", "--porcelain"])).toBe("");
});
it("keeps the local file as it is when a mode conflict is left unmerged", async () => {
  const { a, b } = await twoDevices({ "Note.md": "1\n" });
  await writeFile(join(a.root, "run.sh"), "from a\n");
  await a.sync.syncNow();
  await writeFile(join(b.root, "run.sh"), "from b\n", { mode: 0o755 });
  const status = await b.sync.syncNow();
  expect(status.state).toBe("conflict");
  expect(await readFile(join(b.root, "run.sh"), "utf8")).toBe("from b\n");
  expect(status.conflicts).toEqual([expect.stringMatching(/^run \(conflict a .+\)\.sh$/)]);
  expect(await readFile(join(b.root, status.conflicts[0]), "utf8")).toBe("from a\n");
  expect(await gitIn(b.root, ["status", "--porcelain"])).toBe("");
});
it("treats conflicted file names literally, not as globs", async () => {
  const { a, b } = await twoDevices({ "a*.md": "one\n", "abc.md": "base\n" });
  await writeFile(join(a.root, "a*.md"), "edited\n");
  await a.sync.syncNow();
  await rm(join(b.root, "a*.md"));
  // Dirty abc.md after Grove's own commit and before the merge: fetch runs this upload-pack.
  const hook = join(await tempDir(), "upload-pack");
  await writeFile(
    hook,
    `#!/bin/sh\nprintf 'dirty\\n' > '${join(b.root, "abc.md")}'\nexec git-upload-pack "$@"\n`,
    { mode: 0o755 },
  );
  await gitIn(b.root, ["config", "remote.origin.uploadpack", hook]);
  const status = await b.sync.syncNow();
  expect(status.state).toBe("synced");
  expect(await readFile(join(b.root, "a*.md"), "utf8")).toBe("edited\n");
  expect(await gitIn(b.root, ["show", "HEAD:abc.md"])).toBe("base\n");
  expect(await gitIn(b.root, ["status", "--porcelain"])).toBe(" M abc.md\n");
});
it("lists the file git moved aside in a file/folder conflict", async () => {
  const { a, b } = await twoDevices({ "x.md": "1\n" });
  await rm(join(a.root, "x.md"));
  await mkdir(join(a.root, "x.md"));
  await writeFile(join(a.root, "x.md/in.md"), "inner\n");
  await a.sync.syncNow();
  await writeFile(join(b.root, "x.md"), "2\n");
  const status = await b.sync.syncNow();
  expect(status.conflicts).toEqual(["x.md~HEAD"]);
  expect(await readFile(join(b.root, "x.md~HEAD"), "utf8")).toBe("2\n");
  expect(await readFile(join(b.root, "x.md/in.md"), "utf8")).toBe("inner\n");
});
async function preReceive(remote: string, script: string) {
  await writeFile(join(remote, "hooks/pre-receive"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
}
it("retries once after the remote rejects a push", async () => {
  const { a, remote } = await twoDevices({ "Note.md": "1\n" });
  const marker = join(remote, "rejected-once");
  await preReceive(remote, `[ -e '${marker}' ] && exit 0; touch '${marker}'; exit 1`);
  await writeFile(join(a.root, "Note.md"), "2\n");
  expect((await a.sync.syncNow()).state).toBe("synced");
  expect(await gitIn(remote, ["show", "main:Note.md"])).toBe("2\n");
});
it("reports an error when the remote keeps rejecting pushes", async () => {
  const { a, remote } = await twoDevices({ "Note.md": "1\n" });
  await preReceive(remote, "exit 1");
  await writeFile(join(a.root, "Note.md"), "2\n");
  expect(await a.sync.syncNow()).toMatchObject({
    state: "error",
    message: expect.stringContaining("rejected"),
  });
});
it("serialises connect with syncNow", async () => {
  const remote = await bareRepo();
  const vault = await tempDir({ "Note.md": "1\n" });
  const sync = new GitSync(vault, { device: "a" });
  const connecting = sync.connect({ url: remote });
  const syncing = sync.syncNow();
  expect(await connecting).toMatchObject({ state: "synced" });
  expect(await syncing).toMatchObject({ state: "synced" });
  expect(sync.syncNow()).not.toBe(syncing);
});
it("reports a filesystem failure as an error status instead of throwing", async () => {
  const { a } = await twoDevices({ "Note.md": "1\n" });
  await writeFile(join(a.root, "Note.md"), "2\n");
  await chmod(join(a.root, ".folio/io.lock"), 0);
  try {
    expect(await a.sync.syncNow()).toMatchObject({
      state: "error",
      message: expect.stringContaining("EACCES"),
    });
  } finally {
    await chmod(join(a.root, ".folio/io.lock"), 0o600);
  }
});

it("debounces several saves into one commit", async () => {
  const { a } = await twoDevices({ "Note.md": "1\n" }, { debounceMs: 200 });
  const mine = async () =>
    (await gitIn(a.root, ["log", "--format=%s", "HEAD"]))
      .split("\n")
      .filter((s) => s.startsWith("Grove: a ")).length;
  const before = await mine();
  for (const n of ["2", "3", "4"]) {
    await writeFile(join(a.root, "Note.md"), n + "\n");
    a.sync.schedule();
  }
  await new Promise((r) => setTimeout(r, 1000));
  a.sync.stop();
  expect(await mine()).toBe(before + 1);
  expect(await gitIn(a.root, ["show", "HEAD:Note.md"])).toBe("4\n");
});
