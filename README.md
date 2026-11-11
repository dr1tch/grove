# Grove

A native Linux workspace for Markdown, drawings and local files, following the supplied [Folio specification](docs/specs/folio.md). This is an early development build, not a finished implementation of every acceptance check.

## Try the desktop build

1. Install `release/folio_0.4.0_amd64.deb` with `sudo apt install ./release/folio_0.4.0_amd64.deb` from this directory.
2. Launch Grove from the app grid. Ubuntu requires the installed package's AppArmor/sandbox integration; an unpacked development binary cannot launch securely on this machine without it. Do not work around that with `--no-sandbox`.
3. Open a test folder. Markdown, JSON drawings and compressed Obsidian Excalidraw drawings stay in their original formats.

The AppImage is also produced, but its sandbox launch on this Ubuntu installation is not verified. The Flatpak manifest in `build/` is supplied but not built. Folio 0.1.0 was installed and launched with its renderer sandbox enabled. LibreOffice document readers are installed for the 0.2.0 update.

## Changes in 0.4.0

1. Two independent document panes share one draft/save owner. Open beside, resize the divider and restore each pane's reading position. Named workspaces save layouts and folder expansion per vault without copying note content.
2. Drop files or paste screenshots into Markdown. External files are copied into the note's attachments folder without overwriting; existing vault files are linked. Images and PDF/video/audio previews appear inline. Undo removes links and keeps attachment files.
3. Ctrl+K opens the recent/fuzzy file switcher. Shift+Enter opens beside. Ctrl+Shift+F searches note/code/PDF text; Ctrl+F searches the active file. Results highlight matches and reject stale offsets. A 1,000-small-text-file fixture scanned in 75 ms; PDF-heavy vault latency is not measured.
4. Backlinks and unresolved links are available from the toolbar. Rename previews link updates, blocks affected dirty notes and keeps an interrupted-operation journal with Resume. External changes and saved versions have a comparison dialog; unavailable files keep their working copy.
5. HTML/XHTML supports source/preview split with local CSS/images and scripts/network disabled. Export note creates self-contained HTML or PDF with images, diagrams and bundled fonts. Review output size and any omissions before saving. Replacing an export keeps a .before-export recovery copy.

HTML previews are offline: scripts, forms, external resources and embedded pages are disabled. PDF search reads existing text and does not perform OCR. Portable export has a 100 MiB embedded-data limit. Exported PDF represents nonprintable attachments by their readable labels. Keep export recovery copies until you no longer need them; cleanup is manual.

## Changes in 0.3.2

Version 0.3.3 removes the fixed 900px cap from code, chart and diagram panels. Panels now fill the document content width and follow the selected reading width in full and split preview modes.

The sidebar keeps vertical scrolling only. Long file and folder names truncate to fit the sidebar, with full names and paths shown in real hover/focus tooltips. Tooltips render above clipped panels, stay inside the window and dismiss with Escape, outside clicks, scrolling or pointer departure. File, folder, workspace and tab names do not use native title hints.

## Changes in 0.3.0

Version 0.3.1 adds file-type icons, stable diagram modals, top-aligned diagram scrolling, native clipboard copying with feedback, outside-click dismissal, new-note preview mode and an adjacent plus button in the tab strip. See `docs/grove-0.3.1-verification.md` for verification details.

1. The app is now Grove. Its launcher icon uses the same normalized visible footprint as the installed Claude Desktop icon. Package identity, vault paths and the existing `~/.config/folio` profile remain compatible.
2. Folder names choose coloured category icons for code, documentation, notes, images, design, media, tests, configuration, archives, packages, people and projects. The workspace switcher uses the Grove mark.
3. Settings is a centered modal with Appearance, Editor and About navigation, focus containment and Escape to close.
4. New files and folders are named inline at the selected location in the tree. Enter creates, Escape cancels, duplicate names never overwrite files. Notes default to Markdown; explicit code/drawing extensions are kept.
5. Open in new tab, middle-click and Ctrl/Cmd-click keep the current preview open. Pinned tabs display their file icon without a title, with the full path available on hover.

## Changes in 0.2.0

