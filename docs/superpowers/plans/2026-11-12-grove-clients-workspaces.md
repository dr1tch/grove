# Grove Phone, Web and Landing Page Implementation Plan

> For execution, use `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Read the spec first. This request asks for a plan, not client implementation or publishing.

**Goal:** Deliver a React Native phone app, a browser app and a landing page in pnpm workspaces, all consistent with the agreed Grove designs and private-GitHub sync.

**Architecture:** Keep the working Electron app at the repository root. Add separate mobile, web and landing app workspaces. Share existing pure helpers through `@grove/core`, and implement one GitHub vault store with native SQLite and browser IndexedDB storage adapters. Browser uses the existing renderer; phone uses a native shell with a bounded, isolated document surface.

**Tech stack:** Existing pnpm 10/Vite+/React/TypeScript; Expo SDK 58 with SDK-compatible React Native and native modules selected by `expo install`; React Native WebView for bundled document surfaces; native SecureStore and SQLite; existing CodeMirror, Markdown, Mermaid, Excalidraw and PDF.js where appropriate; browser IndexedDB; existing Playwright/Electron QA. Do not add Turborepo, a server or a second package manager.

**Spec:** [Grove clients](../../specs/grove-clients.md). Existing desktop sync: `src/main/sync.ts`. Current desktop toolbar: `src/renderer/MarkdownToolbar.tsx`, `Editor.tsx`, `VaultInsertDialog.tsx`, `src/shared/markdown-format.ts` and `vault-insert.ts`.

## Status and order

Desktop toolbar implementation precedes this plan. It includes formatting, history, normal save/conflict handling and Insert from vault. Its checks are `vp test --run`, `vp check`, `vp run build`, `scripts/markdown-toolbar-qa.mjs` and `scripts/draft-note-qa.mjs`. Do not repeat that implementation as a new client task.

Execute workspace foundations, shared online sync, durable offline sync and browser support first. Then deliver the native phone shell, editor and previews, followed by the landing site and integrated delivery checks. Tasks 1, 2, 3 and 9 are implemented locally. Tasks 4 through 8 and 10 remain unstarted. Landing was explicitly chosen next after foundation; upcoming copy keeps it independent of client delivery. Do not stage, commit, push, tag, install over the user's running app or deploy as part of executing routine steps without the corresponding user request.

## Global constraints

1. Preserve the root Electron package, binary/profile identities and existing QA scripts. Use workspace dependencies with `workspace:*` and one lockfile. Every new app has its own dev/build/typecheck commands; root commands keep working.
2. Share formatting, file classification, icon semantics, links, Mermaid extraction, types and conflict naming. Keep Electron/Node file access out of browser/native packages. Phone has no document tabs; desktop/browser retain tabs and panes.
3. No hosted Grove server. Credentials are fine-grained GitHub tokens, browser-local or native SecureStore. Never place them in WebViews, generated assets, screenshots, console output or landing storage. Do not use real private vaults for automated QA.
4. Last-known-SHA writes, durable local edits, per-revision queue acknowledgement and safe conflict copies are mandatory. File limit is 50 MiB. No force ref updates or destructive history rewrites. API errors never discard user text.
5. Use existing icon shapes, source SVGs and the agreed layouts. Phone targets are at least 44 px; floating add button is 56 px. Sources are in the gallery and spec. Use real screenshots after implementation, not generated images presented as a working product.

## Review focus

1. Desktop and phone edit the same file, including a remote deletion: preserve both work products. Tasks 2, 3 and 10 prove this.
2. A second local edit arrives while the first offline revision is uploading, then the app is killed: newest text survives restart and is not removed by the older acknowledgement. Tasks 3 and 6 prove this.
3. Unicode paths, duplicate conflict filenames, protected branches, token revocation, API throttling and truncated trees never cause an overwrite or silently incomplete vault. Task 2 owns these tests.
4. Keyboard appearance, selection, toolbar actions, navigation and interruptions must not lose a phone draft or apply to another document. Task 7 owns native interaction checks.
5. A Pages release must retain APT files and must not mix code and installers from different release tags. Task 10 verifies the complete artifact before publishing is considered.

## File ownership

| Location                                       | Owner and contract                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Root `src/main`, `src/preload`, `src/renderer` | Existing Electron app; renderer is also the browser UI source. Root source paths remain stable.              |
| `packages/core/src/`                           | Pure types and existing platform-independent helpers; compatibility re-exports preserve old imports.         |
| `packages/github-vault/src/`                   | GitHub REST client, online store, cache contract and serialized durable sync. No UI or global platform APIs. |
| `apps/web/src/`, `apps/mobile/src/`            | Platform auth/storage/lifecycle adapters and client boot/navigation.                                         |
| `apps/landing/`, `resources/brand/`            | Static editorial site and exact shared logo/font/icon references.                                            |

### Task 1: Workspace foundation and shared ownership

**Files:** Create `pnpm-workspace.yaml`, `packages/core/package.json`, `packages/core/src/types.ts`, `packages/core/src/{files,file-icons,tree,links,markdown-format,vault-insert,attachments,conflicts}.ts`. Modify root `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, existing shared-module imports/re-exports and `src/main/sync.ts`. Add `resources/brand/` source SVGs and `docs/designs/grove/README.md`.

