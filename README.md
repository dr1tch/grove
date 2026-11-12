<p align="center"><img src="build/icon.png" alt="Grove logo" width="128"></p>

<h1 align="center">Grove</h1>

A desktop app for your notes, drawings and files. Grove opens a plain folder (a vault) and lets you read, write and preview Markdown, Excalidraw drawings, PDFs, code, Office documents and media in one place. Claude and Codex can read your notes and propose changes that you accept or reject.

Grove runs on Linux today. Windows is next, and a phone and browser version is on the [roadmap](#roadmap). Grove is an early build. Back up important folders before using it. See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="Grove with a Markdown note (flowchart, table, tasks) beside a TypeScript file in two panes">
</picture>

## Install

### Ubuntu / Debian (apt)

Add the repository once, then install and update with apt:

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://dr1tch.github.io/grove/grove.asc | sudo tee /etc/apt/keyrings/grove.asc > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/grove.asc] https://dr1tch.github.io/grove ./" | sudo tee /etc/apt/sources.list.d/grove.list
sudo apt update && sudo apt install folio
```

The package is named `folio` and installs the Grove app. Installers (.deb and AppImage) are also attached to each [GitHub release](https://github.com/dr1tch/grove/releases). Windows installers will be added to the same releases once the Windows port lands.

## Features

### Writing and reading

- Markdown editor with autosave, split editing and a GitHub-style preview: tables, tasks, wikilinks, images, Mermaid diagrams and Excalidraw embeds.
- Real Excalidraw editor. Drawings stay in their original JSON or Obsidian Excalidraw format.
- Code files (Vue, JavaScript, TypeScript and more) with syntax colours and formatted previews. CSV and TSV show as tables.
- HTML and XHTML source beside a safe preview with scripts and network disabled.
- Reading widths, installed fonts, light, dark and system themes, and six accent colours.

### Files and media

- PDF and image previews open fitted and centered, with zoom, page controls and a separate fullscreen window.
- Scroll to zoom images and videos, drag to pan, double-click to fit.
- Word, Excel and PowerPoint previews through LibreOffice, read-only and on a copy.
- Drop files or paste screenshots into a note. They are copied into an `attachments` folder and linked.
- Files with a PDF header open as PDF even with the wrong extension.

### Organising

- Tabs with pins, previews, reopen closed tab and drag to reorder. Two panes side by side.
- Sync a vault between computers through a private GitHub repository (Settings > Sync).
- Ctrl+K file switcher, Ctrl+Shift+F search across notes, code and PDF text, Ctrl+F in the current file.
- Backlinks, broken-link checks and renames that update links.
- Named workspace presets for layouts and open files.
- Export a note as self-contained HTML or PDF.

### Safety

- Atomic writes, version history, a comparison dialog for outside changes and recoverable Trash. Nothing is overwritten without a choice.
- Reads are confined to the vault by the Linux kernel. Snapshots live in `.folio/history/`, deleted files in `.trash/`.
- The Claude and Codex panel uses your signed-in CLIs in an isolated sandbox. It only proposes changes; nothing is written until you accept.

## Build from source

Requirements: Node 22+, [Vite+](https://vite.plus), Python 3 and a Linux kernel with `openat2` and `renameat2`. Bubblewrap is needed for the assistant panel. LibreOffice is optional, for Office previews.

```sh
vp install
node node_modules/electron/install.js
vp check
vp test --run
python3 scripts/vault-races.py
vp run build
vp run package
```

Install the local package with `sudo apt install ./release/folio_<version>_amd64.deb`. Launch Grove from the app grid; Ubuntu's AppArmor sandbox needs the installed package, so do not run an unpacked build with `--no-sandbox`.

UI checks run the real app headless, for example `xvfb-run -a node scripts/smoke.mjs` or `xvfb-run -a node scripts/visual-qa.mjs`. `scripts/readme-screenshot.mjs` regenerates the README screenshots from a demo vault. Some QA scripts expect sample PDFs at local paths; change those paths to your own files.

## Releases

Push a tag like `v0.4.2`. CI checks and tests the code, builds the .deb and AppImage, publishes a GitHub release and updates the signed APT repository. Add the release notes to [CHANGELOG.md](CHANGELOG.md) first.

## Known limits

- Linux only for now. The file layer uses Linux kernel calls, so Windows needs a port of that layer (in progress next).
- Sync needs git and either the gh CLI or SSH access to GitHub.
- PDF search reads existing text only, no OCR. Search speed on PDF-heavy vaults is not measured.
- The assistant cannot yet search the whole vault on its own, see drawings as images, read PDF text or undo accepted proposals.
- Trash and export recovery copies are not cleaned up automatically. Version history is unbounded.
- Large-vault startup and memory use are not measured.

## Roadmap

Windows support, Git sync across desktops, a phone and browser version, and plugins (including a partial Obsidian plugin layer). See [docs/specs/grove-sync-plugins.md](docs/specs/grove-sync-plugins.md).

## License

[MIT](LICENSE)
