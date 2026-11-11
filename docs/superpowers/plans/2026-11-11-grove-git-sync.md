# Grove Desktop Git Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync a Grove vault between desktop PCs through a private GitHub repository, with automatic commit, pull and push, and no lost work on conflicts.

**Architecture:** A main-process `GitSync` class per open vault runs the system `git` binary. Every mutating git command runs under the vault's existing `.folio/io.lock` (via `flock(1)`), so it never interleaves with Grove's own safe writes. Pulled files change on disk, and the existing chokidar watcher plus external-change flow update open documents. Conflicts merge with local hunks winning and save the full remote version as a sibling conflict copy.

**Tech Stack:** Electron main process (TypeScript, `node:child_process`), system `git` 2.38+ (`merge-tree --write-tree`), `flock(1)` from util-linux, `gh` CLI for repo creation, React renderer, Vite+ (`vp check`, `vp test --run`), Playwright for native QA.

**Spec:** `docs/specs/grove-sync-plugins.md` (sections "Sync rules" and "Shape" point 1).

## Global Constraints

- Never force-push, never rewrite history, never run `git reset --hard`, `git clean` or `git checkout -- <path>`.
- Commit about 30 s after the last save (`SYNC_DEBOUNCE_MS = 30_000`, overridable by env `GROVE_SYNC_DEBOUNCE_MS` for tests). Commit message: `Grove: <hostname> <ISO-8601 time>`.
- Pull on vault open, on window focus when the last sync is older than 60 s, and every 5 minutes (`SYNC_INTERVAL_MS = 300_000`).
- `.gitignore` written on connect contains exactly: `.folio/`, `.trash/`, `*.before-export*`, `.DS_Store`, `Thumbs.db`, `node_modules/`.
- Files over 50 MB (`MAX_SYNC_BYTES = 50 * 1024 * 1024`) are never committed; they are added to `.git/info/exclude` and listed in status.
- Unsaved editor drafts are never committed; only bytes on disk are synced.
- Grove never stores a token. Auth comes from the user's existing git credential helper, `gh` or SSH.
- Sync is off until the user turns it on per vault in Settings > Sync.
- Linux only, like the rest of the vault layer.
- Leave changes uncommitted in the Grove repo unless the user asks; skip the plan's commit steps otherwise.

## Review Focus

- The vault is already a git repo for something else (a code project) with uncommitted changes: enabling sync must show the dirty file count and require confirmation before the first commit. Test in Task 2.
- The user saves while a pull or merge is running: the save waits for the lock and is never overwritten. Test in Task 1.
- Deleted on one device, edited on the other: the edited file survives. Test in Task 3.
- Binary file changed on both devices: both copies survive with the extension kept (`photo (conflict laptop 2026-11-12).png`). Test in Task 3.
- First push to an empty remote, or a remote whose default branch is not `main`: sync uses the local branch name and sets upstream. Test in Task 2.

---

## File Structure

- Create `src/main/git.ts`: one function that runs git (optionally under the vault lock) and classifies failures.
- Create `src/main/sync.ts`: the `GitSync` class: connect, cycle (commit, fetch, merge, push), conflict copies, large-file exclusion, scheduling.
- Create `src/main/sync.test.ts`: real git against temporary bare repos and clones.
- Modify `src/shared/types.ts`: `SyncStatus`, `SyncConnectRequest`, `AppState.sync`, `FolioAPI` methods.
- Modify `src/main/index.ts`: create/stop `GitSync` in `openVault`, IPC methods, triggers after writes, focus and interval.
- Modify `src/preload/index.ts`: expose methods and `onSync`.
- Create `src/renderer/SyncSettings.tsx`: Settings > Sync section.
- Modify `src/renderer/Appearance.tsx`: add the "sync" section to the settings nav.
- Modify `src/renderer/App.tsx:1296`: sidebar footer status line and conflict banner.
- Create `scripts/sync-qa.mjs`: native UI check against a local bare repo.
- Modify `README.md`, `CHANGELOG.md`, `package.json` version for 0.5.0.