**Interfaces:** `@grove/core/types` exports current `Kind`, `Entry`, `Document`, `SaveResult`, `Version`, `Settings`, `AttachmentRef` and `LinkRef`. Preserve the current signatures of moved helpers. `@grove/core/conflicts` owns `conflictCopyName` and `MAX_SYNC_BYTES`; desktop compatibility exports keep existing sync tests working.

- [x] Run existing checks and `scripts/markdown-toolbar-qa.mjs` as the baseline. Add a package-consumer test importing helpers through their public workspace exports; it must fail before the package exists.
- [x] Extract ownership without duplicating implementations. Keep desktop-specific `FolioAPI` and UI state in their present modules. Declare the Markdown parser as a direct core dependency. Configure tests to discover new package tests and keep original tests resolving through compatibility exports.
- [x] Copy exact logo SVGs from the spec's sources; document original screenshot/gallery paths and the authoritative behavior. Keep raster mockups as design references, not application assets. Do not replace installed desktop branding here.
- [x] Run the public-export test, root type/lint checks, all existing tests, desktop build and toolbar/draft QA. Prove the root `electron .` and packaging resource paths have not changed.

Validation on 2026-11-12: public-export test failed before the package existed, then passed; 122 tests, root Vite+ checks, isolated core TypeScript check, frozen offline workspace install, desktop build, browser bundling of all core exports and isolated toolbar/draft Electron QA passed. Moved helpers and brand vectors are byte-identical to their sources. The toolbar QA now puts the Electron entry before flags so source launches keep the fixture vault. Existing Electron binary/profile identities, root entry points and packaging resources are preserved. Changes remain unstaged and uncommitted.

### Task 2: Shared online GitHub vault

**Files:** Create `packages/github-vault/package.json`, `src/{github,store,types}.ts`, `src/store.test.ts`, `scripts/fake-github.mjs` and a small HTTP wrapper for browser/native QA.

**Interfaces:** `RepoRef = { owner: string; repo: string; branch: string }`; `rootOf(ref): string` returns `github:owner/repo@branch`. `GitHubError` has status, retry information and a kind of auth, no-access, not-found, conflict, rejected, rate-limit, offline or other. `VaultStore(ref, token, { fetch, device })` exposes list/read/write/create/createBytes/rename/remove/mkdir/assetBytes/versions using core document/save types. Test transport injection never changes the production API origin.

Store methods are `list(): Promise<Entry[]>`, `read(path): Promise<Document>`, `write(path, content, baseHash): Promise<SaveResult>`, `create(path, content): Promise<Document>`, `createBytes(path, bytes: Uint8Array): Promise<void>`, `rename(path, target): Promise<void>`, `remove(path): Promise<void>`, `mkdir(path): Promise<void>`, `assetBytes(path): Promise<Uint8Array>` and `versions(path): Promise<Version[]>`. Paths, content, hashes and targets are strings. `head(): Promise<string>` supplies the branch commit SHA for polling. The store keeps remote tree blob SHAs internally while exposing current core Entry types to UI callers.

