# Grove Web and Phone App Implementation Plan

Superseded by [Grove phone, web and landing workspaces](2026-11-12-grove-clients-workspaces.md). Keep this document as historical detail for the browser bridge; do not execute its PWA-only phone or publishing steps. The new plan includes React Native, current designs, shared workspace ownership and the implemented desktop formatting toolbar.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open and edit a synced Grove vault from any browser and from a phone home screen, reading and writing the vault's private GitHub repository directly.

**Architecture:** The existing React renderer is built a second time as a static web app. A web bridge installs its own `window.folio` (same `FolioAPI` contract as `src/preload/index.ts`) that talks to the GitHub REST API with a token the user pastes, keeps a cache and an offline queue in IndexedDB, and refuses desktop-only features with one clear message. The app is published under `https://dr1tch.github.io/grove/app/` in the same Pages artifact as the APT repository.

**Tech Stack:** Vite (second config next to `electron.vite.config.ts`), React renderer from `src/renderer`, GitHub REST API (git trees, blobs, contents, commits), IndexedDB (no wrapper library), a hand-written service worker, Vite+ (`vp check`, `vp test --run`), Playwright (Chromium, phone viewport) for QA.

**Spec:** `docs/specs/grove-sync-plugins.md` (sections "Shape" point 2, "Sync rules", "Web and phone rules"). Desktop sync it interoperates with: `src/main/sync.ts`.

## Global Constraints

