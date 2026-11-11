# Grove Workspace Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Grove into a stronger local research workspace with two-file panes, media gestures, attachments, search, linked notes, recovery, workspace presets, HTML preview and portable export.

**Architecture:** Extend the current Electron main/preload boundary and confined Python vault helper. Keep one working document per vault/path, with pane-local selection and viewing state. Reuse CodeMirror transactions, Markdown rendering, PDF.js and the existing native viewer; add focused modules where a feature needs its own owner instead of growing App.tsx indefinitely.

**Tech Stack:** Existing Electron, React, TypeScript, CodeMirror 6, PDF.js, Markdown/Mermaid/Excalidraw stack, Python 3 and native platform APIs. No new service or database. Inspect installed dependency support before adding a package.

**Spec:** `docs/specs/grove-workspace-upgrade.md`; existing safety and portability requirements in `docs/specs/folio.md` remain applicable.

## Global constraints

1. Implementation is authorized by the user's November 11 request to start. Leave changes unstaged and uncommitted. Do not stage, commit, push or install a release without the corresponding authorized execution scope.
2. Preserve original bytes, strict UTF-8 editing, hash-based conflicts, history, Trash, kernel path confinement, sandboxing and explicit originating vault scope on mutations.
3. Use simple English, no em dashes, real accessible tooltips, keyboard access and dark/light themes. Keep generated artifacts and fixtures separate from the user's real files.
4. All asynchronous results belong to the originating vault, document and operation. Switching tabs or vaults must not insert into another note, mutate another file or display stale results.
5. Reuse the current native Playwright QA approach. Before any development server work, follow devport instructions; no server is required for packaged Electron QA. Do not terminate the user's running app.

## Existing behavior to preserve and extend

`Viewer.tsx` already owns fitted PDF/image/video previews, image/video wheel zoom, separate PDF/image windows and controls. `Editor.tsx` owns CodeMirror history and caches document state. `Markdown.tsx` renders sanitized Markdown, local images, links, diagrams and drawings. `App.tsx` owns tabs, filename filtering, autosave, conflicts, recovery UI and rename handling. Its source/preview split shows one document, not two files.

`Vault` and `resources/vault_io.py` own confined I/O, serialized writes, history, Trash and rename recovery. `src/shared/state.ts` validates persisted settings; `src/shared/recovery.ts` protects newer drafts from stale restores. Content-based PDF identification exists when opening files. Backlinks, content search, attachment imports, workspace presets, portable export and rendered HTML are not complete features today.

## Delivery order

| Phase | Deliverable                                                      | Dependencies                                  |
| ----- | ---------------------------------------------------------------- | --------------------------------------------- |
| 1     | Media pan and reset                                              | Current media viewer                          |
| 2     | Persistent document position and two independent panes           | Current document state                        |
| 3     | Unified attachment import, dropping, screenshot paste and embeds | Pane/document targeting                       |
| 4     | Quick switcher                                                   | Pane/document targeting                       |
| 5     | Local content search and PDF match navigation                    | Search UI and document navigation             |
| 6     | Link index, backlinks and safe rename updates                    | Attachment/link syntax                        |
| 7     | Recovery UX and presets                                          | Pane state and link-aware rename              |
| 8     | Sandboxed HTML source/preview                                    | Existing source editor and confined resources |
| 9     | Portable HTML and PDF export                                     | Embeds, rendering and HTML isolation          |

Each phase is a separately reviewable deliverable. Do not build every phase behind an unfinished replacement shell.

## Review focus

1. Vault switching during imports/search/export: Task 3 and Task 5 tests must reject stale mutations and stale UI results.
2. The same note in two panes with unsaved edits: Task 2 proves shared content, independent view state and one autosave owner.
3. Colliding names, disk errors and partial imports: Task 3 proves no overwrite, intact sources and explicit partial-failure reporting.
4. External writers during link updates and restore: Task 6 and Task 7 prove recoverable journals and hash checks preserve every newer edit.
5. Malicious HTML and broken local resources: Task 8 and Task 9 prove no script, network, traversal, preload access or export-time execution.

## Task 1: Pan zoomed media and reset with double-click

**Files:** Modify `src/renderer/Viewer.tsx`, `src/renderer/styles.css`, `scripts/media-wheel-qa.mjs`.

**Interfaces:** Reuse DocumentPreview's fit/scale state and its scroll container. No IPC or dependency additions.