- [x] Write failing tests against fake GitHub for recursive listings, blob-SHA reads, last-SHA writes, real 409 conflicts, 401/403/404 distinctions, branch rejection, throttling and encoded paths such as `dir/Café #[1] 🌱.md`. Verify tokens are sent only to `https://api.github.com` and are not forwarded on a cross-origin redirect.
- [x] Implement tree/blob/contents/commit-history operations with a fixed API origin and auth header. Refuse truncated listings unless paged subtree retrieval completes them. Check binary sizes before uploading. Hide desktop metadata/recovery/Trash paths using the current sync rules; keep the named conflict-copy files visible and synced.
- [x] Add failing create/rename/delete tests: destination collision never overwrites; interrupted rename keeps at least the source or destination; folder operations are rejected clearly until implemented safely; `.gitkeep` folder creation is hidden from document results. Never pretend a GitHub API call is atomic across two separate writes.
- [x] Prove same-file races return a conflict rather than silently retrying against the new SHA. Commit messages use the desktop-compatible device/time form. Verify version reads return old content and do not substitute current content for deleted or renamed history entries. Run the complete store suite and package type checks.

### Task 3: Durable browser cache and offline synchronization

**Files:** Create `packages/github-vault/src/{cache,sync}.ts` and tests. Create `apps/web/src/cache.ts` and `scripts/web-cache-qa.mjs`.

**Interfaces:** `VaultCache` is a root-scoped async contract for SHA-keyed bytes, cached tree, current documents and pending edits. Pending rows contain path, content, original remote base SHA and a unique local revision. `queue` coalesces newest content without changing the original remote base. `ack(path, revision)` deletes only that exact revision. `VaultSession` composes the store/cache, exposes the same document operations and emits sync/change notifications.

Use `getBlob(sha): Promise<Uint8Array | undefined>`, `putBlob(sha, bytes): Promise<void>`, `getTree(): Promise<(Entry & { sha: string })[] | undefined>`, `putTree(tree): Promise<void>`, `pending(): Promise<PendingEdit[]>`, `queue(path, content, baseSha): Promise<PendingEdit>` and `ack(path, revision, remote?: RemoteUpdate): Promise<boolean>`. `PendingEdit = { path: string; content: string; baseSha: string; revision: string }`. Construct `VaultSession(store, cache)`; `syncNow(): Promise<SyncStatus>` flushes pending revisions, and `onChange`/`onSync` return unsubscribe functions. Storage adapters own their atomic transactions; UI adapters own lifecycle events and credential retrieval. `RemoteUpdate = { baseSha: string; document: Document; rebase: boolean }` advances a newer queued edit only through our successful upload; conflict copies use false. Current-document `putDocument(document, expectedHash?)` is a compare-and-set operation. `getAsset(path)` and conditional `putAsset(path, { hash, bytes }, expectedHash?)` own independent atomic asset pointers so older tree refreshes cannot hide an opened asset.

- [x] Write failing tests for offline read after opening a file, write then restart, repeated offline edits, an older upload acknowledgement racing a newer edit, server rejection, remote deletion and same-file conflict. Assert the newest content survives and the queue remains intact after failures.
- [x] Implement browser IndexedDB transactions and session synchronization. Queue data durably before returning saved locally. Local pending document hashes are local revisions, never sent as GitHub blob SHAs. Serialize mutations per vault/path and recheck queue revision before acknowledgement.
- [x] On reconnection, preserve changed remote files and create uniquely named conflict copies using the shared naming helper and create-if-absent semantics. Collision retries must not overwrite an earlier copy. A remotely deleted, locally edited note remains recoverable.
- [x] Run deterministic session tests and real Chromium IndexedDB restart/race checks. Mock server failures, not the database's transaction behavior. Verify there is no API response/token caching in a service worker.