1. Appearance opens directly beside the folder settings icon. Reading widths include 960, 1200 and full width, with an installed-font picker. F11 and Appearance offer window fullscreen.
2. Header empty space is draggable; tabs and buttons remain interactive. Sidebar width can be dragged or changed with arrow keys on its separator. Long outline popovers scroll within the window and truncate long titles.
3. Tab right-click opens tab/file actions. Folder icons, nested folders, new files/folders, rename and recoverable file/folder deletion are available. Renames preserve history and closed recovery drafts.
4. Vue, JavaScript, TypeScript and many source files have language-aware editing and formatted, syntax-coloured previews. CSV/TSV show tables; unknown valid UTF-8 files open as text. Unsupported binary files retain their external-app fallback.
5. Flowcharts use rounded nodes, calmer spacing, theme-aware colours, zoom and expanded viewing. Word, Excel and PowerPoint render as read-only pages through an isolated LibreOffice process operating on a copy.

Verified with focused tests plus native UI fixtures. Proprietary formats and malformed documents can still fail to render; originals can be opened externally. Office documents remain preview-only. Source, Markdown and Excalidraw files are editable.

## Working in this build

1. Integrated document tabs, preview tabs, pins, drag reorder, reopen closed tabs, light/dark/system themes, six accents and three preview fonts. Fonts and editor assets are bundled offline.
2. CodeMirror editing, autosave, sanitized GFM preview, editable tasks, wikilinks, images, Mermaid and Excalidraw embeds. Real Excalidraw drawing editor. Split editing is available.
3. PDF and image previews open fitted and centered, with zoom controls and a separate fullscreen viewer window with Escape to close. Scrolling over images or videos zooms them. Drag zoomed media to pan, and double-click its content or use Fit to window to reset. Panning works in separate image windows too. Video controls and playback position are preserved. PDF headers are checked when opening a file, so PDF receipts saved with an incorrect extension still open as PDFs. Tooltips prefer above/below placement, use side placement when needed, and stay within the window. Fit to window follows resizing. PDFs also include page controls. Native media controls and external fallback are available. Office conversion uses LibreOffice if it is installed, operating on a cached copy.
4. Conflict comparison, keep both as a separate copy, explicit version choice, version history and recoverable Trash. Writes preserve displaced file inodes using Linux atomic exchange; reads use kernel-enforced path containment. Only valid UTF-8 is editable.
5. Claude/Codex panel with explicit context, local signed-in CLI adapters and create/update/delete proposals. CLI processes have an isolated filesystem, no real vault access and no direct document write capability. Only accepting a proposal invokes the vault write path. Provider calls have not been exercised against a paid service.

## Build and check

Node 22+, Vite+, Python 3 and a Linux kernel with `openat2` and `renameat2` are required. Bubblewrap is required for CLI assistant connections. Installed Claude/Codex native executables are located at `~/.local/bin/`; sign in using the CLI first. App credentials are not copied into app state.

```sh
vp install
node node_modules/electron/install.js
vp check
vp test --run
python3 scripts/vault-races.py
vp run build
vp run package
```

`xvfb-run -a node scripts/smoke.mjs` exercises the native UI in an isolated temporary profile. `scripts/features.mjs` checks conflicts, drawing edits and PDF rendering. Playwright adds `--no-sandbox` to its test launch; these tests verify preferences and UI behavior, not the installed release's OS sandbox. No production vault is used in tests. On this shared workstation, follow the user's devport instructions before running a development server.

## Remaining specification work

1. Signed releases and automatic updates need a release channel and signing credentials. Current artifacts are unsigned local builds; macOS/Windows packaging is not prepared.
2. Full assistant tool-driven vault search, drawing image attachments, PDF text context, activity streaming and proposal Undo are not complete. Current adapters receive the explicitly listed text/drawing sources and return proposals. No API-key settings are implemented because this build uses signed-in CLIs.
3. PDF thumbnail/find UI, Mermaid SVG/PNG export, preview drawing styling and the custom gutter context button need more work. Media and Office support depend on the installed codecs and LibreOffice.
4. Tabs do not yet implement the complete context menu, MRU switcher, per-vault workspace history, persisted cursor/scroll state or drawing undo across tab switches. Split scroll synchronization and full keyboard/focus polish remain.
5. Trash cleanup is deliberately not automatic in this build; files remain until restored. Large-vault startup, memory targets and complete contrast/accessibility acceptance have not been measured. History is unbounded and retains original file inodes so late external saves remain recoverable.

Documents are plain local files. App state is under Electron userData, snapshots under `.folio/history/`, and deleted files under `.trash/`. Back up important folders before trying an early build. The original design exports are untouched. All repository changes remain uncommitted.
