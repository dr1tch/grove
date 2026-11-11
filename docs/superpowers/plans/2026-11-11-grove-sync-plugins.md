# Grove sync and plugins plan

> **For agentic workers:** use superpowers:executing-plans or superpowers:subagent-driven-development. Spec: `docs/specs/grove-sync-plugins.md`. Leave git changes in the Grove repo uncommitted unless the user asks.

Each phase ships on its own as a new Grove version. Do not start a phase until the previous one passes its checks and is installed.

## Phase 1: Desktop Git sync (about 1 day)

- [ ] Settings > Sync: connect the vault to a new or existing private GitHub repo (`gh repo create --private` or a pasted URL). Write `.gitignore`. Show what will be committed first, including large files that will be skipped.
- [ ] Main-process sync worker using system `git`: debounced commit after saves, pull --rebase on open, focus and every 5 minutes, push after commit. One sync at a time per vault. Never force.
- [ ] On rebase conflict: abort, keep both versions, open the existing comparison dialog per file. Dirty open files go through the existing external-change flow.
- [ ] Footer status (synced, syncing, offline, conflict, error, last sync time) and a Sync now button.
- [ ] Tests: two clones of a local bare repo; edit on both sides, conflict, offline queue, large-file skip, dirty-draft protection. Native QA script `scripts/sync-qa.mjs`.

## Phase 2: Web and phone app (about 3 to 5 days)

- [ ] Build target for the renderer without Electron. Split `window.folio` into the desktop bridge and a web implementation; methods without a web equivalent return a typed "desktop only" result the UI already shows.
- [ ] Web file layer over the GitHub REST API: tree listing, read, write with blob SHA check, create, rename, delete to a `.trash/` path, binary assets.
- [ ] Sign-in with a fine-grained token or OAuth device flow, stored only in that browser. IndexedDB cache and offline edit queue.
- [ ] Mobile layout: drawer sidebar, single pane, touch controls, installable PWA manifest and service worker.
- [ ] Deploy to GitHub Pages (needs the user's go-ahead before publishing). QA in a phone-sized browser with Playwright plus a real phone check by the user.

## Phase 3: Grove plugin system (about 2 to 3 days)

- [ ] Plugin loader for `.grove/plugins/*/manifest.json`, Settings > Plugins with enable, disable and permission approval.
- [ ] Sandbox host (opaque-origin iframe per plugin) and message API: read/write notes by permission, register code block renderer, file previewer, command, shortcut, panel, settings.
- [ ] Wire renderers into Markdown preview, commands into a command palette (Ctrl+P), panels into the sidebar.
- [ ] Two sample plugins in `examples/plugins/`: a chart code block and a "daily note" command with a calendar panel.
- [ ] Tests for permission denial, crash isolation, timeout and malicious output sanitizing.

## Phase 4: Obsidian plugin compatibility (about 1 week, partial by design)

- [ ] `obsidian` module shim on top of the Phase 3 API, covering the list in the spec.
- [ ] Static scan of `main.js` for unsupported APIs and Node/Electron use; show a compatibility verdict before enabling.
- [ ] Pick 5 popular plugins with the user, make as many work as the shim allows, and document what fails and why.

## Release checks (every phase)

`vp check`, `vp test --run`, existing native QA scripts touched by the change, the new phase QA script, `scripts/visual-qa.mjs`, package, install, packaged smoke.
