# Build "Folio" — a native, installable desktop application

**This is desktop software, not a website or web app.** It is installed on the computer (like VS Code, Obsidian or Claude Desktop), launched from the app menu/dock, runs fully offline, has its own window with its own title bar, and works directly on folders on the local disk. There is no server, no browser tab and no account required. Web technologies are used only to draw the UI inside the native window.

You are building it for Linux (Ubuntu first, macOS/Windows later). It combines local Markdown documents, interactive Excalidraw drawings, file previews, and an optional Claude/Codex assistant. The design goal is the calm restraint of Claude Desktop applied to a document workspace — it must feel noticeably more modern and polished than Obsidian, especially the window header, document title and Markdown preview.

A clickable design prototype exists (mock data only). This document is the spec; follow it closely.

---

## 1. Stack (decided)

**Desktop shell: Electron.** Use the current stable Electron (45.x at time of writing).

> _Why not something lighter?_ The main alternative is **Tauri 2** (Rust backend, ~10× smaller installers, lower memory). It uses the operating system's web view, which on Linux is **WebKitGTK** — it lags Chromium in rendering performance, media codecs and canvas behaviour, and differs between distributions. Folio is Linux-first and leans on canvas (Excalidraw), PDF rendering, audio/video and precise typography, so a bundled Chromium is the safer choice. Electrobun and Wails are younger and share the same web-view trade-off. **Stay on Electron**; revisit Tauri only if installer size or idle memory becomes a real complaint.

**Toolchain: VoidZero / Vite+.**

- Install Vite+ globally (`curl -fsSL https://vite.plus | bash`) and use the `vp` CLI as the single entry point: `vp install`, `vp dev`, `vp check` (Oxfmt formatting + Oxlint linting + type checks), `vp test` (Vitest), `vp build` (Vite 8 + Rolldown), `vp run <task>` (cached tasks).
- One `vite.config.ts` (`import { defineConfig } from 'vite-plus'`) holds Vite, Vitest (`test`), Oxlint (`lint`), Oxfmt (`fmt`) and task (`run`) settings; `staged: { '*': 'vp check --fix' }` for pre-commit.
- Electron needs three bundles (main, preload, renderer). Use **electron-vite** for those builds, invoked through `vp run dev` / `vp run build` tasks, so Vite+ still owns install, check, test and task caching. If Vite+ can build the three Electron targets directly by the time you start, prefer that and drop electron-vite.
- Packaging: **electron-builder** (`.deb`, `.AppImage`, `.rpm`, Flatpak; later `.dmg`, `.exe`/`.msi`) with **electron-updater** for signed auto-updates.

**UI: React + TypeScript + Tailwind CSS v4** (via `@tailwindcss/vite`).

- All design tokens from §3.2 live as CSS variables and are exposed through Tailwind's `@theme` (e.g. `--color-surface`, `--color-chrome`, `--color-accent`), so classes read `bg-surface text-muted border-line`.
- Themes switch with a `data-theme="light|dark"` attribute on `<html>` (custom variant `@custom-variant dark (&:where([data-theme=dark] *))`); accent with `data-accent="pine|indigo|plum|graphite|terracotta"`; document font with `data-docfont="serif|sans|mono"` — each only overrides variables.
- Keep component classes in `@layer components` for repeated pieces (`.btn`, `.seg`, `.row`, `.tab`, `.chip`). Write the Markdown preview styles as our own `.md` layer (do not ship `@tailwindcss/typography` defaults — §5.2 defines every rule).
- No component kit that imposes its own look. Headless primitives (Radix or React Aria) are fine for menus, dialogs and tooltips.

**Libraries:** CodeMirror 6 (editor) · mermaid (diagrams in Markdown) · unified/remark/rehype with GFM + Obsidian syntax (`[[wikilinks]]`, `[[note|alias]]`, `![[embed]]`) · Shiki for code highlighting · `@excalidraw/excalidraw` (real component) · pdf.js · `chokidar` (or `@parcel/watcher`) for file watching · LibreOffice headless (if installed) to render Office files read-only, cached, never converting the original.

**Electron security (required):** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict Content-Security-Policy, no remote content in the main window. All file-system and agent access goes through a typed IPC API exposed by the preload script (`window.folio.fs.read(path)`, etc.); the renderer never touches Node directly. Paths are validated to stay inside the open vault.

**Storage:** none of our own for documents. Disk is the source of truth. App state (recent files, open tabs, layout, settings) in Electron's `userData` dir; version history in `<vault>/.folio/history/`; trash in `<vault>/.trash/`.