- [x] Extend media QA with zoomed image/video dragging, pointer leaving the frame, pointer cancellation and double-click reset. Assert both scroll axes move when content overflows, video playback position stays unchanged and no file changes occur.
- [x] Add pointer capture and scroll-offset panning only for overflowed media. Use a small movement threshold to preserve ordinary clicks. Ignore native video control interactions; keep native video fullscreen available from its controls. Prevent image ghost dragging. A double-click on image/video content resets fit; controls keep their own behavior.
- [x] Expose grab/grabbing cursors only when panning is available. Keep wheel zoom and normal scrolling outside the media. Retain toolbar Fit as the keyboard-accessible equivalent.
- [x] Run `vp check` and `xvfb-run -a node scripts/media-wheel-qa.mjs` after building. Pass means pan, cancel, reset, wheel zoom and playback checks pass in the main viewer and separate image window.

## Task 2: Shared document state, reading position and two-file panes

**Files:** Modify `src/renderer/App.tsx`, `Editor.tsx`, `Markdown.tsx`, `Viewer.tsx`, `src/shared/types.ts`, `state.ts`, `workspace.ts`; create `src/renderer/DocumentPane.tsx`; extend shared state tests; create `scripts/panes-qa.mjs`.

**Interfaces:** Introduce `ViewState` with `mode`, text selection, editor/preview scroll, PDF page and media `{ fit, scale, scrollLeft, scrollTop }`. Introduce `PaneState` with stable `id`, tabs, `active` and per-path view state. Existing WorkingTab remains the single content/hash/conflict owner for a document. Workspace state stores one or two panes, active pane and a clamped divider ratio.

- [x] Add migration assertions: old `{tabs, active}` opens in one pane without losing pins or drafts; invalid coordinates/page/zoom values are rejected or clamped; missing files are reported and skipped.
- [x] Extract DocumentPane rendering and route all edit/save/recovery operations through shared documents keyed by vault and path. Key editor view caches by pane as well as document; retain each pane's selection without creating competing content copies or autosave timers.
- [x] Add Open beside, a resizable divider, close-pane and explicit active-pane focus. Ctrl+S, file opening and navigation act on the focused pane. Same-document views reflect edits immediately. Do not confuse two-file panes with a document's existing source/preview split.
- [x] Persist view state per vault with debounced writes. Restore after content/layout is ready, clamp to current dimensions and retain fit mode when fitted. Migrate rename/close/Trash paths in all panes and closed-tab recovery.
- [x] Run shared state tests and `scripts/panes-qa.mjs`: PDF plus note, same-note edits in both panes, conflicting external edit, pane resize/close, restart restoration and switching vaults. Pass means one save owner and no dropped drafts.

## Task 3: Attachments, drag and drop, screenshot paste and embeds

