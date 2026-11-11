# Grove sync and plugins plan

> **For agentic workers:** use superpowers:executing-plans or superpowers:subagent-driven-development. Spec: `docs/specs/grove-sync-plugins.md`. Leave git changes in the Grove repo uncommitted unless the user asks.

Each phase ships on its own as a new Grove version. Do not start a phase until the previous one passes its checks and is installed. Each phase gets its own detailed plan when it starts, written against the code as it is then.

**Order:** 1. Git sync (0.5.0, detailed plan: `2026-11-11-grove-git-sync.md`). 2. Windows port (0.6.0). 3. Web and phone (0.7.0). 4. Grove plugins (0.8.0). 5. Obsidian plugins (0.9.0).

## Phase 1: Desktop Git sync (about 1 day)

See the detailed plan `docs/superpowers/plans/2026-11-11-grove-git-sync.md`.

## Phase 1b: Windows port (about 1 to 2 days)

- [ ] Replace `resources/vault_io.py` Linux calls (openat2, renameat2, O_PATH, flock) with a Node implementation behind the same request/response contract, keeping path confinement (realpath plus no-symlink checks), atomic replace (write temp, `ReplaceFileW`-style rename) and locking (lock file with exclusive create). Linux keeps the Python helper.
- [ ] Make LibreOffice, bubblewrap and `pdftotext` lookups platform-aware; features without a Windows equivalent show a clear message.
- [ ] Add `win` target (NSIS) and a `windows-latest` job to `release.yml`; run `vp test --run` and the vault race tests on Windows in CI.
- [ ] Verify on a real Windows machine with the user.

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