---

### Task 1: Git runner with the vault lock

**Files:**

- Create: `src/main/git.ts`
- Test: `src/main/sync.test.ts`

**Interfaces:**

- Produces: `runGit(root: string, args: string[], options?: { locked?: boolean; input?: string }): Promise<{ stdout: string; stderr: string }>`; throws `GitError` with `kind: "offline" | "auth" | "conflict" | "not-repo" | "busy" | "other"` and `message`.
- Produces: `class GitError extends Error { kind: GitErrorKind }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("runs git in the vault and returns stdout", async () => {
  const root = await tempRepo(); // helper in the test file: mkdtemp + git init -b main
  expect((await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()).toBe("main");
});
it("waits for the vault io lock before a locked command", async () => {
  const root = await tempRepo();
  await mkdir(join(root, ".folio"));
  const holder = spawn("flock", [join(root, ".folio/io.lock"), "sleep", "1"]);
  await new Promise((r) => setTimeout(r, 100));
  const started = Date.now();
  await runGit(root, ["status"], { locked: true });
  expect(Date.now() - started).toBeGreaterThanOrEqual(800);
  holder.kill();
});
it("classifies an unreachable remote as offline", async () => {
  const root = await tempRepo();
  await runGit(root, ["remote", "add", "origin", "https://127.0.0.1:9/none.git"]);
  await expect(runGit(root, ["fetch", "origin"])).rejects.toMatchObject({ kind: "offline" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `vp test --run src/main/sync.test.ts`
Expected: FAIL, `runGit` not exported.

- [ ] **Step 3: Implement `runGit` in `src/main/git.ts`**

Use `execFile("git", ["-C", root, ...args])`, or `execFile("flock", [join(root, ".folio/io.lock"), "git", "-C", root, ...args])` when `locked` (create `.folio/` with mode 0o700 first). Set env `GIT_TERMINAL_PROMPT=0` so auth failures never hang. Classify from stderr: `Could not resolve host|Connection refused|Network is unreachable|timed out` = offline; `Authentication failed|Permission denied (publickey)|could not read Username` = auth; `CONFLICT` = conflict; `not a git repository` = not-repo; `index.lock` = busy.

- [ ] **Step 4: Run to verify they pass**

Run: `vp test --run src/main/sync.test.ts`
Expected: PASS (3 tests).

---

### Task 2: Connect a vault

**Files:**

- Create: `src/main/sync.ts`
- Modify: `src/shared/types.ts`
- Test: `src/main/sync.test.ts`

**Interfaces:**

- Consumes: `runGit`, `GitError` (Task 1).
- Produces in `src/shared/types.ts`:
  - `type SyncState = "off" | "synced" | "syncing" | "offline" | "conflict" | "error"`
  - `type SyncStatus = { state: SyncState; lastSync?: number; message?: string; remote?: string; branch?: string; conflicts: string[]; skipped: string[] }`
  - `type SyncConnectRequest = { url?: string; createName?: string; confirmDirty?: boolean }`
  - `AppState.sync?: Record<string, { enabled: boolean }>` keyed by vault root.
- Produces in `src/main/sync.ts`: `class GitSync { constructor(root: string, options?: { device?: string; debounceMs?: number; onStatus?: (s: SyncStatus) => void }); status(): SyncStatus; connect(request: SyncConnectRequest): Promise<SyncStatus | { needsConfirm: number }>; disable(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("initialises a plain folder, writes .gitignore and pushes to an empty remote", async () => {
  const remote = await bareRepo(); // git init --bare -b main
  const vault = await tempDir({ "Note.md": "# Hi\n" });
  const sync = new GitSync(vault, { device: "laptop" });
  const status = await sync.connect({ url: remote });
  expect(status).toMatchObject({ state: "synced", branch: "main" });
  expect(await readFile(join(vault, ".gitignore"), "utf8")).toContain(".folio/");
  expect(await gitIn(remote, ["show", "main:Note.md"])).toBe("# Hi\n");
});
it("asks before enabling on a repo with uncommitted changes", async () => {
  const vault = await tempRepo({ "a.md": "1" }); // initial commit
  await writeFile(join(vault, "a.md"), "2");
  await writeFile(join(vault, "b.md"), "new");
  const result = await new GitSync(vault).connect({ url: await bareRepo() });
  expect(result).toEqual({ needsConfirm: 2 });
  expect(await gitIn(vault, ["log", "--oneline"])).toHaveLength(1); // nothing committed
});
it("uses the current branch name when it is not main", async () => {
  const vault = await tempRepo({ "a.md": "1" }, "notes");
  const status = await new GitSync(vault).connect({ url: await bareRepo(), confirmDirty: true });
  expect(status).toMatchObject({ branch: "notes" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `vp test --run src/main/sync.test.ts`
Expected: FAIL, `GitSync` not exported.

- [ ] **Step 3: Implement `connect`**

`git init -b main` when `rev-parse` throws `not-repo`. Refuse with `GitError("other")` if `.git/rebase-merge`, `.git/rebase-apply` or `.git/MERGE_HEAD` exists ("Finish the merge in a terminal first"). Count `git status --porcelain` lines; when non-zero, the repo already had commits and `confirmDirty` is not true, return `{ needsConfirm: count }`. Append missing `.gitignore` lines from Global Constraints. With `createName`, run `gh repo create <createName> --private --source <root> --remote origin`; with `url`, add or update `origin`. Then run one `cycle()` (Task 3) and `git push -u origin <branch>`.

- [ ] **Step 4: Run to verify they pass**

Run: `vp test --run src/main/sync.test.ts`
Expected: PASS.

---

### Task 3: Sync cycle and conflict copies

**Files:**

- Modify: `src/main/sync.ts`
- Test: `src/main/sync.test.ts`

**Interfaces:**

- Produces: `GitSync.syncNow(): Promise<SyncStatus>` (serialised: a call during a running cycle returns the running cycle's promise); `conflictCopyName(path: string, device: string, date: Date): string`.

Cycle, all under `locked: true`:

1. Exclude files over `MAX_SYNC_BYTES` (append to `.git/info/exclude`, collect in `skipped`).
2. `git add -A`; commit with the Global Constraints message when anything is staged.
3. `git fetch origin`. Offline sets `state: "offline"` and stops (local commits stay queued).
4. If `origin/<branch>` is ahead: `git merge-tree --write-tree --name-only HEAD origin/<branch>`. Exit 0: `git merge --no-edit origin/<branch>`. Exit 1: the listed paths conflict; run `git merge --no-edit -X ours origin/<branch>`; for each conflicted path that exists on the remote side, write `git show origin/<branch>:<path>` bytes to `conflictCopyName(path, remoteDevice, now)` (remote device read from the last remote commit message, falling back to `remote`), `git add` and commit `Grove: keep both versions of N files`. For modify/delete conflicts where the local side deleted, restore the remote file instead of making a copy.
5. `git push origin <branch>`. A non-fast-forward rejection repeats steps 3 to 5 once, then reports `error`.

- [ ] **Step 1: Write the failing tests**

```ts
it("brings a change from device A into device B", async () => {
  const { a, b } = await twoDevices({ "Note.md": "one\n" }); // helper: bare remote + two connected clones
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
});
it("keeps both copies of a binary changed on both devices", async () => {
  const { a, b } = await twoDevices({ "photo.png": Buffer.from([1]) });
  await writeFile(join(a.root, "photo.png"), Buffer.from([2]));
  await a.sync.syncNow();
  await writeFile(join(b.root, "photo.png"), Buffer.from([3]));
  const status = await b.sync.syncNow();
  expect(status.conflicts[0]).toMatch(/^photo \(conflict a .+\)\.png$/);
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
it("queues commits while offline and pushes when back", async () => {
  const { a, remote } = await twoDevices({ "Note.md": "1\n" });
  await gitIn(a.root, ["remote", "set-url", "origin", "/nonexistent/repo.git"]);
  await writeFile(join(a.root, "Note.md"), "2\n");
  expect((await a.sync.syncNow()).state).toBe("offline");
  await gitIn(a.root, ["remote", "set-url", "origin", remote]);
  expect((await a.sync.syncNow()).state).toBe("synced");
  expect(await gitIn(remote, ["show", "main:Note.md"])).toBe("2\n");
});
```

A local path that does not exist reports `does not appear to be a git repository`; classify it as `offline` in Task 1's table too.

- [ ] **Step 2: Run to verify they fail**

Run: `vp test --run src/main/sync.test.ts`
Expected: FAIL, `syncNow` not defined.

- [ ] **Step 3: Implement `syncNow` and `conflictCopyName`**

`conflictCopyName("dir/Note.md", "a", date)` returns `"dir/Note (conflict a 2026-11-12).md"`; if that name exists, append ` 2`, ` 3`. Never use `git merge --abort` after files were written.

- [ ] **Step 4: Run to verify they pass**

Run: `vp test --run src/main/sync.test.ts`
Expected: PASS.

---

### Task 4: Wire sync into the app

**Files:**

- Modify: `src/main/index.ts` (`openVault` near line 100, `methods` record and the scoped-method list near line 401)
- Modify: `src/preload/index.ts` (methods list, event listeners)
- Modify: `src/shared/types.ts` (`FolioAPI`)
- Test: `src/main/sync.test.ts`

**Interfaces:**

- Consumes: `GitSync` (Tasks 2 and 3).
- Produces IPC methods (all vault-scoped, so the root is the last argument): `syncStatus(): SyncStatus`, `syncConnect(request: SyncConnectRequest): SyncStatus | { needsConfirm: number }`, `syncNow(): SyncStatus`, `syncDisable(): SyncStatus`. Event channel `folio:sync` carrying `SyncStatus`; preload `onSync(callback)` returns an unsubscribe function like `onChange`.
- Produces: `GitSync.schedule(): void` (debounced commit-and-sync), `GitSync.start(): void` (interval and first sync), `GitSync.stop(): void`.

- [ ] **Step 1: Write the failing test**

```ts
it("debounces several saves into one commit", async () => {
  const { a } = await twoDevices({ "Note.md": "1\n" }, { debounceMs: 200 });
  for (const n of ["2", "3", "4"]) {
    await writeFile(join(a.root, "Note.md"), n + "\n");
    a.sync.schedule();
  }
  await new Promise((r) => setTimeout(r, 600));
  expect((await gitIn(a.root, ["log", "--oneline"])).trim().split("\n")).toHaveLength(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `vp test --run src/main/sync.test.ts`
Expected: FAIL, `schedule` not defined.

- [ ] **Step 3: Implement scheduling and wiring**

In `openVault`, stop the previous vault's `GitSync`, and create and `start()` a new one only when `state.sync?.[resolved]?.enabled`. Call `schedule()` after successful `write`, `create`, `rename`, `trashEntry`, `importAttachments` and `pasteScreenshot`. On `win.on("focus")`, call `syncNow()` when `lastSync` is older than 60 s. `syncConnect` sets `state.sync[root] = { enabled: true }` and saves state on success; `syncDisable` sets it to false and stops the timers, leaving `.git` untouched. Forward `onStatus` to `win.webContents.send("folio:sync", status)`.

- [ ] **Step 4: Run to verify it passes**

Run: `vp test --run src/main/sync.test.ts && vp check`
Expected: PASS, no lint or type errors.

---

### Task 5: Settings > Sync, footer status and conflict banner

**Files:**

- Create: `src/renderer/SyncSettings.tsx`
- Modify: `src/renderer/Appearance.tsx:15,63` (add `"sync"` section with a `RefreshCw` icon, title "Sync")
- Modify: `src/renderer/App.tsx:1296` (footer line), `src/renderer/styles.css`
- Create: `scripts/sync-qa.mjs`

**Interfaces:**

- Consumes: `window.folio.syncStatus/syncConnect/syncNow/syncDisable/onSync` (Task 4).
- Produces: `SyncSettings({ root }: { root: string })` React component.

UI copy (exact):

- Off: heading "Sync this vault with GitHub", buttons "Create private repository" (asks for a name, default the folder name) and "Use existing repository" (URL field).
- Dirty confirm: "This folder is already a git repository with {n} uncommitted changes. Grove will commit them and sync from now on." Buttons "Commit and sync" and "Cancel".
- On: remote URL, branch, last sync time, "Sync now", "Turn off sync" (note under it: "Your files and git history stay as they are.").
- Skipped: "Not synced (over 50 MB): {paths}".
- Footer (replaces "Local folder · opened in place" when sync is on): "Synced 2 min ago", "Syncing…", "Offline · changes saved locally", "Conflict · {n} files kept both ways", "Sync error". Clicking it opens Settings > Sync.
- Conflict banner above the document when the open file has a conflict copy: "Another device changed this file at the same time. Both versions are kept." Button "Compare side by side" runs the existing Open beside with the copy.

- [ ] **Step 1: Write `scripts/sync-qa.mjs` (failing first)**

Follow `scripts/panes-qa.mjs` setup. Create a bare repo and a vault, launch with `GROVE_SYNC_DEBOUNCE_MS=500`, open Settings > Sync, paste the bare repo path into "Use existing repository", assert the footer shows `Synced`. Edit `Note.md` in the editor, wait 2 s, assert `git -C <bare> show main:Note.md` contains the edit. Commit a change to the bare repo from a second clone, click the footer and "Sync now", assert the open note shows the new text. Make a same-line conflict, assert the banner and that "Compare side by side" opens two panes. Print `PASS: sync settings, auto commit, pull into open note, conflict banner`.

- [ ] **Step 2: Run to verify it fails**

Run: `vp run build && xvfb-run -a node scripts/sync-qa.mjs`
Expected: FAIL, no "Sync" settings section.

- [ ] **Step 3: Implement the components and copy above**

- [ ] **Step 4: Run to verify it passes**

Run: `vp check && vp run build && xvfb-run -a node scripts/sync-qa.mjs && xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/visual-qa.mjs`
Expected: `PASS: sync settings, ...`; visual run reports no overflow; screenshots show the footer in light and dark.

---

### Task 6: Release 0.5.0

**Files:**

- Modify: `package.json` (version `0.5.0`), `CHANGELOG.md` (move Unreleased into `## 0.5.0`, add sync entries), `README.md` (Features > Organising: "Sync a vault between computers through a private GitHub repository"; Known limits: "Sync needs git and either the gh CLI or SSH access to GitHub").

- [ ] **Step 1: Full check**

Run: `vp check && vp test --run && python3 scripts/vault-races.py && vp run build`
Expected: all pass.

- [ ] **Step 2: Package, install and smoke**

Run: `vp run package`, then install `release/folio_0.5.0_amd64.deb` with `pkexec /usr/bin/apt install -y <absolute path>`, then `FOLIO_SMOKE_EXECUTABLE=/opt/Grove/folio xvfb-run -a node scripts/smoke.mjs`.
Expected: `dpkg -s folio` shows `0.5.0`; smoke prints `PASS`.

- [ ] **Step 3: Real GitHub check (with the user)**

Ask the user before creating a GitHub repository. Connect a scratch vault with "Create private repository", edit on this machine, confirm the commit on GitHub. Then ask the user before tagging `v0.5.0` and pushing.
