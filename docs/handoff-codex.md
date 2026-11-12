# Handoff to Codex — Grove, 2026-11-12

Read this first. It is everything you need to continue without the previous session.

## First action

1. `cd ~/Desktop/code/folio && git status --short` and `git log -3 --oneline`. Version 0.5.1 is installed and verified locally. Release commit `ccc82fb`, branch `fix/small-0.5.1` and tag `v0.5.1` were pushed at the user's request. The user subsequently authorized a local commit of the workspace foundation, landing page and shared sync work. Inspect actual Git state before continuing; no further push, tag or publishing is authorized.
2. Read `docs/superpowers/plans/2026-11-12-grove-clients-workspaces.md` and `docs/specs/grove-clients.md`. The client plan replaces the original PWA-only phone plan. Task 1 is implemented locally: pnpm workspaces, private `@grove/core` source exports, desktop compatibility modules, Electron bundling and exact branding sources. 122 tests, Vite+ checks, isolated core types, browser core bundle, frozen install, desktop build and toolbar/draft Electron QA pass. Task 9 landing is also implemented locally in apps/landing, built to out/landing at /grove/. Responsive QA and code review pass. Desktop packaging excludes landing output. Preview registered through devport on port 3070; check ownership before changing it. Tasks 2 and 3 are implemented locally: packages/github-vault contains the fixed-origin SHA-conditional store and durable VaultSession; apps/web currently contains only the IndexedDB adapter and typecheck package. 148 tests, root/package checks, builds and scripts/web-cache-qa.mjs pass. Review approved after response-body interruption regressions. Read packages/github-vault/README.md for cache acknowledgement/CAS/asset-pointer invariants and integration limits. Tasks 4 through 8 and 10 remain unstarted; no web UI, native SQLite or real GitHub verification yet. No landing publishing is authorized.

## The project

