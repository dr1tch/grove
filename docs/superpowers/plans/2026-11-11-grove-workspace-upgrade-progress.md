# Grove workspace upgrade progress

Plan: `2026-11-11-grove-workspace-upgrade.md`.

## Execution decisions

Implementation authorized by the user's request to start. Keep source changes unstaged and uncommitted. The branch has no commits, so commit-range task scripts cannot run; record source files and actual verification here instead. Do not create a baseline commit to satisfy bookkeeping.

Shared interfaces: Task 2 supplies document and pane targeting to Tasks 3, 4, 5, 7 and 8. Task 3 supplies attachment syntax to Tasks 6 and 10. Task 6 must migrate pane/preset references during rename. Task 9 must preserve content-based PDF detection. Task 10 consumes Tasks 3 and 9 resource/rendering policies. No interface conflict found during initial review.

## Task 1

Implemented in `src/renderer/Viewer.tsx`, `src/renderer/styles.css` and `scripts/media-wheel-qa.mjs`. README describes the gestures. No IPC changes or dependencies added.

Media pointer capture belongs to the image/video element, so ordinary clicks and double-clicks retain their target. A four-pixel movement threshold starts panning. The native video control strip is reserved. Toolbar Fit remains the keyboard-accessible reset action.

Verification: the new two-axis drag assertion failed against the original build. After implementation, native QA passed for inline images, separate image windows and videos: wheel zoom, two-axis pan, drag outside the frame, cancellation, double-click fit, zero scroll after reset, paused state and playback position, original media bytes and no renderer errors. `vp check --fix`, `vp run build`, all 49 unit tests and existing PDF regression QA passed.

Independent code review found no actionable production issues. A native video play-control check initially clicked the timeline; inspection of the rendered controls corrected the coordinate, and actual mouse playback now passes too.

Release status: source build only; installed Grove remains 0.3.10. No running user window was closed.

## Remaining

Tasks 2 through 10 remain pending. Task 2 is next: shared document state, reading position and two-file panes.

## Task 2

Implemented shared WorkingTab content ownership with pane-only references, independent modes and cursor/scroll/media/page metadata. Added DocumentPane, two-file panes, active-pane routing, Open beside, keyboard/pointer divider and close-pane merging. Workspace metadata is scoped by vault in localStorage; old tab state migrates. Rename/prune affects both panes. Autosave covers all documents with one in-flight save per document ID; stale completions cannot replace a reopened document.

Proof: native panes QA first failed on missing Open beside. After implementation, shared-note editing, PDF/note views, focus routing, divider, reload, dirty external conflict resolution and switching away/back passed. All 51 tests and type/lint/build checks passed. Metadata uses the renderer's existing recovery storage rather than granting new main-process filesystem authority.

Task 2 complete. Task 3 in progress. Remaining Tasks 3 through 10 will run continuously as requested.

## Task 3

Implemented trusted OS drop provenance in preload, scoped import/picker/clipboard IPC, kernel-confined streaming imports, collision-safe publication and source change checks. Existing vault files reuse links; external originals remain untouched. Editor maps asynchronous insertion anchors through CodeMirror transactions and uses one isolated undo transaction. Preview drops switch to editing. Closed editors receive no insertion. Screenshot paste saves PNG; generic files remain links and images/PDF/video/audio use previews.

Proof: Python import assertion failed on Unknown vault operation before implementation. Confined I/O QA passes copy byte equality, collisions, existing links, symlink and traversal rejection. Native Chromium trusted-file-drop QA passes mixed files, preview drop, encoded paths, undo/redo retaining assets, no duplicate vault copy, real clipboard paste, image/PDF preview and no renderer errors. Native clipboard check initially used an invalid PNG fixture; a real screenshot fixture passed. All 53 tests, lint/types and build pass.

Task 3 complete. Task 4 in progress.

## Task 4

Implemented modal Ctrl+K switcher with MRU per vault, fuzzy path matching, highlighted matching ranges, full paths, keyboard navigation, focus restoration, Escape/outside dismissal and Shift+Enter to open beside. Sidebar filtering remains available. Ranking gives exact stem/basename priority, then substrings, then subsequences with deterministic ties.

Proof: native switcher QA failed on missing modal before integration, then passed MRU, keyboard opening, fuzzy receipt search, new pane and Escape. Rank tests pass after correcting one expected match that was a valid path subsequence and preferring a shorter basename for equal subsequences. Task 4 complete. Task 5 in progress.

## Task 5

Implemented Ctrl+Shift+F workspace search, Ctrl+F current-file search, streamed/cancelable results, unsaved-document overlays, stale-hash checks, editor match decorations and PDF page/viewport highlights. Two bounded PDF readers use the existing PDF.js dependency, promoted to runtime for packaging. PDF text caches are fingerprinted and capped at 64 files; scanned/encrypted/corrupt/oversized files report errors. No OCR claim. Queries and results are bounded at 256 characters and 1,000 matches.