**Files:** Modify `src/main/index.ts`, `src/main/vault.ts`, `resources/vault_io.py`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/Editor.tsx`, `Markdown.tsx`, `DocumentPane.tsx`; create `src/main/attachments.ts`, `src/shared/attachments.ts` and `scripts/attachments-qa.mjs`; extend vault tests.

**Interfaces:** `AttachmentRef = { path: string; kind: Kind; copied: boolean }`. `importAttachments(notePath, inputs, vaultRoot): Promise<{ attachments: AttachmentRef[]; failures: { name: string; error: string }[] }>` is a scoped main-process operation. The preload translates real OS File objects into native paths with Electron's supported file-path API; renderer-supplied path strings do not grant unrestricted read authority. Screenshot clipboard input uses the native image API, not an arbitrary filesystem path.

- [x] Add tests for image/PDF/video/audio/other files, same-vault files, Unicode and spaces, duplicate names, symlinks, invalid paths, permission failure, partial batch failure and switching vaults during an import. Include a pending import while the user types, changes selection, closes the note or opens another pane.
- [x] Implement copy-only imports into `<note-directory>/attachments/` with confined destination creation and no-replace publication. Existing files in the active vault return links without copying. Preserve sources; reject symlink escapes. Use OS drag provenance or a native picker for external source authorization, with file-drop support handled in preload/main, not a general renderer file-read endpoint.
- [x] On drop in editable Markdown, capture the originating document and a CodeMirror transaction-mapped insertion anchor. Import first and insert only completed references in original order. A drop on Markdown preview switches to editing at the current cursor, or the end if none exists. Tab/file-tree drag payloads for reorder and pane movement remain distinct from attachment drops.
- [x] Handle image clipboard data through the same import path and save as PNG with a collision-safe timestamp name. Normal text paste and pasted URLs retain normal editor behavior. Drop/paste is one undoable CodeMirror insertion transaction; redo restores links. Undo never deletes copied files automatically. Closed or switched targets receive no insertion; report saved but uninserted attachments.
- [x] Centralize portable relative link encoding and rendering: image `![](relative-path)`, PDF/video/audio as Markdown links recognized as embeds by Grove, generic files as ordinary links. Preserve a way to open/download each embed. Resolve local paths through vault authority; block executable HTML and remote auto-loads in embeds. PDF links open/render through the shared PDF owner rather than duplicate PDF.js logic.
- [x] Run vault tests and `scripts/attachments-qa.mjs`. Pass means embedded output, correct drop position, undo/redo, duplicate handling, copied-byte equality, no overwrites and stale-target protection all pass. Keep the 20 MB text-edit limit; copy attachments as streams rather than base64 IPC payloads.

## Task 4: Recent files and quick file switcher

**Files:** Create `src/renderer/QuickSwitcher.tsx`, `src/shared/file-search.ts` and its test; modify `App.tsx`, `DocumentPane.tsx`, `state.ts`; create `scripts/switcher-qa.mjs`.

**Interfaces:** `rankFiles(query, entries, recentPaths): { path: string; score: number; ranges: [number, number][] }[]`. Recent paths are scoped to the vault and capped at 100. Switcher opens into the active pane.

- [x] Test exact basename before path substring before subsequence matches, deterministic ties, case-insensitive Unicode names, duplicate basenames and renamed/deleted recents.
- [x] Upgrade Ctrl+K from filename-filter focus to a modal switcher. Empty query shows recent files; typing fuzzy-matches filename/path with highlighted characters. Keep sidebar filtering available independently.
- [x] Support Up/Down, Enter, Escape, focus restoration and Open beside. Show full parent path and file type; do not rely on hover to distinguish duplicate filenames.
- [x] Run the ranker tests and `scripts/switcher-qa.mjs`. Pass means fully keyboard-operated opening, correct active-pane target, recent ordering and no deleted/stale entries.

## Task 5: Search notes, code and PDF contents

**Files:** Create `src/main/search.ts`, `src/renderer/SearchPanel.tsx`, `src/renderer/PdfSearch.tsx`, `scripts/search-qa.mjs`; modify main/preload/types, `Editor.tsx`, `Viewer.tsx`, `DocumentPane.tsx`.

**Interfaces:** Scoped request/cancel API keyed by request ID and originating vault. Results carry `{ path, sourceHash, page?, line?, from, to, snippet }`. PDF text extraction and canvas text highlighting share page text coordinates; no OCR promise for scanned pages.

- [x] Test notes/code/PDF text, no-match, Unicode, multiline text, duplicate hits, cancellation and vault switching. Report encrypted, corrupt, image-only and oversized PDFs explicitly rather than silently calling them searchable.
- [x] Implement bounded main-process work with two concurrent readers, cancellation, streamed batches and an initial cap of 1,000 matches. Ignore `.folio`, `.trash`, symlinks and `node_modules`. Use existing strict reads and PDF.js extraction; keep caches in the app profile keyed by vault/path/content fingerprint. Start with incremental on-demand search, not a database service.
- [x] Add Ctrl+Shift+F workspace search and Ctrl+F current-file find. Use existing CodeMirror search support if installed. Highlight text hits; for PDF results open the correct page and overlay rectangles aligned with viewport zoom/rotation. Add previous/next match and result counts.
- [x] Overlay current unsaved note content when searching open documents and mark those hits as unsaved. Before jumping, validate result hash or re-run that file's query. Never use stale offsets against changed text.
- [x] Run `scripts/search-qa.mjs`; assert actual visible highlights, page/line navigation, unsaved hits and cancellation. Measure representative 1,000-file fixtures and document measured latency; do not claim a large-vault performance target without measuring it.

## Task 6: Backlinks, broken links and link-aware rename

**Files:** Create `src/shared/links.ts`, `src/main/links.ts`, `src/renderer/Backlinks.tsx`, link parser tests and `scripts/links-qa.mjs`; modify `Markdown.tsx`, `vault.ts`, `resources/vault_io.py`, main/preload/types and current rename UI.

**Interfaces:** `LinkRef = { sourcePath, targetPath, from, to, syntax, fragment?, label? }`. `planRenameLinks(oldPath, newPath, vaultRoot)` returns impacted files and expected hashes. `applyRenamePlan(planId, vaultRoot)` applies the inspected plan through the existing journal and hash-checked write path.

- [x] Test relative Markdown links/images, wikilinks and embeds, reference-style links, fragments, encoded spaces, folder moves, duplicate basenames and code fences/inline code that must not be rewritten. Use the installed Markdown parser stack for source locations rather than regex over the whole file.
- [x] Build a vault-scoped link index updated by file watchers and successful saves/imports. Display incoming links and unresolved/ambiguous local targets. Do not label remote URLs or unresolved unique-name ambiguity as confirmed missing files.
- [x] Before rename, preview affected references and dirty documents. Default to updating local links, with an explicit rename-only choice. Block application if an affected document has unsaved edits; explain which file needs saving. Refresh hashes immediately before applying.
- [x] Extend rename recovery journal to include original path, planned replacements, hashes and per-file completion. Persist recovery information before mutation. On conflict or crash, preserve both newer bytes and originals, show partial progress and offer safe resume; never claim multi-file atomicity. Move history, drafts, pane state and presets consistently.
- [x] Run parser/vault tests and `scripts/links-qa.mjs`. Include an external write after planning and a crash between files. Pass means no unintended code edits, no lost bytes and accurate recovery/backlinks after restart.

## Task 7: Clear external-change recovery

**Files:** Modify `App.tsx`, `Proposal.tsx` only if its diff UI fits, `src/shared/recovery.ts`, `src/main/vault.ts`; create `src/renderer/RecoveryDialog.tsx`, `scripts/recovery-qa.mjs`; extend current recovery/vault tests.

**Interfaces:** Reuse current SaveResult conflicts, versions, restore, keep-both and recoverTab behavior. No second history store or alternative write path.

- [x] Cover clean external reload, dirty conflict, same-file views in both panes, removed file, restore conflict and a newer keystroke during an asynchronous restore.
- [x] Consolidate readable side-by-side comparison and explicit Keep mine, Use disk, Keep both and Restore version actions. Show timestamp/source and preview before applying. Selecting a historical version must not itself replace the file.
- [x] Keep dirty drafts and preserve displaced disk bytes. Both panes reflect the resolved document while retaining their own view state. Provide a clear removed-file state with Save copy and history access.
- [x] Run current recovery/vault tests, `python3 scripts/vault-races.py` and `scripts/recovery-qa.mjs`. Pass means stale restores never erase newer edits and every action has a visible, recoverable result.

## Task 8: Named workspace presets

**Files:** Create `src/renderer/Workspaces.tsx`, `src/shared/workspaces.ts` and tests; modify `state.ts`, `types.ts`, `App.tsx`, `DocumentPane.tsx`; create `scripts/workspaces-qa.mjs`.

**Interfaces:** `WorkspacePreset = { id, name, vaultRoot, panes, activePaneId, splitRatio, expandedFolders, sidebar, sidebarWidth, assistant }`. Store snapshots of layout and references, never working document contents.

- [x] Test malformed saved data, old-state migration, duplicate names, missing files, renamed folders and attempts to apply a preset in another vault.
- [x] Add Save workspace, Rename, Open and Delete in the folder/settings area. Coding, Research and Writing are examples of user-created names, not separate hard-coded app modes.
- [x] Applying a preset changes the layout while retaining all dirty document models and drafts. Keep unsaved files visible in an extra tab if absent from the preset. Warn about missing paths with an option to continue; never silently switch vault authority.
- [x] Run state/workspace tests and `scripts/workspaces-qa.mjs`: save/restart/restore two-pane layouts, apply with dirty notes and rename a referenced folder. Pass means no data loss and stable layout restoration.

## Task 9: HTML/XHTML code beside a safe rendered preview

**Files:** Create `src/renderer/HtmlPreview.tsx`, `src/main/html-preview.ts`, `scripts/html-preview-qa.mjs`; modify `App.tsx` or `DocumentPane.tsx`, `TextPreview.tsx`, main/preload/types and protocol CSP handling.

**Interfaces:** HTML-kind text documents retain existing source editing. Add Source, Preview and Split presentation for `.html`, `.htm`, genuine `.xhtml`. A scoped preview builder accepts the unsaved UTF-8 source and owning document path and returns a revocable preview-resource token; resource access is restricted to that document's vault.

- [x] Add fixtures for full HTML documents, fragments, XHTML, local CSS/images, unsaved edits, malformed markup, relative paths and PDF content behind `.xhtml`. Verify the latter still opens as PDF.
- [x] Use a sandboxed iframe with no `allow-scripts`, no `allow-same-origin`, no forms, popups or top navigation. Serve a dedicated preview route with its own restrictive CSP instead of relaxing the application's policy. Set `default-src 'none'`, permit only required inline/local styles and approved image resources, and block network/media execution by default. No preload bridge in the frame.
- [x] Resolve referenced local CSS/images with confined main-process reads and scoped, revocable resource URLs. Resolve CSS imports/URLs through the same policy, enforce cycle/size bounds and show missing-resource status. Reject traversal and symlinks. Remote assets get placeholders rather than automatic requests. Revoke tokens on replacement/close/vault change.
- [x] Debounce preview updates from the same working document model; keep source editing, selection and undo intact. Offer a clear offline-preview explanation when scripts or remote assets are omitted. Keep rendered content styling isolated from Grove.
- [x] Run `scripts/html-preview-qa.mjs` with script/event-handler/javascript-URL/form/navigation and network probes. Pass means visible HTML/CSS, live source edits, no app-style leakage, no external requests, no parent access and no executable content.

## Task 10: Portable note export to HTML and PDF

**Files:** Create `src/main/export.ts`, `src/renderer/ExportDialog.tsx`, `src/renderer/ExportDocument.tsx`, `scripts/export-qa.mjs`; modify `Markdown.tsx` only to share document rendering, main/preload/types and scoped export routes.

**Interfaces:** `exportNote({ path, content, format: 'html' | 'pdf', theme: 'light' | 'dark' }, vaultRoot)` captures an immutable unsaved source snapshot and exports only to a native save-dialog destination. Rendering consumes the same Markdown/link rules as in-app previews.

- [x] Test headings, tables, source blocks, local images, Mermaid, Excalidraw, relative paths, Unicode, missing assets, print page breaks and active edits during export. Fixture outputs go to temporary directories.
- [x] Build a standalone sanitized HTML document, inline local image/font data, render diagrams/drawings to safe SVG/PNG and include essential CSS. No app chrome or runtime is required to open the output. Avoid copying active scripts or remote references into exported files.
- [x] Define attachment portability explicitly: small local downloadable files can be embedded as data URLs; PDF/video/audio use poster/label plus an embedded download when within the limit, not an unsupported promise of inline playback in every browser. Set a 100 MiB total embedded-data limit and show the calculated size before export. Offer a clearly listed omission or cancel if exceeded; do not silently create a nonportable output. PDF export represents nonprintable attachments with a readable label rather than a local-only path.
- [x] For PDF, load only the trusted export renderer in a hidden sandboxed Electron window and use printToPDF after fonts/images/diagrams finish. Do not execute HTML-note scripts. Use cancellation, explicit error reporting and temporary-file publication so an existing destination survives failed rendering. Native overwrite confirmation precedes replacement.
- [x] Run `scripts/export-qa.mjs`; open exported HTML offline with networking disabled, verify embedded assets and no file:// dependencies. Render exported PDF with Poppler and inspect page images for clipping. Compare original and source attachment hashes before/after. Pass means portable output, visible diagrams and intact originals.

## Release and acceptance

- [x] Deliver each phase only after its targeted assertions and native UI script pass. Update README with actual behavior and limitations; do not claim the full roadmap is implemented after one phase.
- [x] Run `vp check`, `vp test --run`, `python3 scripts/vault-races.py`, `vp run build`, the existing PDF/media/sidebar QA and each new feature's native script. Avoid rerunning unrelated suites repeatedly without a new failure or change.
- [x] Inspect light/dark and narrow/two-pane layouts, real tooltip placement, keyboard focus and Escape behavior. Use copied sample files. Record evidence and any actual OS-level behavior the headless session cannot verify.
- [x] Package only after the applicable checks pass. Install when execution is authorized, verify the installed version, and leave the user's current window open. No git commits or pushes without a specific request.

## Deferred scope

No OCR, cloud sync, collaboration service, plugin marketplace, arbitrary website browsing, active HTML/JavaScript execution, recursive pane tree, automatic orphan-attachment deletion or new assistant-provider work. These are separate decisions rather than prerequisites for the requested features.

## Plan review

All eleven distinct requested features are assigned above. Screenshot paste and file drops share Task 3; source/preview split and two-file panes remain separate concepts. Reading position supports Task 2 and Task 8. The existing safety layer is extended rather than replaced. Before implementation, review the proposed attachment folder, two-pane limit, offline HTML policy and export size/attachment behavior in the companion spec.
