# Desktop performance audit, 2026-11-13

Scope: Grove 0.5.3 and the local checkout were audited and optimized after explicit authorization; 0.5.4 was subsequently packaged and installed on request. All measurements used synthetic notes in separate temporary profiles under Xvfb; the normal Grove profile and private notes were not opened. These are local diagnostic samples, not hardware frame-rate guarantees. No commit or public deployment was performed.

## Optimization results

The same reproducible harness, `xvfb-run -a node scripts/desktop-performance-qa.mjs`, checks typing budgets and cold backlink loading. The installed 0.5.3 baseline was captured before upgrade. To check the installed update and enforce its version and budgets, set `FOLIO_SMOKE_EXECUTABLE=/opt/Grove/folio GROVE_EXPECT_VERSION=0.5.4` before the command.

| Check                               | Installed 0.5.3 rerun | Optimized local build | Installed 0.5.4 |
| ----------------------------------- | --------------------: | --------------------: | --------------: |
| Edit input p95, 51 KB / 1,000 files |                 24 ms |                 17 ms |           17 ms |
| Split input p95, same fixture       |                 65 ms |                 18 ms |           17 ms |
| Cold backlinks, 200 notes           |              5,750 ms |                242 ms |          310 ms |
| Warm backlinks, 200 notes           |                 43 ms |                 27 ms |           30 ms |

The earlier uninstalled Split regression was 107 ms. The outer Tiptap instance now stays mounted; external source refreshes batch for 100 ms and replace ProseMirror state after input settles. Preview is temporarily noneditable while its source is stale. Direct rich edits, autosaving and recovery remain immediate. External revisions distinguish repeated text values, clear old rich undo and reset embedded editing histories, including unchanged blocks. Canonical node attributes protect against delayed React portal props.

FileTree now indexes entry lists and memoizes expensive rows behind current event handlers. Backlinks read up to 32 paths per secure helper call, with a 1 MB metadata chunk target, a 20 MB actual aggregate limit, per-file errors, strict fresh rename errors and parsed-reference caching invalidated by target-path changes. Inactive CodeMirror histories are limited to 32; closed-tab history retains 20 recent tabs. Active document text and recovery remain authoritative when an inactive history is evicted.

Verification: 192 tests pass; 10 local database cases skip because Supabase is stopped. Desktop and browser formatted editing/view-control QA, desktop history/tree lifecycle QA, root/web types and builds, and scoped formatting/lint/type checks pass. The focused code review is approved after real RED-to-GREEN tests for repeated-source refresh and embedded undo. Hardware IME, GPU-specific scrolling and real-vault heap profiling remain untested. Normal plain-note scrolling had no reproduced lag in these fixtures. Raw comparison JSON is in `qa-artifacts/desktop-performance/{installed-results,optimized-results}.json`.

## Measured typing and scrolling

The fixture contains 350 Markdown paragraphs, 51,713 bytes and 54 typed characters at 20 ms intervals. Input latency is beforeinput to the next animation frame, reported at the 95th percentile. IPC and browser performance counters were sampled independently.

| Build and condition                                                                                    | Input p95 | Renderer script time during typing |
| ------------------------------------------------------------------------------------------------------ | --------: | ---------------------------------: |
| Installed 0.5.3, 30 files, Edit                                                                        |      16ms |                              193ms |
| Installed 0.5.3, 1,000 files, Edit                                                                     |      26ms |                              947ms |
| Installed 0.5.3, 1,000 files, Split                                                                    |      68ms |                            2,945ms |
| Installed 0.5.3, 1,000 files, Split, sidebar hidden                                                    |      59ms |                            2,265ms |
| Installed 0.5.3, 1,000 files, Split, sidebar hidden, 5 KB note                                         |      25ms |                              640ms |
| Installed 0.5.3, 1,000 files, Split, sidebar hidden, recovery writes disabled only in the test profile |      62ms |                            2,292ms |
| Current build before the space fix, 1,000 files, Split                                                 |     107ms |                            4,511ms |

Plain-note scrolling in these fixtures generally stayed near 17 ms per frame; the user's scrolling lag was not reproduced. Recovery storage calls rounded to 0 ms in the instrumented sample, and bypassing them did not improve typing. The full-vault list/read calls occurred around saving, not once per key. Do not weaken recovery guarantees as a performance shortcut.

## Original findings before optimization

1. **Current Split regression, measured.** `src/renderer/RichPreview.tsx` changes the keyed session on each external source value, reconstructing the rich model, editor and node views while the source editor is typing. The current long-note sample is slower than installed 0.5.3. Fix this before installing the new feature: separate source-input updates from heavy preview work, while preserving external-change/conflict behavior and preventing stale preview edits from overwriting newer source. The installed build's static Markdown preview also rebuilds when its value changes. Do not add an ambiguous queue of source strings as an acknowledgment protocol.
2. **Whole-app/sidebar work, measured scaling plus code evidence.** `Editor.tsx` reports every selection and scroll position through `DocumentPane.tsx` to App's layout state; text edits also update App's tabs. `FileTree.tsx` rebuilds its folder set and recursively filters/renders rows. Moving from 30 to 1,000 files increased Edit scripting work from 193 ms to 947 ms for the same note and typing sample. Isolate document/view updates from the sidebar, cache the tree structure, and consider visible-row rendering for large vaults. Preserve per-pane cursor and scroll restoration.
3. **Cold backlink loading, measured.** Installed 0.5.3 took 5,475 ms to calculate incoming links for 200 tiny Markdown notes, compared with 42 ms on the warm call. `src/main/links.ts` walks every Markdown note sequentially; each `Vault.read` starts the secure Python helper in `src/main/vault.ts`. Use a batch read through the existing secure helper and cache parsed references per file. Retain path validation, cancellation and fresh-data guarantees for rename planning.
4. **Unbounded retained editor/tab state, code-confirmed risk.** `Editor.tsx` retains EditorState and undo history in a module Map on unmount. The normal note close path does not call `forgetEditor`. `App.tsx` also pushes full working tabs onto an uncapped closed-tab stack; it clears at workspace/vault boundaries but has no bound within a long session. This can retain note text and history as more files are visited or closed. Heap growth was not benchmarked. Bound inactive history/caches while preserving active tabs, unsaved recovery and the reopen-closed-tab behavior.

Startup in the synthetic 1,000-file runs was roughly 0.9 to 1.1 seconds for installed 0.5.3 and 1.7 seconds for the current build. These single-run observations are insufficient to attribute a startup regression. Search, Office/PDF rendering, GPU-specific scrolling and real-vault memory growth were not benchmarked in this pass.

## Document-space fix

Full width is now the default for missing appearance preferences. Explicit saved reading widths remain valid. The source editor's hard-coded 940 px cap is removed, and the rich editable surface fills the preview viewport height even for a short note. Fixed reading widths continue to fill up to their chosen cap rather than shrinking to the text's intrinsic width. Existing profiles with a saved fixed width can select Settings > Appearance > Reading width > Full width; no normal profile was modified.

Verification uses `scripts/document-view-qa.mjs` with short-note width/height checks at 1500x1000 and 1100x740 in Edit/Preview/Split, then a fixed 680 px reading width, Fit, zoom and fullscreen. The fixed-width short-note regression was reproduced before its CSS correction. Source fixtures must remain unchanged by sizing controls. Raw benchmark JSON and the cold/warm backlink output are under the ignored `qa-artifacts/desktop-performance/` folder.