Measured the real 1,000-small-text-file fixture: initial per-file subprocess design took 28,763 ms. Reused the confined helper as one streamed batch instead: 75 ms for the same one-hit fixture. This measures small local text files, not a PDF-heavy vault. Native UI QA passes real text search/decorations, PDF extraction, page navigation and visible highlight bounds. Shared matching tests and Python UTF-16/hash/confinement assertions pass.

Task 5 complete. Task 6 in progress.

## Task 6

Implemented AST-based Markdown/image/definition links and wiki references while excluding code. Backlinks panel reports saved incoming/outgoing links and distinguishes missing from ambiguous targets. Rename defaults to a reviewable link-update plan, blocks affected dirty notes, validates hashes and updates moved-source relative paths. Renderer migrates drafts, pane references and recents. Rename-only remains explicit.

The confined helper persists a separate link-update journal before the move, pins source inode identity and records each completed document. Existing hash-checked writes/history preserve originals and newer external bytes. Resume detects a completed move and a completed write even if the app stopped before their markers. Vault switching cannot migrate another workspace. No multi-file atomicity claim.

Proof: parser tests, stale external-write rejection, restart after path move, restart after an unmarked first-file update and native backlinks/rename-preview/reference-update UI checks pass. Task 6 complete. Task 7 in progress.

## Task 7

Added a native modal comparison dialog with side-by-side line differences, timestamps/source and explicit Keep mine, Use disk, Keep both and Restore version actions. History selection opens a preview and does not change the file. Removed/unreadable files keep their working copy, expose Save copy/history and pause autosave until available again. Existing history, write conflicts and recoverTab remain the only recovery owners.

Proof: new comparison UI assertion failed before integration. Native QA passes comparison, conflict resolution shared across panes, history review without mutation, explicit restoration, removed-file preservation, reappearance and vault switching. Existing deterministic displaced-inode save race checks pass. Task 7 complete. Task 8 in progress.

## Task 8

Added per-vault named presets with Save, Open, Rename and Delete in the folder area. Presets contain validated layouts, tab references, expanded folders, sidebar sizing/visibility and assistant visibility, with no document contents. Applying preserves dirty document owners and keeps them in an extra tab. Missing files require an explicit Open available files action. Renames migrate saved references. Folder expansion now has one owner in App instead of private FileTree state.

Proof: validation rejects foreign/malformed presets and strips contents. Native UI passes saving a PDF/note layout, closing/reapplying it, restart, renaming and checking that saved metadata contains no working note text. Task 8 complete. Task 9 in progress.

## Task 9

Implemented HTML/HTM/genuine XHTML Preview and source/preview split using the current document model. Main parses HTML with parse5 and CSS with PostCSS/value-parser, inlines confined local images/fonts/styles and resolves bounded CSS imports with cycle detection. Scripts, event handlers, embeds, navigation links and form submission are removed/disabled. Dedicated revocable folio://html-preview capabilities use a restrictive CSP and an opaque sandboxed iframe without preload access. Main app CSP permits only this preview frame origin. PDF sniffing still takes precedence over XHTML filenames.

Parser dependencies replace ad-hoc HTML/CSS rewriting; installed PostCSS was promoted to runtime. Native QA passes local styles/images, live edits, source split, no application bridge/parent access, removed navigation and zero external requests. Malicious HTML/CSS unit fixtures and lint/types/build pass. Task 9 complete. Task 10 in progress.

## Task 10

Implemented export preparation from an immutable note snapshot in a sandboxed renderer using the shared Markdown/Shiki/Mermaid/Excalidraw components. Export child IPC is read-only and restricted to references in that note's captured vault. Static output embeds images/fonts/attachments, labels nonprintable PDF attachments and has a no-script CSP. Missing/oversized assets are listed before an explicit omission choice. Prepared output is limited to 100 MiB and uses a native save dialog. Existing destination files become recovery copies; changed destinations are rejected and new output is published without replacing a concurrent new file.

Proof: portable HTML and publication tests pass, including changed-destination rejection. Native UI exports HTML and PDF with tables, source colors, local images, Mermaid, Excalidraw and attachment downloads, with unchanged note source. Poppler confirms A4, no JavaScript, visible source/table/image/drawing and diagram labels. Visual inspection caught missing SVG foreignObject labels; a failing regression fixture preceded preserving sanitized labels, and PDF text extraction now includes Start/Finish. Export QA also fixed the article selector and the existing sanitizer's stripped internal drawing links. All 65 tests and lint/types/build pass. Task 10 implemented; final regression/review/package remains.

## Release visual pass (0.4.1)

`scripts/visual-qa.mjs` screenshots the installed app in light and dark at 1400 and 1000 px (the window minimum), with two panes, header and sidebar tooltips, Ctrl+K, Ctrl+Shift+F, keyboard focus and HTML preview. Fixed two issues: the diagram toolbar pushed Copy/Expand outside the card in narrow panes (now wraps), and pane tab strips showed a horizontal scrollbar (tabs now shrink with ellipsis). Tooltips sit vertically and inside the window; focus rings are visible in both themes. Known and left as is: HTML preview keeps the page's own white background in dark mode; search snippets can start mid-word. Installed 0.4.1; packaged smoke passes.