- Grove (formerly Folio): an Obsidian-like desktop notes app. Electron + React + TypeScript, Linux only.
- Repo: `~/Desktop/code/folio`, public at https://github.com/dr1tch/grove (MIT), default branch `main`. Commits use the repo-local git identity (do not change it).
- The apt package and binary are still named `folio` (`/opt/Grove/folio`); the user profile is `~/.config/folio`. Do not rename either (decided: not worth breaking profiles and file associations).
- Released: v0.5.0 (tag pushed, GitHub release built, signed APT repo at https://dr1tch.github.io/grove serves 0.5.0, installed locally).
- Local installation: 0.5.1. The installed `/opt/Grove/folio` passed the complete toolbar QA with `GROVE_EXPECT_VERSION=0.5.1` in a temporary profile, and `dpkg-query` confirms version 0.5.1. The user's existing window was not closed or relaunched. At the user's request, Codex now has an independent Git guard at `~/.codex/hooks/git_guard.py`, registered in `~/.codex/hooks.json`. Claude's guard and the migration wrapper remain unchanged. Authorized commits use an exact one-use repository/session grant as documented in `~/.codex/hooks/README.md`. Check `git tag --list v0.5.1` and git status for the final commit/tag state. No push or remote publishing was performed.

## Rules from the user (strict)

- Never `git commit` or `git push` unless the user says so in that message. Never force-push, `reset --hard`, `clean -f`, `branch -D`.
- Commit messages: one line, `Grove: <summary>`. No AI or co-author attribution lines.
- Ask before publishing anything (tags, GitHub repos, Pages).
- Never touch the user's running Grove window (the process with no `--user-data-dir`). Do not use `pkill -f`/`pgrep -f` with patterns that also match your own command.
- Output style: the user has ADHD. Lead with the next action, numbered steps, at most 5 items per list, concrete time estimates, no preamble or closing pleasantries, end with one concrete next action.
- Smallest complete change. Fix root causes in shared code. No speculative options or abstractions.

## Commands (Vite+ toolchain, `vp`)

| What                      | Command                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lint, types, format check | `vp check` (fix formatting: `vp check --fix` — it may reformat `scripts/`, check `git diff` after)                    |
| Unit tests (100 now)      | `vp test --run` (one file: `vp test --run src/main/sync.test.ts`)                                                     |
| Vault race tests          | `python3 scripts/vault-races.py`                                                                                      |
| Build                     | `vp run build`                                                                                                        |
| Package .deb + AppImage   | `vp run package` → `release/folio_<version>_amd64.deb`                                                                |
| Install locally           | `pkexec /usr/bin/apt install -y /home/dr1tch/Desktop/code/folio/release/folio_<v>_amd64.deb` (absolute path required) |
| Smoke test installed app  | `FOLIO_SMOKE_EXECUTABLE=/opt/Grove/folio xvfb-run -a node scripts/smoke.mjs`                                          |

Native UI QA scripts (Playwright `_electron`, run after `vp run build`): `xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/<name>.mjs`. Useful ones: `sync-qa`, `draft-note-qa`, `panes-qa`, `workspaces-qa`, `attachments-qa`, `pdf-regression-qa`, `export-qa`, `scroll-qa`, `diagram-popup-qa`, `visual-qa` (`GROVE_VISUAL_DEV=1` for the dev build). Each prints `PASS: ...`. Pattern: launch args `["--ozone-platform=x11", ".", "--user-data-dir=<temp>"]`, open a vault with `app.emit("second-instance", {}, ["electron","app",root])`.

Release: bump `package.json` version, add a `CHANGELOG.md` section, commit, tag `v<version>`, push `main` and the tag (only when the user asks). CI: `check.yml`, `release.yml` (Linux .deb/AppImage on `v*` tags), `apt.yml` ("APT repository", runs after Release, publishes Pages). Check apt with `curl -s https://dr1tch.github.io/grove/Packages | grep ^Version`.

## Architecture in five lines

- `src/main/` Electron main: `index.ts` (window, IPC `methods` record, vault-scoped methods take the vault root as last argument), `vault.ts` + `resources/vault_io.py` (safe file layer: atomic writes, versions, Trash, `.folio/io.lock` via flock), `sync.ts` + `git.ts` (Git sync).
- `src/preload/index.ts` exposes `window.folio` (method list + event channels). The contract is `FolioAPI` in `src/shared/types.ts`.
- `src/renderer/` React UI. `App.tsx` (~2.6k lines) owns tabs, panes, layout, save/autosave, dialogs. `DocumentPane`, `Markdown`, `Viewer`, `Editor`, `Drawing` (Excalidraw).
- `src/shared/` pure logic shared by both sides (links, state cleaning, files/kinds, tree names).
- The renderer reaches files only through `window.folio` — that is why the web plan swaps in a web bridge.

## What shipped today

- 0.4.7: video fullscreen, speed menu, full-width video embeds.
- 0.5.0 (`d0aa623`): Git sync. Settings > Sync connects a vault to a private GitHub repo (create with `gh` or use an existing URL). Commits ~30 s after the last save (`Grove: <hostname> <ISO time>`), pulls on open, focus (>60 s) and every 5 min, pushes after commit. Same-line conflicts keep the local file and save the remote as `Note (conflict <device> <date>).md`; banner "Compare side by side". Files > 50 MB skipped. Never force-push/reset. 32 tests in `src/main/sync.test.ts` use real git with bare repos. The user verified a real GitHub round trip.
- `24dff30`: new notes (Ctrl+N, Ctrl+T, +) open as an "Untitled" draft tab (internal path `draft://<uuid>.md`); the first heading is the name; nothing is written until Ctrl+S or close, which opens `SaveDraftDialog` (name, folder, Save/Discard/Cancel). Closing the window with unsaved drafts asks too (`draftsPending` + `onCloseRequest`). QA: `scripts/draft-note-qa.mjs`.

## Open work (in order)

1. **Fixes included in 0.5.1** (commit/tag/install requested by the user):
   - `styles.css`: `.embed-pdf .attachment-view { height: min(calc(100cqw * 1.414 + 45px), 85vh) }` — PDFs in notes fill the width.
   - `Markdown.tsx`: the `img` renderer embeds PDF/video/audio (`![[file.pdf]]` was a broken image).
   - `excalidraw-assets.ts`: one module sets `EXCALIDRAW_ASSET_PATH`; imported first by `Drawing`, `DrawingEmbed`, `ExportDocument`.
   - `CHANGELOG.md` "Unreleased" section lists the two user-visible fixes.
   - Known and accepted: Excalidraw still tries esm.sh for its CJK fallback font (it appends a CDN URL and subsets with `eval`, which the CSP blocks). Drawings render fine. Do not add `'unsafe-eval'`.
2. **Desktop Markdown toolbar, then clients**: the user explicitly requested desktop implementation first, followed by a plan for phone, landing and web. Version 0.5.1 adds `MarkdownToolbar`, `VaultInsertDialog`, shared formatting/Mermaid/reference helpers and `scripts/markdown-toolbar-qa.mjs`. Formatting uses normal editor history and saves. The picker embeds or links original vault files and copies saved Mermaid blocks, with stale-source checking. Root references work in new drafts saved into a folder. Code-file editors and Preview mode have no Markdown toolbar. Validation before release: 120 tests, lint/types/build, toolbar Electron QA, draft-note QA and code review passed. The toolbar QA supports `FOLIO_SMOKE_EXECUTABLE=/opt/Grove/folio GROVE_EXPECT_VERSION=0.5.1` for isolated installed-app checks. Do not close or relaunch the user's normal Grove window.

   Client plan: `docs/superpowers/plans/2026-11-12-grove-clients-workspaces.md`; spec: `docs/specs/grove-clients.md`. The requested architecture is pnpm workspaces, a React Native phone shell, the shared desktop React renderer for the browser, and a separate landing app. Phone design corrections: no document tabs, circular floating plus button, desktop-style colored icons, keyboard formatting toolbar, Insert from vault, safe first-save sheet and file-level conflict handling. Current design gallery: `/home/dr1tch/Downloads/Grove-designs-2026-11-12/index.html`; its manifest records the exact latest images and the original SVG proposals. The user requested a plan only for these clients; do not start client implementation or publishing without the next request.

3. **Deferred review of the sync code** (`git diff e2d238e d0aa623`): a whole-branch review focused on data loss, lock coverage, path handling and the IPC trust boundary was planned but has not run. Known parked items: restored executable files lose the exec bit; the conflict-marker cleanup path has no test; disabling sync mid-cycle can emit one stale status (UI ignores it).

## Gotchas

- `vp check --fix` keeps objects expanded once split; a stray formatter can leave large whitespace-only diffs in `App.tsx`. Check `git diff --stat` before finishing.
- The repo `.gitignore` ignores `.superpowers/` (old agent scratch, including the Phase 1 ledger at `.superpowers/sdd/2026-11-11-grove-git-sync/progress.md`).
- Sample vault for manual checks: `~/Documents/grove-samples` (run as `/opt/Grove/folio --user-data-dir=$HOME/.config/grove-samples $HOME/Documents/grove-samples`).
- `pkexec` shows a GUI password prompt to the user.