- One vault = one GitHub repository and branch. The web root id is `github:<owner>/<repo>@<branch>`.
- Sign-in: a fine-grained personal access token limited to the vault repo (Contents: read and write), typed by the user and stored only in that browser (`localStorage` key `grove:web:token`). Never sent anywhere except `https://api.github.com`. Sign out deletes it.
- Every write sends the file's last known blob SHA. A mismatch (HTTP 409 or 422 "does not match") never overwrites: `write` returns `{ status: "conflict", disk }` so the existing comparison dialog opens.
- Commit message for every web commit: `Grove: <device> <ISO-8601 time>`, device default `browser` (desktop parses the device from this format).
- Never force-update a ref, never delete history. Files over 50 MB (`MAX_SYNC_BYTES`, same as desktop) are not uploaded.
- Paths in API URLs are encoded per segment with `encodeURIComponent`; names with spaces, `#`, `?`, accents and emoji must round-trip.
- Use the trees API (`git/trees/<branch>?recursive=1`) and a SHA-keyed IndexedDB cache; never one request per file on open except the bounded prefetch in Task 4.
- Desktop-only (Office previews, assistant, open externally, native PDF export, separate preview windows, folder picker, drag-in import from the OS) throws `Error("Available in the Grove desktop app")`; the UI's existing toast shows it.
- Mobile (width ≤ 700 px): the sidebar is a drawer, one pane at a time, controls at least 44 px tall.
- Do not change desktop behaviour. Desktop and web share the renderer; every web branch in renderer code keys off `window.folio.platform`.
- Publishing to GitHub Pages and tagging need the user's go-ahead.
- Decisions against the spec and roadmap, on purpose: no OAuth device flow (GitHub's device-flow endpoints send no CORS headers, so a browser cannot call them without a server, which the spec rules out); web deletes are real git deletions recoverable from history, not moves to `.trash/` (desktop ignores `.trash/` in `.gitignore` and keeps its own Trash layout there).

## Review Focus

- Token expired, revoked or without access to the repo: the sign-in screen says which ("Token rejected" vs "No access to owner/repo") and keeps the typed values. Test in Task 3.
- The same note edited on the phone and on the desktop: the phone's save returns a conflict and shows the comparison dialog; nothing is overwritten. Test in Task 2 (store) and Task 6 (UI).
- An edit made offline whose file changed remotely meanwhile: the remote file stays, the offline text is saved beside it as `Note (conflict browser <date>).md`. Test in Task 3.
- File names with spaces, `#`, accents and emoji round-trip through read, write, rename and asset URLs. Test in Task 2.
- A repository with a protected branch or a commit rejected by the server: the save shows the server's message and the text stays in the editor and the offline queue. Test in Task 2.

---

## File Structure

- Create `vite.web.config.ts`: web build of `src/renderer` with `base: "./"`, output `out/web`.
- Create `src/web/index.html`, `src/web/boot.tsx`: install the bridge, then mount the renderer `App`.
- Create `src/web/bridge.ts`: the web `FolioAPI` (method table, desktop-only refusals, events).
- Create `src/web/github.ts`: thin GitHub REST client (fetch, auth header, error mapping).
- Create `src/web/store.ts`: vault file layer over the client (tree, read, write, create, rename, delete, mkdir, asset, versions), blob SHA as `Document.hash`.
- Create `src/web/cache.ts`: IndexedDB cache (blobs by SHA, tree per root) and offline queue.
- Create `src/web/SignIn.tsx`: token, owner/repo, branch form.
- Create `src/web/sw.js`, `src/web/manifest.webmanifest`, icons copied from `build/icon.png`.
- Create `scripts/fake-github.mjs`: in-memory GitHub API used by unit tests and Playwright QA.
- Create `src/web/*.test.ts`, `scripts/web-qa.mjs`.
- Modify `src/shared/types.ts` (`FolioAPI.platform`), `src/preload/index.ts` (`platform: "desktop"`), `src/renderer/excalidraw-assets.ts` (relative URL), `src/renderer/App.tsx` and `styles.css` (hide desktop-only controls, mobile layout), `src/renderer/SyncSettings.tsx` (web variant), `package.json` (scripts), `.github/workflows/apt.yml` (publish `site/app`), `README.md`, `CHANGELOG.md`.

---

### Task 1: Web build target and bridge skeleton

**Files:**

- Create: `vite.web.config.ts`, `src/web/index.html`, `src/web/boot.tsx`, `src/web/bridge.ts`, `src/web/bridge.test.ts`
- Modify: `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/excalidraw-assets.ts`, `package.json`

**Interfaces:**

- Produces: `FolioAPI.platform: "desktop" | "web"` (preload sets `"desktop"`).
- Produces: `createWebBridge(store?: VaultStore): FolioAPI` in `src/web/bridge.ts`; `DESKTOP_ONLY = "Available in the Grove desktop app"`.
- Produces: `package.json` scripts `build:web` (`vite build -c vite.web.config.ts`) and `dev:web`.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses desktop-only methods with one message", async () => {
  const api = createWebBridge();
  for (const call of [
    () => api.agent("claude", "x", [], "r"),
    () => api.external("a.md"),
    () => api.openPreview("a.pdf", "r"),
    () => api.prepareExport({} as never, "r"),
  ])
    await expect(call()).rejects.toThrow("Available in the Grove desktop app");
});
it("reports platform web and persists state in localStorage", async () => {
  const api = createWebBridge();
  expect(api.platform).toBe("web");
  await api.persist({ sidebar: false });
  expect((await createWebBridge().state()).sidebar).toBe(false);
});
it("returns no vault before sign-in", async () => {
  expect(await createWebBridge().list()).toBeNull();
});
```

- [ ] **Step 2: Run** `vp test --run src/web/bridge.test.ts` — Expected: FAIL, module missing.

- [ ] **Step 3: Implement.** The bridge implements every `FolioAPI` key (TypeScript enforces completeness): desktop-only methods reject with `DESKTOP_ONLY`; `fonts()` returns `[]`; `copyText` uses `navigator.clipboard`; `window`, `draftsPending` (sets a `beforeunload` guard while true), `onOpen`, `onCloseRequest` are no-ops; `state`/`persist` use `localStorage` key `grove:web:state` through `cleanState`; vault methods delegate to the store (Task 2) and reject with `"Sign in first"` when none. `excalidraw-assets.ts` uses `new URL("excalidraw-assets/", location.href).href` (desktop resolves to the same `folio://app/excalidraw-assets/`). `vite.web.config.ts` copies `excalidraw-assets` the same way the desktop renderer build does.

- [ ] **Step 4: Run** `vp test --run src/web/bridge.test.ts && vp run build:web && vp run build && vp check` — Expected: PASS; `out/web/index.html` exists; desktop build unchanged (`scripts/smoke.mjs` against the dev build still passes).

---

### Task 2: GitHub client and vault store

**Files:**

- Create: `src/web/github.ts`, `src/web/store.ts`, `src/web/store.test.ts`, `scripts/fake-github.mjs`

**Interfaces:**

- Consumes: `Document`, `Entry`, `SaveResult`, `Version` from `src/shared/types.ts`; `kindOf` from `src/shared/files`.
- Produces: `class GitHubError extends Error { status: number; kind: "auth" | "no-access" | "not-found" | "conflict" | "rejected" | "offline" | "other" }`.
- Produces: `type RepoRef = { owner: string; repo: string; branch: string }`; `rootOf(ref): string` → `github:owner/repo@branch`.
- Produces: `class VaultStore { constructor(ref: RepoRef, token: string, options?: { fetch?: typeof fetch; device?: string }); list(): Promise<Entry[]>; read(path): Promise<Document>; write(path, content, hash): Promise<SaveResult>; create(path, content): Promise<Document>; createBytes(path, bytes: Uint8Array): Promise<void>; rename(path, newPath): Promise<void>; remove(path): Promise<void>; mkdir(path): Promise<void>; asset(path): Promise<string>; versions(path): Promise<Version[]>; head(): Promise<string> }`.
- Produces: `fakeGitHub({ owner, repo, branch, files, token })` returning `{ fetch, files: Map<string, Uint8Array>, commits: string[], reject?: (path) => string | undefined }` — a `fetch` implementing the endpoints the store uses.