Validation on 2026-11-12: 26 store/session tests plus all desktop tests pass (148 total). Package/root types, Vite+ checks, frozen offline install, desktop and landing builds pass. `scripts/web-cache-qa.mjs` passes real Chromium IndexedDB browser restart, cross-tab saves, upload/edit acknowledgement races, stale-cache guards, opened-asset recovery, root isolation, storage rollback, rejection and conflict-copy checks. Code review approved after interrupted-response-body regressions and transport fix. Native transport/redirect compatibility and real GitHub are unverified integration gates. No web UI, native storage/UI, auth collection or service worker implemented. Online-only operations: binary creation, rename, delete and mkdir. Text creations/edits are durable offline. History is limited to 30 path-specific commits; unknown modification times are 0.

### Task 4: Browser build, sign-in and complete API bridge

**Files:** Create `apps/web/package.json`, `index.html`, `vite.config.ts`, `src/{boot,bridge,auth}.ts`, `src/SignIn.tsx`, `src/bridge.test.ts`. Modify `src/shared/types.ts`, `src/preload/index.ts`, renderer platform branches and asset setup.

**Interfaces:** Add `FolioAPI.platform: "desktop" | "web"`; desktop preload reports desktop. `createWebBridge(session?: VaultSession): FolioAPI` implements every key. No session means list returns null and file operations reject Sign in first. Browser-local state uses `cleanState`; sign-in takes owner/repo, branch and a fine-grained token.

- [ ] Write failing bridge tests for unsigned state, state persistence, expected root checks, complete method mapping and the exact desktop-only error `Available in the Grove desktop app`.
- [ ] Install the bridge before importing/mounting the shared App. Build existing renderer source with web Vite and relative assets to `out/web`. Copy local fonts, PDF workers, Mermaid/Excalidraw assets without weakening CSP or relying on remote editor scripts. Do not import Electron modules into web output.
- [ ] Add sign-in with repo-specific token guidance, loading/error states that keep typed values, and sign-out that removes credentials while protecting queued work. Check credentials against GitHub before opening a newly configured vault; never confuse cached data with a valid new login.
- [ ] Delegate vault operations, history and sync to the shared session. Use Blob URLs with type-aware MIME and bounded lifetimes for assets. Disable unsupported folder/Trash/history actions truthfully. Build both targets and run fake-API browser sign-in, invalid-token, protected-branch and Save-conflict checks.

### Task 5: Browser feature completion and offline app shell

**Files:** Modify `apps/web/src/bridge.ts`, shared renderer platform handling and styles. Add `apps/web/public/{sw.js,manifest.webmanifest}`, app icons and `scripts/web-qa.mjs`.

- [ ] Write browser QA for Markdown editing/toolbar/history, named draft Save/Cancel/Discard, Insert from vault, search, links, PDF/image/media/drawing previews, incoming remote changes and the same-note conflict flow. Use fake GitHub, not a private vault. Establish failure before adding missing methods.
- [ ] Implement bounded text prefetch, search batches, links/backlinks and remote change polling with the existing core helpers. Prefetch at most 300 Markdown files under 1 MiB each, keyed by SHA; the second open reuses cache. Name-only search remains available outside cached content and the UI explains incomplete offline content.
- [ ] Keep desktop/browser tabs and panes. At narrow widths use a file drawer and one active pane; maintain touch targets. Hide window controls, local assistants, Office conversion and external-app/native-export actions. The shared toolbar and picker remain available.
- [ ] Add a network-first shell and cache-first fingerprinted static assets with cache cleanup after successful updates. Never cache GitHub requests. Test a reload offline, queued edits and reconnect, stale tabs/panes, theme changes, object-URL cleanup and project-subpath deployment. Run desktop regressions after shared renderer changes.

### Task 6: Native shell, credentials and recoverable storage

**Files:** Create `apps/mobile/package.json`, `app.config.ts`, `metro.config.js`, `src/App.tsx`, `src/{session,storage,credentials}.ts`, `src/screens/{SignIn,Files,Settings}.tsx` and native storage/auth tests.

**Interfaces:** Native storage implements the same `VaultCache` using SQLite transactions. Credentials use SecureStore and never SQLite/plain app preferences. Native app uses the shared `VaultSession`; UI state has active document, selection, current draft and navigation route, with no document-tab model.