## 1b. Desktop application requirements

- **Packaging & install:** produce installable builds — `.deb` (Ubuntu/Debian), `.AppImage`, and a Flatpak manifest; later `.dmg` (macOS) and `.exe`/`.msi` (Windows), all via electron-builder. Ship an app icon, a `.desktop` entry (name, icon, category Office;TextEditor), and appear in the GNOME app grid/dock.
- **Native window:** custom-drawn title bar (§4.1) with real minimise/maximise/close wired to Electron's `BrowserWindow` (frameless window, `titleBarStyle: 'hidden'`), window dragging, double-click to maximise, edge resizing, minimum size 1000×640. Remember window size, position, maximised state, sidebar/assistant widths and **open tabs** between launches.
- **Single instance** (`app.requestSingleInstanceLock()`): launching again (or opening a file from the file manager) focuses the existing window and opens the file there.
- **File associations:** register as an "Open with" handler for `.md` and `.excalidraw`; accept a folder or file path as a command-line argument (`folio ~/Notes`, `folio note.md`).
- **Native dialogs & OS integration:** native Open Folder / Save As dialogs; "Show in Files" opens the system file manager with the file selected; "Open externally" uses the OS default app (`xdg-open`); system notifications only for long background tasks.
- **Offline first:** every feature except the assistant works with no network. Fonts (Geist, Source Serif 4, JetBrainsMono Nerd Font) and all assets are bundled in the app — never loaded from the internet.
- **Secrets:** store API keys with Electron `safeStorage` (backed by libsecret / Keychain / DPAPI), never in plain files.
- **Follow the OS:** honour the system light/dark preference when Theme = System, the system text-scaling factor, reduced-motion, and the GTK window-button layout.
- **Updates:** built-in updater (electron-updater) with signed releases; can be turned off.
- **Performance:** cold start < 1.5 s on a 10,000-note vault (index names first, content in the background); typing latency < 16 ms; memory use reasonable for an always-open app.

## 2. Non-negotiable principles

1. **Open any folder in place** — including an existing Obsidian vault. No import, no proprietary format, no conversion. Ignore `.obsidian/` but don't break it.
2. **Never silently overwrite.** Before every write, compare the on-disk hash with the hash we last read. If they differ, stop and show the conflict UI (§7.5).
3. **Agents propose, people accept.** The assistant can search and read; every create/update/delete is shown as a proposal with Accept/Reject.
4. **Deletes are recoverable.** Delete = move to `<vault>/.trash/` for 30 days. Restoring puts the file back at its original path.
5. **Every save is a version.** Keep snapshots so any edit (human, agent, external) can be restored. Restoring saves the current version first.
6. Be honest in the UI: preview-only and unsupported files are labelled as such, with "Open externally".

---

## 3. Visual design

### 3.1 Fonts

