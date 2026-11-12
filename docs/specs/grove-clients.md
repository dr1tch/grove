# Grove phone, web and landing page

Status: ready for implementation planning, 2026-11-12. This updates the phone/browser portion of [sync and plugins](grove-sync-plugins.md). The desktop toolbar is implemented separately in the current working tree. No client or deployment work is authorized by merely reading this spec.

## Product and architecture

Grove keeps notes, drawings and attachments in a plain folder. A private GitHub repository connects the desktop, browser and phone. There is no Grove-hosted application server or mandatory Grove account.

Use pnpm workspaces. Keep the Electron app, its package identity `folio`, installed profiles, resources and QA entry points at the repository root. Add `apps/mobile` for an Expo/React Native Android and iOS app, `apps/web` for the existing React renderer with a browser bridge, and `apps/landing` for a static React/Vite marketing site. Share pure domain code in `packages/core` and the browser/phone GitHub vault implementation in `packages/github-vault`. This is an implementation choice that preserves the working desktop app while giving each new app its own dependencies and commands.

The native phone shell owns navigation, search, dialogs, toolbar and device integration. A bundled, isolated WebView can host the existing CodeMirror engine and complex document rendering. This is a document surface inside a React Native application, not the full browser app running inside a WebView. Verify keyboard integration and offline assets on real Android and iOS before expanding this approach. Never load user-provided executable HTML, remote editor scripts or credentials into that surface.

## Agreed phone behavior

1. One document at a time. No document tabs, tab strip or Open tabs button. Files, Recent and Search switch documents. The Files screen has a 56 px floating circular emerald plus button at the lower right, with a 24 px Plus icon, sufficient safe-area padding and an accessible New note label.
2. New note opens an Untitled draft immediately. Its first heading proposes the filename. First Save, or leaving an edited new draft, asks for name and folder with Save, Cancel and Discard. Drafts are recoverable locally but are not uploaded as vault files before Save.
3. Read and Edit modes. The GitHub-style Markdown toolbar sits above the keyboard, with 44 px targets, a scrolling formatting group and a fixed Insert paperclip. It preserves selection and editor history. The desktop and browser get the full row above the Markdown source editor in Edit and Split modes.
4. Insert from vault searches existing content. Media, PDFs and drawings offer Embed or Link without creating duplicate files. Select a saved Markdown note to reuse an existing Mermaid diagram/chart as editable source or link its note. Copied source is independent of the original. Whole-note transclusion and a new chart builder are outside this version.
5. Conflicts compare whole file versions stacked vertically. Keep both files is the safe primary action; Keep mine and Use GitHub version require deliberate choices. Offline conflicts preserve both texts in separate files, not merged blocks.

Reading uses comfortable note widths. PDFs fill the note width at page proportions. Videos use their available width and natural proportions, with seek, skip, speed and fullscreen controls. Audio uses a compact player. Drawings have a view-only phone canvas with pinch, pan and Fit. Diagrams have no decorative shadow. Native preview and player behavior must be verified, not inferred from mockups.

## Browser behavior

Reuse the desktop renderer, tabs, two panes, formatting toolbar and vault picker. At narrow widths show one document pane with a file drawer and touch-sized controls; do not reproduce desktop window chrome. Office conversion, local CLI assistants, native PDF export and external-app launch stay desktop-only. Reject unsupported API calls with a clear message and hide irrelevant primary controls. Browser print is available as a browser action.

Cache opened files and the app shell for offline use. A service worker covers only this app's static assets, never GitHub API traffic or credential data. At the project Pages URL, app routes and assets must work below `/grove/app/` as well as in local preview.

## Shared sync and data safety

One vault is one GitHub repository and branch. A fine-grained token needs Contents read/write on that repository. Browser credentials stay in that browser; native credentials use Expo SecureStore. Send a token only to `https://api.github.com`, never to the landing page, WebView, telemetry, logs or source files. Sign out removes credentials; unsynced work must remain recoverable and must not be silently discarded.

Writes use the last remote blob SHA. A mismatch preserves the editor and offers comparison. Commit messages retain `Grove: <device> <ISO time>`, with browser and phone device names. Never force-update a ref, rewrite history, overwrite an existing conflict copy, or upload more than the desktop's 50 MiB file limit. Preserve paths with spaces, punctuation and Unicode. Keep metadata/Trash/recovery files out of the synced content list.

Use the recursive tree API, SHA-keyed blob caching and bounded reads. A truncated GitHub tree must not silently hide files. Native SQLite and browser IndexedDB provide durable caches and pending edits. Each queued path keeps its original remote base SHA and newest local content. An acknowledgement can remove only the exact queue revision it sent. Edits made while a flush is in flight remain queued. Persist an offline edit before reporting it saved locally; never report it synced before GitHub accepts it.

## Visual source and branding

The agreed review set is [the local design gallery](/home/dr1tch/Downloads/Grove-designs-2026-11-12/index.html), with its README and manifest. It contains current Files, PDF reading, draft/editor, first-save sheet, conflict, drawing, audio/video, insert picker, landing page and desktop toolbar states. Earlier variants with phone tabs or a full-width New note button are superseded. Treat the prose here and real desktop components as authoritative when generated pixels differ.

The original logo proposals are `~/Downloads/grove-logo.svg`, `grove-logo-small.svg` and `grove-mark.svg`, also copied into that gallery's `logos/` directory. Use the simplified icon at small sizes and standalone mark on light backgrounds. Keep the exact vector sources. The gallery does not authorize replacing installed desktop icons.

Reuse the desktop file/folder icon semantics from `src/shared/file-icons.ts` and `src/shared/tree.ts`. Markdown is blue, drawings purple, PDF red, images pink, audio purple and video orange. Keep semantic folder badges and Lucide controls. Use warm ivory/white light surfaces, warm charcoal dark surfaces, emerald accents, Geist UI, Source Serif reading and JetBrains Mono source text.

## Landing page and delivery

Follow the supplied editorial landing layout: serif hero with green italic second line, real product screenshot, three promises, GitHub sync explanation, supported formats, dark upcoming-phone section, FAQ and download CTA. Use current product capabilities; no fake social proof, placeholder version strings, live phone-download claims or promises of block merging, direct peer sync or fixed Trash retention.

The landing page lives at `/grove/`; the browser app lives at `/grove/app/`. Preserve APT metadata, signing key and `pool/` in the same Pages artifact. Publishing, store submission, tags, commits and pushes require a separate current user request. Android/iOS signing and real-device verification are explicit delivery gates, not claims a Linux-only build can prove.