- [ ] Bootstrap Expo SDK 58 with compatible React Native, SecureStore, SQLite, WebView, SVG and Lucide native modules through Expo's version-aware installer. Use Metro's standard monorepo configuration; do not add manual resolver overrides or hoisting unless a reproduced issue requires it. Validate dependency alignment and an actual Android launch before building screens.
- [ ] Exercise the SQLite adapter with the same offline/race/restart contract suite as browser storage, plus an app process kill with queued edits. Verify token storage failure is visible and never falls back to a plain token file.
- [ ] Implement the original native Files/Search/Recent layout with exact shared icon semantics, theme and SVG branding. New note is the lower-right circular plus button. Use the platform safe areas and reserve scroll padding. No tabs, Open tabs button, phone assistant or fake desktop Trash counter.
- [ ] Add settings/sign-in/reconnection/error state and safe sign-out with pending changes. Verify after restart that a previously authenticated offline session can read cached documents, while signing out hides its content until authenticated again. Do not delete pending edits just to clear credentials.

### Task 7: Native editor, formatting toolbar and draft lifecycle

**Files:** Create `apps/mobile/src/screens/Note.tsx`, `src/components/{DocumentSurface,MarkdownToolbar,SaveNoteSheet}.tsx`, `src/editor/{index,bridge}.ts`, local editor asset build config and native interaction QA.

**Interfaces:** The native shell owns the active document/draft. A fixed local document surface hosts CodeMirror and applies `@grove/core/markdown-format` transactions. Its message schema identifies document, revision, selection and content; validate message kind, sizes, document identity and revision before applying. Credentials and arbitrary filesystem APIs are not bridge capabilities.

- [ ] First prove a bundled offline editor on real Android and iOS: source renders, selection round-trips, keyboard does not cover the toolbar/caret, and no remote scripts or untrusted HTML execute. Keep the application shell native. Record platform failures before extending the surface.
- [ ] Implement the GitHub-style toolbar with horizontally scrolling format tools, fixed Paperclip Insert, 44 px targets, selection/focus preservation and one-command undo. Use the desktop formatting helper and its test fixtures rather than reimplementing Markdown rules. Keep normal typing/editor history intact across keyboard changes.
- [ ] New note opens Untitled without a vault write. First heading proposes name. Save/leave opens a native sheet with name, folder, Save, Cancel and Discard. Persist recovery drafts separately from the vault queue, retain them across process death, and only create/upload a vault file after Save. Root references must survive the selected destination folder.
- [ ] Verify actual Android/iOS clicks: bold, italic, headings, lists, links, undo/redo, large-note scrolling, rotation, backgrounding, switching files and cancellation. A late editor message or picker response must never modify another document. No document tabs are introduced to work around navigation.

### Task 8: Native reading, previews, insert picker and conflicts

**Files:** Create `apps/mobile/src/components/{MarkdownPreview,DrawingPreview,PdfPreview,MediaPlayer,InsertSheet,ConflictView}.tsx`, scoped asset/preview bridge and native fixture-vault QA.

- [ ] Build a bundled, sanitized Markdown/document surface with local resources; no note-provided executable HTML or remote JS. Reuse existing Markdown/Mermaid/Excalidraw/PDF.js behavior where it fits. Native shell and native audio/video/image components own platform controls and lifecycle. Use SDK-compatible native audio/video modules, not a new web-hosted media service.
- [ ] Verify previews on both native platforms before declaring support: full-width portrait PDFs with usable page/zoom controls; width-filling video with seek/skip/speed/fullscreen; compact audio; image fit/pan/zoom; and view-only drawings with Fit. Cache access is confined to the selected vault. Release viewers, files and media sessions when leaving; token-bearing network URLs never enter a WebView.
- [ ] Port the existing-content picker to the approved native sheet. Preserve the caret while opening/dismissing it. Media/drawings offer Embed or Link, Mermaid source comes from a selected saved note, and stale sources require a fresh review. Source remains unchanged; no implicit file copies, new chart builder or whole-note transclusion.
- [ ] Render stacked file conflicts with Keep both files, Keep mine and Use GitHub version. Tests cover changed/deleted remote notes, another app sync during review, offline replay, file-name collisions and rejected writes. Accessibility, safe areas, voiceover labels and real-device media/keyboard behavior are release gates.