- **Interface:** Geist (400/500/600), fallback Inter, system-ui.
- **Editor & code (always):** **JetBrainsMono Nerd Font** (bundle the Regular, Medium, Bold and Italic WOFF2/TTF files with the app; OFL-licensed). Fallback JetBrains Mono, monospace.
- **Document preview font is a user setting** (like Claude Desktop's chat font):
  - **Serif (default):** body Source Serif 4, 17px / 1.72; headings Geist 600.
  - **Sans:** Geist throughout, 16px / 1.7.
  - **Mono:** JetBrainsMono Nerd Font throughout (headings and tables too), 15px / 1.8.
- Diagram labels: Excalidraw's own hand-drawn font.

### 3.2 Colour tokens

Warm neutrals; one restrained accent. Everything is a CSS variable so themes and accents swap instantly.

| Token            | Light                 | Dark                                | Use                                 |
| ---------------- | --------------------- | ----------------------------------- | ----------------------------------- |
| `--wall`         | `#DEDBD5`             | `#34322F`                           | behind window (prototype only)      |
| `--win` (chrome) | `#F5F4F1`             | `#1A1918`                           | title bar, sidebar, assistant panel |
| `--surface`      | `#FFFFFF`             | `#22211F`                           | the document panel                  |
| `--raised`       | `#FFFFFF`             | `#2A2927`                           | menus, popovers, floating panels    |
| `--code`         | `#F6F5F2`             | `#1C1B1A`                           | code blocks, table headers          |
| `--canvas`       | `#FAF9F7`             | `#1F1E1C`                           | drawing background                  |
| `--line`         | `#E6E4E0`             | `rgba(255,255,255,.085)`            | hairlines                           |
| `--line2`        | `#D9D6D0`             | `rgba(255,255,255,.14)`             | stronger borders                    |
| `--text`         | `#252320`             | `#E8E6E2`                           | primary text                        |
| `--muted`        | `#67635C`             | `#A9A6A0`                           | secondary text, icons               |
| `--faint`        | `#6B6760`             | `#9A978F`                           | labels, meta (still ≥4.5:1)         |
| `--hover`        | `rgba(37,35,32,.05)`  | `rgba(255,255,255,.05)`             | hover fill                          |
| `--sel`          | `#ECEAE6`             | `#383633`                           | selected row                        |
| `--ok`           | `#2E7A47`             | `#7FCB95`                           | "Saved" dot                         |
| `--warn` / bg    | `#8A5B00` / `#FBF4E4` | `#E6BC6C` / `rgba(230,188,108,.09)` | conflict                            |
| `--danger` / bg  | `#B3261E` / `#FCEEEC` | `#F09A8C` / `rgba(240,154,140,.09)` | errors                              |
| `--add` / text   | `#DDF2E2` / `#1E5C33` | `rgba(64,120,80,.42)` / `#AEE0B8`   | diff +                              |
| `--del` / text   | `#FBE3DE` / `#9E382C` | `rgba(130,62,50,.42)` / `#F3BBAF`   | diff −                              |

**Accent is a user setting** (default **Emerald**). Accent drives links, focus rings, primary buttons, checked tasks, blockquote rule, selected drawing tool and the active font card.

| Accent                                                         | Light     | Dark      | Text on accent (light / dark) |
| -------------------------------------------------------------- | --------- | --------- | ----------------------------- |
| **Emerald** (default) — Tailwind `emerald-700` / `emerald-400` | `#047857` | `#34D399` | `#FFFFFF` / `#022C22`         |
| Pine                                                           | `#1E6B66` | `#72C3B7` | `#FFFFFF` / `#0F1F1D`         |
| Indigo                                                         | `#3F4FA8` | `#9DAAEF` | `#FFFFFF` / `#141729`         |
| Plum                                                           | `#84406F` | `#D69CC5` | `#FFFFFF` / `#24131F`         |
| Graphite                                                       | `#34312D` | `#DAD7D1` | `#FFFFFF` / `#1A1918`         |
| Terracotta                                                     | `#B5562F` | `#DB8961` | `#FFFDFB` / `#1E1A17`         |

`--accent-bg` = accent at 9% (light) / 14% (dark). Focus ring = 2px accent at ~60% opacity.

Syntax colours — light: keyword `#9A3A85`, string `#2D7643`, function `#4E49AE`, type `#2C639E`, number `#A65826`, comment `#76726B` italic. Dark: `#E39CD1`, `#9DD49C`, `#ABAAF2`, `#8FC4E9`, `#E9B67F`, `#8E8B85`.

### 3.4 Icons

- **Lucide** (`lucide-react`), imported per icon. `strokeWidth={1.75}`, `absoluteStrokeWidth` off; 16px in chrome, 14px in buttons/chips, 12px for × and window controls. Icons inherit `currentColor` (muted by default, `--text` on hover/active). No filled or multicolour icons except status (amber/red).
- Mapping: title bar `PanelLeft`, `ChevronLeft`/`ChevronRight`, `Plus`, `ChevronDown`, `Sun`/`Moon`, `Ellipsis`, `Sparkles`, window controls `Minus`/`Square`/`X` · file kinds `FileText` (.md), `Shapes` (.excalidraw), `BookOpen` (PDF), `Image`, `Code`, `FileType` (Office), `AudioLines`, `Video`, `FileX` (unsupported) · sidebar `Search`, `Folder`, `Trash2`, `SlidersHorizontal`, `ChevronsUpDown` · actions `History`, `ExternalLink`, `Copy`, `Check`, `Pin`, `Pencil`, `RotateCcw`, `TriangleAlert` · drawing `MousePointer2`, `Square`, `Diamond`, `Circle`, `ArrowUpRight`, `Type`, `ImagePlus`, `Undo2`/`Redo2` · assistant `AtSign`, `ArrowUp`, `ListPlus`, `PanelsTopLeft`.
- Code-font ligatures (JetBrainsMono's `===` → ≡, `=>` → ⇒) stay **on**.

### 3.3 Shape & spacing

- Window radius 12px. Document panel is an **inset surface**: 1px `--line` border, radius 12px, 8px gap from the window's right/bottom edges (and left edge when the sidebar is hidden). Chrome (title bar, sidebar, assistant) shares `--win` so the header blends in.
- Buttons/rows radius 7–8px; cards 11px; menus 11px with soft shadow.
- No gradients, no heavy shadows inside the window, no rows of tiny toolbar icons, no oversized headings, no card-on-card dashboards.
- Touch/click targets ≥ 28px in chrome, 30px buttons.

---

## 4. Window layout

```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ [▤]     [‹][›]│ [▣ Local-first sync ×][◇ Sync architecture][▤ CRDT survey]  +  ⌄ │ ● Saved [Edit|Preview|Split] ☾ ⋯ [✦ Assistant] │ (–)(□)(×) │  ← 48px, all chrome, draggable
│ [ Search  ⌃K ]├──────────────────────────────────────────┬───────────────────┤
│ Recent        │                                          │ Assistant (opt.)  │
│ Folders ▾     │        document surface (inset)          │ 384px             │
│   …           │                                          │                   │
│ ─────────     │                                          │                   │
│ Trash      2  │                                          │                   │
│ [R] Research ⇅ ⚙ +                                        │                   │
└───────────────┴──────────────────────────────────────────┴───────────────────┘
```

### 4.1 Title bar (top priority)

- 48px, background `--win`, **no bottom border**. Layout: left controls · **tab strip (flexible, §4.3)** · right actions.
- **Left:** when the sidebar is open these controls live in the sidebar's top row (sidebar toggle at left, Back/Forward at right). When it is hidden they move into the title bar's left cell, plus a search button.
- **Centre: tabs** (§4.3). The document's name appears **only in its tab** — no second header, no repeated title bar text. The folder path is in the tab tooltip.
- **Save status** sits at the start of the right group, for the active tab: green 6px dot + "Saved" (11.5px faint); spinner + "Saving…"; red pill "Not saved · Retry" (clickable); amber pill "Changed on disk".
- **Right:** mode segmented control (Edit / Preview / Split for Markdown; Edit / Preview for code; hidden for drawings; "Open externally" button for preview-only files) · theme toggle (sun/moon) · ⋯ menu · "✦ Assistant" toggle (icon + text label) · divider · window controls.
- **Window controls:** GNOME/libadwaita style — 22px circles, `--wc` fill, 12px glyphs, 12px apart, on the right; Close turns `#C9502F` with white glyph on hover. Read the system button layout (`gtk-decoration-layout`) to honour left-side controls if configured.
- Empty areas (including the space after the last tab) are the drag region (`-webkit-app-region: drag`); double-click toggles maximise. Tabs and all buttons are `no-drag`.
- **⋯ menu:** Version history (Ctrl+Alt+H) · Show in Files · Open externally (Ctrl+Shift+O) · Copy path · — · Theme (Light/Dark segmented) · Document font (three "Aa" cards: Serif / Sans / Mono) · Accent (5 round swatches) · — · Move to Trash (Del, danger).

### 4.2 Sidebar (268px, collapsible with Ctrl+\)

- Top row: sidebar toggle + Back/Forward. Then a search field (31px, filled `--hover`, no border until focus; `Ctrl K` hint; clear × when typing).
- **Recent** (3–5 items, right-aligned relative time) and **Folders** (collapsible, chevron rotates, item counts). Section labels 11px/500 faint, not uppercase.
- Rows: 29px, 13px, 16px stroke icon per kind (doc, drawing, PDF, image, code, Word/office, audio, video, unknown). Selected row = `--sel` + 500 weight. Non-`.md` files show their extension faintly.
- Capability tags on the right of a row: **Preview** (PDF/image/office), **Play** (audio/video), **External** (unsupported). Editable files have no tag.
- Search results: flat list with folder path underneath each name. Empty state: icon, "No file names match "x"", hint, buttons "Search inside notes" and "New note "x"".
- Footer (border-top): **Trash** row with count; then vault switcher (monogram tile, vault name, "Obsidian vault · opened in place", up/down chevron), Settings, New note (+).

### 4.3 Tabs

Tabs live **inside the title bar**, between the left controls and the right action group, like modern editors — they replace a separate tab row, so the window keeps one slim header.

- **Look:** each tab is 32px tall, radius 8px 8px 0 0, 12px horizontal padding, 13px Geist, file-kind icon (16px) + name (extension faint for non-`.md`). Width 120–220px, shrinking evenly before overflowing. Inactive tabs: transparent on `--win`, text `--muted`, hover `--hover`. **Active tab:** `--surface` background with a 1px `--line` border on top/sides that joins seamlessly into the document panel below (the tab "opens into" the page). Separators between inactive tabs are 1px `--line` at 16px height, hidden next to the active or hovered tab.
- **Close & dirty:** an × appears on hover and always on the active tab; a file with unsaved changes shows a 6px dot in place of the × (dot turns into × on hover). Conflict = amber dot; save error = red dot.
- **Preview tab:** single-clicking a file in the sidebar opens it in a _preview tab_ (name in italic) that the next single click replaces; editing it, double-clicking the file, or double-clicking the tab pins it as a normal tab. Prevents tab explosion.
- **Pinned tabs:** right-click → Pin; pinned tabs collapse to icon-only (36px) at the left and can't be closed with Ctrl+W.
- **Overflow:** tabs scroll horizontally (wheel/trackpad); a `⌄` button at the end opens a searchable list of all open tabs. A `+` button opens a new untitled note (or quick-open with a modifier).
- **Interactions:** drag to reorder; middle-click closes; right-click menu: Close, Close others, Close to the right, Reopen closed tab, Pin/Unpin, Copy path, Show in Files, Add to assistant context.
- **Shortcuts:** Ctrl+T new tab/quick open · Ctrl+W close · Ctrl+Shift+T reopen closed · Ctrl+Tab / Ctrl+Shift+Tab next/previous (most-recently-used order with a small switcher overlay) · Ctrl+PageUp/PageDown by position · Ctrl+1…8 jump, Ctrl+9 last.
- **Per-tab state:** mode (Edit/Preview/Split), scroll position, cursor/selection, drawing viewport and undo history are kept per tab. Back/Forward history is per tab.
- **Persistence:** open tabs, order, pins and the active tab are restored on launch (per vault).
- **Assistant context:** the assistant's "+ Add" menu offers **"All open tabs (N)"** and each tab's right-click menu has "Add to assistant context". The context chips show tab icons so it's clear what the agent is reading.
- **Narrow windows:** below ~1100px, inactive tabs shrink to icon + truncated name; the sidebar auto-collapses before tabs become unreadable.

### 4.4 Assistant panel (384px, Ctrl+J, closed by default)

See §7.

---

## 5. Writing

### 5.1 Modes

- **Edit (source view, modelled on Claude Desktop's file viewer):** CodeMirror, JetBrainsMono Nerd Font 14px / 1.75, centred column (max ~940px), no visible border.
  - **Line-number gutter** (64px, right-aligned, `--faint` at 70%); the current line's number is full `--text` and the current line (or selected line range) gets a faint `--hover` band.
  - **Markdown syntax colouring in the source — same palette as Claude's editor, using Tailwind colours** (fixed, independent of the accent):

    | Element                                                        | Dark                                    | Light                                   |
    | -------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
    | Normal text                                                    | `text-gray-200`                         | `text-gray-800`                         |
    | Heading lines incl. `#` (bold)                                 | `text-blue-400`                         | `text-blue-700`                         |
    | `**bold**` (bold) / `*italic*` (italic)                        | `text-gray-200`                         | `text-gray-900`                         |
    | `` `inline code` `` and fenced code (no background)            | `text-emerald-400`                      | `text-emerald-700`                      |
    | List markers, numbers, task boxes `[ ]`/`[x]`                  | `text-purple-400`                       | `text-purple-600`                       |
    | Link text `[…]`, `[[wikilinks]]`                               | `text-blue-400`                         | `text-blue-700`                         |
    | Link URL `(…)`, blockquotes (italic), code fences, table pipes | `text-neutral-400`                      | `text-neutral-500`                      |
    | Line numbers / current line number                             | `text-neutral-400` / `text-neutral-100` | `text-neutral-500` / `text-neutral-900` |
    | Current-line band                                              | `bg-white/[.045]`                       | `bg-black/[.04]`                        |
    | Gutter "+" button                                              | `bg-blue-500 text-white`                | `bg-blue-600 text-white`                |

    Caret uses the normal text colour. (If the source view is built as a transparent textarea over a highlighted layer, make sure no base style like `textarea { color: inherit }` overrides the transparent text colour — otherwise the plain text paints over the colours. With CodeMirror this does not apply.)
    Soft-wrap long lines (wrapped lines keep their gutter number on the first row only).

  - **"+" on the gutter:** hovering a line, or the line with the caret, shows a small round accent "+" at the left of the gutter. Clicking it adds that line, or the selected line range, to the assistant's context as a chip ("Local-first sync.md · lines 12–14") and opens the assistant. Keyboard alternative: the footer button "+ Ask about Ln 12".
  - Footer strip (30px, 11.5px faint): "+ Ask about Ln N" (accent, left) · "Ln N" · "Markdown · UTF-8 · N words" (right).
- **Preview:** rendered document (§5.2).
- **Split:** editor left (13.5px, tighter padding) | 1px divider | live preview right, scroll-synced.
- Ctrl+E toggles Edit/Preview, Ctrl+Shift+E Split. Mode is remembered per file.
- Autosave ~800ms after typing stops, through the conflict-safe write path.

### 5.2 Markdown preview (GitHub Gist clarity, better typography)

- **Outline rail ("steps") on the left of the preview:** a column of short horizontal ticks, one per heading (h1 16px, h2 12px, h3 8px wide, indented by level, 2px tall, `--line2`), placed in the left margin about 12px from the edge and 34px from the top. The tick of the section currently in view is accent-coloured and follows scrolling. Hovering or focusing the rail expands it into a floating panel (`--raised`, border, soft shadow) listing the heading names; the current one in accent 500. Clicking a tick/name smooth-scrolls to that heading (24px offset). Hidden for documents with fewer than three headings. It also appears in Split mode's preview pane.
- Reading measure **680px**, centred, padding ~40px 56px 140px. Wide content (code blocks, tables, embedded drawings, Mermaid diagrams) may grow to **900px**, but **always starts at the same left edge as the text column** and grows to the right only (`margin-left: max(0px, (100% - 680px) / 2)`, `margin-right: 0`). Never centre wide blocks independently — every block in a document shares one left edge.
- Headings (Serif mode): Geist 600, h1 30px/1.22 (−0.018em), h2 21px (margin-top 46px), h3 17px. No underline rules under headings.
- Under h1, a meta row (Geist 13px faint): "Edited 12 min ago · 540 words · 3 min read" and tag pills.
- Lists: markers in `--faint`, 5px item spacing, nested lists indented 22px.
- **Task lists:** custom 15px rounded checkbox; checked = accent fill with white check; clicking toggles and writes `[x]` back to the file.
- Links: accent, 1px underline at 40% opacity, 3px offset; full opacity on hover. Wikilinks resolve to vault files and open in-app.
- Blockquote: 2px accent left rule, italic, muted; citation line in Geist 13px.
- Inline code: mono 0.82em on `--sel`, radius 5px.
- **Code blocks:** 1px border, radius 11px, `--code` background; 36px header with language label (bold muted), filename if known, and a **Copy** button that flips to "Copied ✓" for 1.6s; body mono 13.25px / 1.7, horizontal scroll.
- **Tables:** wrapped in a bordered, rounded, horizontally scrollable box; header row `--code` bg, 13px 500 muted; 10px/16px cells; hairline row separators.
- **Images:** `![alt](path)` and `![[image.png]]` render from the vault path, rounded 10px, centred caption (Geist 13px faint).
- **Mermaid diagrams:** fenced ` ```mermaid ` blocks render inline with mermaid.js (bundled, offline), themed from our tokens (node fill `--code`, borders `--line2`, text `--text` in Geist 13px, edges `--muted`, decision nodes tinted with the accent). The block uses the code-block frame: header with "Mermaid · <diagram type>", a **Diagram / Source** segmented toggle, **Copy** (source) and an overflow with "Export SVG/PNG". Render in a sandboxed context with `securityLevel: 'strict'`; on a syntax error, show the source with the error line highlighted and a one-line message instead of a blank box. Re-render on edit (debounced) in Split mode; follow theme changes. The file keeps the plain Mermaid text — nothing is converted. The assistant receives Mermaid blocks as source plus the rendered SVG, like drawings.
- **Embedded drawings** `![[x.excalidraw]]`: rendered SVG preview inside a bordered `--canvas` card; inside the card a bottom strip "x.excalidraw · 7 shapes, 7 connections" and, on hover/focus, an accent "✎ Edit drawing" link. Clicking opens the drawing.

---

## 6. Files & drawings

### 6.1 Capability model

| Kind          | Extensions                                  | Capability                               | Badge in file strip                      |
| ------------- | ------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Markdown      | md, markdown                                | editable                                 | —                                        |
| Drawing       | excalidraw, excalidraw.md (Obsidian plugin) | editable                                 | —                                        |
| Code/text     | ts, js, py, json, yaml, txt…                | editable as text                         | "Editable as text" (green)               |
| PDF           | pdf                                         | preview only                             | "Preview only" (accent)                  |
| Image         | png, jpg, gif, webp, svg                    | preview only                             | "Preview only"                           |
| Office        | docx, xlsx, pptx, odt…                      | preview only (rendered, never converted) | "Preview only" + "Open in LibreOffice …" |
| Audio/Video   | mp3, m4a, wav, ogg / mp4, webm, mov         | plays in app if the codec is supported   | "Plays in app"                           |
| Anything else | —                                           | unsupported                              | "Not supported" (amber)                  |

Non-Markdown files show a 44px **file strip** under the title bar: badge · type, size, dimensions/duration, "original file is never modified" · right-aligned contextual action.

### 6.2 Viewers

- **PDF:** page thumbnail rail (128px, `--win`) + centred pages on `--win`; floating pill toolbar (prev/next, "4 / 18", zoom −/100%/+, find). Strip action: "✦ Ask about this PDF".
- **Image:** centred on `--win` with a soft shadow; strip shows dimensions, size, "embedded in N notes" and "Show in <note>".
- **Office:** rendered pages on `--win`, strip action "Open in LibreOffice Writer/Calc/Impress".
- **Audio:** title (serif 24px), waveform bars (played part in accent), round accent play button, time, speed, "Open externally".
- **Video:** 16:9 player, dark control bar (play, time, scrubber, mute, fullscreen).
- **Unsupported:** centred card — file icon tile, amber "Not supported" badge, "Folio can't open .fig files", one-line explanation, **Open externally** (primary) + **Show in Files**, and a size/modified/location list.
- **No file open:** "No file open", short hint, rows: New note (Ctrl N), New drawing (Ctrl Shift N), reopen last file.

### 6.3 Drawing editor

- Real Excalidraw, themed to our tokens (canvas `--canvas`, dark mode synced, accent for selection). Hide Excalidraw's own heavy chrome where possible; keep its tool palette as a single floating pill at top centre (36px tools with key hints: V, R, D, O, A, T, image).
- Floating properties panel at top-left when something is selected; zoom (−, %, +) and undo/redo pills bottom-left; bottom-right "Embedded in <note> · Open note".
- Saves to the same `.excalidraw` file (JSON unchanged in shape) through the conflict-safe write path, and regenerates a cached SVG/PNG preview for embeds and the assistant.
- "New drawing" creates `Untitled.excalidraw` in the current folder and opens it.

---

## 7. Assistant (Claude and Codex)

### 7.1 Panel

- 384px column on `--win`, to the right of the document panel. Header row: Claude | Codex segmented switch, New chat (+), Close (×).
- **Context** section: "Context · Claude can see" followed by removable chips — the active tab's file (and selected heading/section or selected text), any drawings, any @-added files. "+ Add" chip offers files, **All open tabs (N)**, or the current selection.
- Thread: user messages right-aligned in a `--sel` bubble (radius 14/14/4/14); agent label "✦ Claude"; agent text 13.5px/1.6.
- **Activity rows** (12.5px muted, icon + text + right-aligned detail): "Searched vault for "vector clock" — 3 matches", "Read CRDT survey.pdf — pp. 4–7", "Read Sync architecture.excalidraw — 7 shapes, 7 connections". The drawing row expands into **"What Claude sees in the drawing"**: rendered thumbnail + "7 shapes · 7 connections · rendered PNG attached" + a list like `Editor → Change log "append"`.
- Composer at bottom: rounded 14px box, placeholder "Ask, or type @ to add a file", @ button, hint "Reads the vault · proposes changes", round accent send button (disabled when empty).
- Empty state: "Ask about this vault", explanation that the agent only sees Context and that changes are proposals, three suggestion buttons.

### 7.2 Proposals (cards)

Each card: header with a small uppercase verb chip (**Update** accent / **Create** green / **Delete** red), file path, and a summary (`+5 −1`, line count); body; footer with actions.

- **Update:** unified diff in mono 12px — hunk headers faint, removed lines on `--del`, added lines on `--add`. Footer: Reject · **Accept** (primary). After: "✓ Applied · saved as a version" + Undo; or "Rejected — note unchanged" + Undo. Accepting writes through the conflict-safe path and the preview shows the new block briefly highlighted on `--add`.
- **Create:** one-line description; Skip · **Create file**; after: "✓ Created in Reading" + Open. New file appears in the sidebar.
- **Delete:** reason + "moves to Trash and can be restored for 30 days"; Keep file · **Move to Trash**; after: "In Trash" + Restore.

### 7.3 Agent integration

- Implement a local tool layer the agents call: `search(query)`, `read(path, range?)`, `read_drawing(path)` → `{ shapes:[{id,type,label}], connections:[{from,to,label}], png }`, `propose_update(path, base_hash, patch)`, `propose_create(path, content)`, `propose_delete(path, reason)`.
- Proposals carry the `base_hash` they were made against; if the file changed since, show the conflict UI instead of applying.
- Claude via the Anthropic API (user-supplied key or Claude Code CLI); Codex via the Codex CLI. Both behind one interface. Nothing writes without the user's click.

### 7.4 Version history (⋯ → Version history)

Right-hand floating drawer (320px) over the document: list of versions (dot, time, author: "You", "Claude's edit", "External change · git pull"); "Current" tag on the latest; **Restore** on others; footer "Restoring saves the current version first, so every step can be undone."

### 7.5 External change conflict

When the watcher sees a disk change while the editor holds unsaved edits (or a proposal's base hash is stale):

- Title bar status → amber "Changed on disk".
- Amber banner at the top of the document: "This file changed on disk while you had unsaved edits" + who/what/when ("Another program (git pull) rewrote the file 40 seconds ago. Nothing was overwritten…").
- Actions: **Compare** (toggles a two-column view: "Yours · unsaved" vs "On disk · changed 40 s ago", changed lines highlighted) · **Keep both** (primary; merges both versions, marks for review) · Keep mine · Use disk version. Whichever version is not kept goes into history. Toast with Undo.
- If there are no local edits, reload silently and show a quiet toast.

### 7.6 Other states

- **Saving / saved / error:** title bar status as above. On write failure, red banner: "Couldn't save X.md — The vault folder is read-only right now (permission denied). Your edits are kept in this window, and nothing on disk was changed." Retry (primary) · Save a copy… · Show details.
- **Toasts:** bottom-centre of the document panel, inverted colours (`--text` bg), 40px, optional action (Undo/Open), auto-dismiss 4.5s.
- **Trash view:** title, explanation of `.trash/` and 30 days, list with who deleted and when, Restore per item, "Empty trash…" (danger, confirms).
- Hover: `--hover` fill; selected: `--sel`; focus: visible 2px accent ring on every interactive element; disabled: 38% opacity.

---

## 8. Keyboard

Ctrl+K quick open/search · Ctrl+T new tab · Ctrl+W close tab · Ctrl+Shift+T reopen tab · Ctrl+Tab switch tab · Ctrl+1…9 jump to tab · Ctrl+\ sidebar · Ctrl+J assistant · Ctrl+E edit/preview · Ctrl+Shift+E split · Ctrl+N new note · Ctrl+Shift+N new drawing · Alt+←/→ back/forward · Ctrl+Alt+H history · Ctrl+Shift+O open externally · Del move to trash (with undo toast) · Ctrl+, settings. In drawings: Excalidraw's defaults. Full Tab navigation; every icon-only button has an `aria-label` and tooltip with its shortcut.

## 9. Settings (Settings › Appearance)

Theme (Light / Dark / System) · Accent (5 swatches) · Document font (Serif / Sans / Mono cards) · Editor font size · Reading width (Narrow 600 / Default 680 / Wide 780). Persist per user, apply instantly.

## 10. Build order

0. Electron + electron-vite + React + Tailwind v4 scaffold under Vite+ (`vp install`, `vp check`, `vp test` all pass); electron-builder produces a `.deb` and `.AppImage` that install on Ubuntu, launch from the app grid and open an empty frameless window.
1. Custom title bar with GNOME controls, drag region and **tabs**, sidebar + inset document panel, both themes, accent and font settings.
2. Open a folder; file tree, recent, search; capability detection.
3. Markdown preview with all formatting in §5.2; then CodeMirror editor, Split, autosave.
4. Conflict-safe write path, file watcher, version history, trash.
5. Excalidraw editor + embed previews.
6. PDF / image / office / media viewers and unsupported state.
7. Assistant panel, tool layer, proposals with diff, Claude + Codex backends.

## 11. Acceptance checks

- `sudo apt install ./folio_*.deb` installs it; Folio appears in the GNOME app grid, launches without a terminal or browser, and works with networking disabled.
- Double-clicking a `.md` file in the file manager (Open with Folio) opens it as a new tab in the running window.
- Closing and relaunching restores the same tabs, order, pins, modes and scroll positions.
- `vp check` and `vp test` pass in CI; the renderer has no Node access (contextIsolation + sandbox verified).
- Opening an existing Obsidian vault changes no files and creates only `.folio/` (and `.trash/` on first delete).
- Editing a file in another app while it has unsaved edits in Folio never loses either version.
- An agent cannot write without a click; every accepted change appears in history and can be undone.
- Light and dark themes pass WCAG AA contrast for all text (including 11px labels).
- The window looks correct at 1100×700 and at full screen; the sidebar and assistant collapse cleanly.
