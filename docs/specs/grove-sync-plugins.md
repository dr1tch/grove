# Grove sync and plugins

Status: proposed, 2026-11-11. Builds on Grove 0.4.1.

Update 2026-11-12: [Grove clients](grove-clients.md) supersedes the PWA-only phone design below. The phone app uses Expo/React Native, the browser reuses the React desktop renderer, and a separate landing page lives in the same pnpm workspace. The sync safety and plugin requirements here still apply.

## Decisions (from the user)

1. Sync between desktop PCs, phone (read and edit) and any browser.
2. Sync method: a private Git repository on GitHub. No Grove-hosted server.
3. Plugins: custom previewers, commands and shortcuts, UI panels, and running existing Obsidian plugins.

## Shape

One vault = one private GitHub repo. Every device talks to that repo.

1. Desktop: Grove runs system `git` in the main process. Auto-commit on save, pull on open and on an interval, push after commit.
2. Phone and browser: the same renderer built as a static web app (PWA) and hosted for free on GitHub Pages. A web implementation of `window.folio` reads and writes the repo through the GitHub REST API. Install it to the phone home screen for app-like use.
3. Plugins: run in a sandbox (iframe without same-origin, or a worker) and talk to Grove through a small message API. Obsidian plugins load through a compatibility layer that implements a subset of the `obsidian` module on top of that same API.

Why this shape: the renderer already reaches files only through the `window.folio` method list in `src/preload/index.ts`. Swapping that one layer gives a web build without a second UI. GitHub gives storage, history, auth and hosting without running a server.

## Sync rules

1. Never force-push, never rewrite history, never delete a local file because of a remote change without a recovery copy.
2. Commit is debounced (about 30 s after the last save) with message `Grove: <device> <time>`. Pull merges (no rebase). When both devices changed the same lines, the local version stays in place and the remote version is saved beside it as `<name> (conflict <device> <date>).<ext>`; a banner offers to compare them side by side. A file deleted on one device and edited on the other is kept.
3. Unsaved drafts are never committed. Dirty open files are not overwritten by a pull; they go through the existing external-change flow.
4. `.folio/`, `.trash/`, recovery copies and OS junk go in `.gitignore`.
5. Files over 50 MB are not committed; Grove lists them. GitHub rejects files over 100 MB. Git LFS is a later decision.
6. Status in the footer: synced, syncing, offline, conflict, error, with the last sync time. Offline edits queue and sync later.
7. Auth on desktop: reuse the user's existing `gh`/SSH credentials. Grove never stores the token itself.

## Web and phone rules

1. Sign-in: GitHub OAuth device flow or a fine-grained token limited to the vault repo, typed by the user and stored only in that browser.
2. Writes use the file's last known blob SHA. A mismatch means someone else changed it: show the comparison dialog, never overwrite.
3. Offline: cache the tree and opened files in IndexedDB; queue edits and push them when back online.
4. Mobile layout: sidebar becomes a drawer, one pane at a time, touch-sized controls.
5. Not available on the web: Office previews (need LibreOffice), Claude/Codex assistant (need local CLIs), Open externally, native PDF export (use browser print). Each shows a clear "desktop only" message.

## Plugin rules

1. A plugin is a folder in `<vault>/.grove/plugins/<id>/` with `manifest.json` (id, name, version, permissions, entry) and code. Plugins sync with the vault.
2. Permissions are declared and approved by the user per plugin: read notes, write notes, network, clipboard. No Node, no shell, no access outside the vault.
3. Capabilities in version 1: code block renderers (return sanitized HTML/SVG), file type previewers, commands with optional shortcuts, side panels (sandboxed iframes), settings page.
4. Plugins are off until enabled in Settings. A crashing or slow plugin is disabled for the session with a visible notice.
5. Obsidian plugins: Grove loads `.obsidian/plugins/*/main.js` with a shim for the common API (`Plugin`, `addCommand`, `registerMarkdownCodeBlockProcessor`, `registerMarkdownPostProcessor`, `ItemView`, `Notice`, `Modal`, `PluginSettingTab`, `vault.read/modify/create`, `metadataCache` basics). Before enabling, Grove scans for unsupported API and Node use and shows a compatibility verdict. Plugins that need Node or Electron internals are not supported. Expect a minority of community plugins to work at first.

## Out of scope for now

Real-time co-editing, end-to-end encryption beyond GitHub's private repo, Git LFS, a plugin marketplace, native iOS/Android apps.

## Risks

1. Git conflicts in Markdown are common when editing on two devices offline. Mitigation: small frequent commits and the per-file comparison dialog.
2. The GitHub API has rate limits (5,000 requests per hour per user). Use the trees API and caching, not one request per file.
3. Obsidian plugin compatibility is the riskiest part. Its API is large and changes; the shim will always be partial.
4. Plugin code is untrusted. The sandbox and permission model must be in place before any third-party plugin runs.