### Task 9: Static landing page

**Files:** Create `apps/landing/package.json`, `index.html`, `vite.config.ts`, `src/{App,main}.tsx`, scoped styles, product screenshot assets and `scripts/landing-qa.mjs`.

- [x] Capture the agreed landing reference from the gallery before implementation. Use its editorial sections, Source Serif/Geist typography, new exact SVG marks, emerald accent and warm surfaces. Build a static React/Vite site to `out/landing`; no API service, auth collection or client vault code belongs here.
- [x] Implement working section links, FAQ accordion and honest download/source actions. Linux download goes to the current release/install instructions. Upcoming phone/web badges remain until those clients are actually released. No live store CTA, fake metrics, new pricing or placeholder version/platform strings.
- [x] Replace generated app imagery with real isolated-app screenshots once the corresponding clients exist. The phone showcase has no tabs and has the circular plus button and desktop-style icons. Keep proposed phone screenshots labelled as previews before release.
- [x] Test at 390, 768 and 1440 px: keyboard navigation, heading order, text contrast, focus states, no horizontal overflow, useful alt text and correct project-subpath asset URLs. Compare rendered output against the reference and fix visible drift before handoff.

Validation on 2026-11-12: static landing build/types, root Vite+ checks, 122 regression tests, desktop build and frozen offline install pass. Landing QA passes at 390/768/793/1440 px with keyboard, FAQ, navigation and local images/fonts; no runtime or HTTP errors. Desktop package paths exclude out/landing. CI builds landing; deployment/APT workflows unchanged. Visual capture/report: /home/dr1tch/parity/grove-landing-2026-11-12/. Intentional differences: real desktop capture, source vectors, complete labelled phone preview, readable text/touch sizes and accurate FAQ. No deployment or installer.

### Task 10: Cross-device checks and delivery preparation

**Files:** Extend `.github/workflows/check.yml`, `.github/workflows/apt.yml`, root task scripts, `README.md`, `CHANGELOG.md` and release documentation. Add `scripts/clients-qa.mjs` and a site-artifact check.

- [ ] Run one fixture vault through desktop, browser and native clients against fake GitHub: create, rename, edit, attach, search, conflict, offline edit, reconnect, restart and history. Check both version preservation and queue revisions. Use only temporary vaults and profiles; never touch the user's normal Grove window or private repository.
- [ ] Add CI for workspace install with frozen lockfile, types/lint/tests, desktop build, browser/landing static builds and native dependency/bundle checks. Native signing/store submission remains a separate explicit action; a successful JavaScript bundle does not prove a native release build.
- [ ] Prepare one complete Pages artifact: landing at root, browser under `app/`, APT metadata/key/`pool/` intact. Capture one release tag once; check out/build the site and download installers from that same tag. Fail before upload if any expected APT file, app entry point or static asset is missing. Retain the previous deployed release as the rollback target.
- [ ] Record exact validation results, Android/iOS device gaps and known preview limits in release notes. Before any publishing, present the actual artifact and commands for review. Do not tag, push, deploy, create store listings or change credentials in this plan-only task.

## Self-review and source checks

This plan replaces the earlier PWA-only phone plan. Every phone design correction is owned by Tasks 6 through 8; browser reuse and native platform differences are explicit. Sync failure modes are owned by Tasks 2 and 3; branding/download accuracy by Task 9; APT preservation by Task 10. The core helpers and session/storage signatures are shared across consuming tasks. Tests assert content, recovery and interaction outcomes rather than internal markup or copied implementation details.

Documentation checked on 2026-11-12: [Expo monorepos](https://docs.expo.dev/guides/monorepos/) for workspace/Metro support; [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) for native-only credential storage and SDK module alignment; [Expo web](https://docs.expo.dev/workflow/web/) for platform distinctions. Browser uses the existing React DOM renderer by design. Package versions must be confirmed by the SDK installer when Task 6 starts; no native dependencies were installed while writing this plan.
