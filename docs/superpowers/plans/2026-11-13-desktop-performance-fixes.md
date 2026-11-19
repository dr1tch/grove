# Desktop performance fixes

Authorized by the user after the five-point performance proposal. Use this checkout, preserve prior changes, and do not commit, install or deploy.

1. Keep the Tiptap instance mounted across source updates. Batch external refreshes for 100 ms and temporarily disable stale Preview editing. Keep direct rich editing, saves and recovery immediate. Replace ProseMirror state with a fresh source model; preserve selection and scroll while clearing old external-source undo. Verify stable DOM identity and the 50 KB / 1,000-file fixture.
2. Memoize FileTree behind stable latest-callback delegates and index folders/files once per entry-list change. Verify navigation, collapse, menus, creation and typing/scroll performance.
3. Batch backlink reads through the existing secure Python helper, with bounded requests, per-file failures and strict fresh-rename errors. Test path/symlink boundaries and benchmark 200-note cold/warm loading.
4. Bound inactive CodeMirror states to 32 entries and closed-tab history to 20 tabs. Preserve active document/recovery values, recent undo and reopen. Add cache eviction tests and desktop lifecycle checks.
5. Run tests, desktop/web QA, types/builds and comparative performance probes. Request a focused final review, fix findings and update audit/handoff. Leave all changes unstaged and uncommitted.

Completed locally. All five tasks have verification in the progress ledger and docs/desktop-performance-audit.md. Final review approved after source-revision and embedded-history regressions were reproduced and fixed. Stable outer editor identity, stale-write blocking, retained scroll, repeated source values, recent undo/reopen and cache limits have checks. 192 tests pass; 10 local database cases skip. Installed Grove remains 0.5.3. No commit, install or deployment was performed.