- [ ] **Step 1: Write the failing tests** (all against `fakeGitHub`)

```ts
it("lists the tree and reads a note with its blob sha as hash", ...);           // Entry kinds, folders derived from paths
it("writes with the last sha and commits as Grove: browser <ISO>", ...);       // commits[0] matches /^Grove: browser \d{4}-\d\d-\d\dT/
it("returns a conflict instead of overwriting a newer remote file", ...);      // change fake file after read; write → { status: "conflict", disk.content: remote }
it("round-trips names with spaces, #, accents and emoji", ...);                // "dir/Café #1 🌱.md" read, write, rename, asset
it("keeps the text and reports the server message when a push is rejected", ...); // reject() → GitHubError kind "rejected", message from server
it("maps 401 to auth and 404 on the repo to no-access", ...);
it("refuses files over 50 MB", ...);                                            // createBytes with 50 MB + 1 byte rejects, nothing uploaded
it("mkdir creates <dir>/.gitkeep and list hides .gitkeep", ...);
it("remove deletes the file in one commit; versions lists earlier contents", ...);
```

- [ ] **Step 2: Run** `vp test --run src/web/store.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Endpoints: `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1`, `GET /repos/{o}/{r}/git/blobs/{sha}` (base64), `PUT /repos/{o}/{r}/contents/{path}` with `{ message, content, sha?, branch }`, `DELETE` same path with `sha`, `GET /repos/{o}/{r}/commits?path=&sha=branch&per_page=10` plus blob reads for `versions`. Rename = create at the new path then delete the old one (two commits; if the delete fails both copies exist, never zero). `Document.hash` = blob SHA; `asset` returns a `blob:` URL with the MIME type from the extension. Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. `fetch` network failure maps to kind `offline`.

- [ ] **Step 4: Run** `vp test --run src/web/store.test.ts && vp check` — Expected: PASS.

---

### Task 3: Sign-in, cache and offline queue

**Files:**

- Create: `src/web/cache.ts`, `src/web/SignIn.tsx`, `src/web/cache.test.ts`
- Modify: `src/web/bridge.ts`, `src/web/boot.tsx`

**Interfaces:**

- Consumes: `VaultStore`, `GitHubError`, `RepoRef` (Task 2).
- Produces: `class VaultCache { constructor(root: string, idb?: IDBFactory); getBlob(sha): Promise<Uint8Array | undefined>; putBlob(sha, bytes); getTree(): Promise<Entry[] | undefined>; putTree(entries); queue(path, content, baseSha): Promise<void>; pending(): Promise<{ path: string; content: string; baseSha: string }[]>; done(path): Promise<void> }`.
- Produces: `SignIn({ onSignedIn }: { onSignedIn: (ref: RepoRef, token: string) => void })`.
- Produces in the bridge: `openFolder()` shows `SignIn` (rendered by `boot.tsx` when no token) and resolves with `{ root, entries }`; `syncStatus` returns `synced`, `syncing` or `offline`; `syncNow` flushes the queue.

- [ ] **Step 1: Write the failing tests** (`fake-indexeddb` is NOT added; tests inject an in-memory `IDBFactory` stub written in the test file, or test the queue logic through a small in-memory backend the cache accepts)

```ts
it("reads from the cache when offline and queues writes", ...);       // store fetch throws → read returns cached doc; write returns saved, pending() has it
it("flushes the queue when back online", ...);                        // syncNow → remote content updated, pending() empty
it("saves an offline edit as a conflict copy when the remote changed", ...); // remote changed meanwhile → remote kept, "Note (conflict browser YYYY-MM-DD).md" holds the offline text
it("explains a rejected token and keeps the form values", ...);       // SignIn renders "Token rejected" for 401, "No access to owner/repo" for 404
```

- [ ] **Step 2: Run** `vp test --run src/web` — Expected: FAIL.

- [ ] **Step 3: Implement.** Conflict copy names use `conflictCopyName` semantics from `src/main/sync.ts` (move that pure function to `src/shared/conflicts.ts` and import it from both sides). The token form has fields Token, Repository (`owner/repo`), Branch (default `main`), a link to GitHub's fine-grained token page, and the sentence "Your token stays in this browser." Offline is detected from `GitHubError.kind === "offline"` and `navigator.onLine`; `online` and `visibilitychange` events trigger a flush.

- [ ] **Step 4: Run** `vp test --run src/web && vp check` — Expected: PASS.

---

### Task 4: Changes, search, links and attachments on the web

**Files:**

- Modify: `src/web/bridge.ts`
- Test: `src/web/bridge.test.ts`

**Interfaces:**

- Consumes: `VaultStore`, `VaultCache`.
- Produces: `onChange` events for paths whose blob SHA changed after polling `head()` every 60 s and on window focus; `startSearch`/`onSearch` over cached Markdown and text plus file names, in batches like the desktop `SearchBatch`; `linksFor` from cached notes with the parsers in `src/shared/links.ts`; `planRenameLinks` returns a plan with no files; `chooseAttachments` opens an `<input type="file" multiple>` and uploads to the note's `attachments` folder with the desktop naming rules (`src/main/attachments.ts` naming moved to shared if not already there).

- [ ] **Step 1: Write the failing tests**

```ts
it("emits onChange for files changed remotely", ...);
it("searches cached notes and file names", ...);
it("prefetches at most 300 Markdown files under 1 MB once per SHA", ...);   // second open does no blob requests
it("lists incoming and outgoing links from cached notes", ...);
it("uploads chosen attachments next to the note without overwriting", ...);
```

- [ ] **Step 2: Run** `vp test --run src/web/bridge.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the methods above.
- [ ] **Step 4: Run** `vp test --run src/web && vp check` — Expected: PASS.

