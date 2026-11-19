# Formatted Preview Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Type into fully formatted notes in Preview and into formatted embedded Markdown inline, without a popup or exposing Markdown syntax while typing.

**Architecture:** Use Tiptap/ProseMirror for the editable Preview, retaining CodeMirror for source Edit/Split. Preserve original source for unchanged top-level nodes instead of serializing the entire note. Opaque/custom nodes preserve fenced code, diagrams, wiki references, HTML and unsupported source; embedded Markdown gets a nested formatted editor and other code gets an inline source editor. Route changes through the existing App change/save/recovery/conflict path. No account, server, installation or Git publishing work is included.

**Tech Stack:** React, Tiptap 3.34.0 core/react/starter-kit/markdown, GFM task/table extensions, existing mdast parser, CodeMirror, existing preview/media components and controls. Markdown extension is beta, so source preservation and round-trip tests are mandatory.

## Review Focus

1. Unchanged Markdown bytes, comments, frontmatter, reference definitions and unsupported constructs survive editing another paragraph.
2. Duplicate source IDs after splits/paste, identical blocks and edits/deletions/reordering cannot target the wrong original section.
3. Typing, composition, selection, undo/redo and paste retain formatting; the rich editor does not reset on its own source echo.
4. Embedded editor events never type into the parent document; nested fullscreen and normal saving/recovery stay usable.
5. No untrusted HTML, remote resource or executable URL becomes active through parsing, paste or node views.

## Task 1: Source-preserving rich Markdown model

Files: new `src/renderer/rich-markdown.ts` and `src/shared/rich-markdown.test.ts`; root/web manifests and lockfile. Own Markdown schema, immutable original-node snapshots and serialization. Use original AST ranges plus unique node IDs to retain exact untouched source and separators. Changed nodes serialize through the Markdown schema; unsupported nodes serialize verbatim. Custom fenced nodes lengthen delimiters safely. Wiki nodes preserve their original syntax.

- [x] Write failing tests for exact untouched round trips, paragraph-only changes, duplicate blocks, inserted/deleted nodes, CRLF, comments/properties, wiki/image/link syntax, fences and hostile input.
- [x] Install pinned rich-editor dependencies in root and web workspaces.
- [x] Implement model and custom protected nodes; verify the tests and isolated package types.

## Task 2: Editable note Preview

Files: new `src/renderer/RichPreview.tsx`, `DocumentPane.tsx`, `styles.css`. Own rich editor lifecycle and node views. Preview stays visually formatted while typing. Reuse existing assets and protected block rendering. Own changes immediately use App's normal change callback; local echoes do not reset the editor or history. External changes follow existing conflict behavior. Keep source Edit/Split available and preserve per-pane view controls.

- [x] Add browser QA that clicks a rendered heading/paragraph, types, formats/undoes, pastes, saves/reloads and checks unchanged surrounding bytes.
- [x] Implement the rich Preview and verify desktop/web behavior with synthetic notes only.

## Task 3: Inline embedded editing

Files: rich code node view, existing code rendering extraction only as needed, `CodeBlockDialog.tsx` callers, `Markdown.tsx`, `ExportDocument.tsx`. A Markdown fence renders a nested formatted editor in place. Edit reveals an inline source editor for code; Preview returns to formatted Markdown or highlighted source. Reuse ViewControls and CodeMirror. Changes update only the code node and feed normal saving, with no detached local popup draft.

- [x] Add QA for direct formatted typing in Markdown embeds, inline code changes, duplicate fences, nested events/fullscreen, cancel/undo where applicable, saving/reload and export control removal.
- [x] Implement and verify against isolated desktop and simulated web repository fixtures.

## Task 4: Verification and handoff

- [x] Run meaningful core/source-preservation tests, full suite, types, Vite+ checks and desktop/web builds.
- [x] Run real desktop/web UI QA, including selection, safe paste, Unicode input, links, outline navigation, long nested typing, Split scroll preservation and ordinary source-editor regressions. Hardware IME input and hosted account/database integration remain untested. Export retains the separate static Markdown renderer.
- [x] Request fresh focused code review, fix Important findings with regression tests and update CHANGELOG/handoff. Leave changes unstaged and uncommitted. Existing Grove 0.5.3 installation remains unchanged until a new install request.