---

### Task 5: Mobile layout, desktop-only controls and PWA

**Files:**

- Create: `src/web/sw.js`, `src/web/manifest.webmanifest`
- Modify: `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/renderer/SyncSettings.tsx`, `src/web/index.html`, `src/web/boot.tsx`

**Interfaces:**

- Consumes: `window.folio.platform`.

Rules: on `platform === "web"` hide window buttons, Assistant, Export, Open externally, Office "open with" actions and the folder picker; Settings > Sync shows "Synced with GitHub · owner/repo@branch", last sync, "Sync now" and "Sign out". At `max-width: 700px`: sidebar becomes a drawer over the document (toggle in the header, closes after opening a file), only the active pane renders, the tab strip scrolls horizontally, buttons and rows are at least 44 px tall. Service worker: network-first for `index.html`, cache-first for `assets/*` and `excalidraw-assets/*`, never caches `api.github.com`. Manifest: name "Grove", `display: "standalone"`, theme colour from the light theme accent, 192 and 512 px icons.

- [ ] **Step 1: Write `scripts/web-qa.mjs` (failing first).** Serve `out/web` with a static server, route `https://api.github.com/**` to `fakeGitHub`, Chromium at 390×844 with touch. Assert: sign-in form; signing in lists the vault; the drawer opens and closes; a note opens, edits save (fake commit appears); a remote change shows up after focus; a same-note conflict opens the comparison dialog; going offline (`context.setOffline(true)`) and editing then reconnecting flushes; Assistant and window controls are absent; screenshots light and dark at 390 px and 1280 px. Print `PASS: web sign-in, drawer, edit, remote change, conflict, offline queue, desktop-only hidden`.
- [ ] **Step 2: Run** `vp run build:web && node scripts/web-qa.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Run** `vp check && vp test --run && vp run build:web && node scripts/web-qa.mjs && vp run build && xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/visual-qa.mjs` (GROVE_VISUAL_DEV=1) — Expected: web QA PASS; desktop visual QA unchanged.

---

### Task 6: Publish and release

**Files:**

- Modify: `.github/workflows/apt.yml` (checkout the release tag, `pnpm install --frozen-lockfile`, `pnpm run build:web`, copy `out/web` to `site/app` before `upload-pages-artifact`), `package.json` (next minor version), `README.md` (Features: "Open your synced vault in any browser or on your phone at https://dr1tch.github.io/grove/app/"; Known limits: the desktop-only list), `CHANGELOG.md`.

- [ ] **Step 1: Full check:** `vp check && vp test --run && python3 scripts/vault-races.py && vp run build && vp run build:web && node scripts/web-qa.mjs`.
- [ ] **Step 2: Ask the user** before tagging and pushing (the tag publishes the web app).
- [ ] **Step 3: After the APT workflow:** `curl -sI https://dr1tch.github.io/grove/app/` returns 200 and `curl -s https://dr1tch.github.io/grove/Packages | grep ^Version` shows the new version.
- [ ] **Step 4: Real check with the user:** create a fine-grained token for the vault repo, sign in on the phone, add to home screen, edit a note, confirm the commit on GitHub and that desktop Grove pulls it.
