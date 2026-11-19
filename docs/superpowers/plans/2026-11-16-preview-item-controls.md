# Preview item controls implementation plan

Subsequent explicit request: package and install the update, then remove the prior installers. Completed as0.5.6 after packaged/installed item QA and installed Live Preview QA passed. Removed only release/folio_0.5.5_amd64.deb and release/Grove-0.5.5.AppImage. No Git or publishing operation was performed.

> For agentic workers: use superpowers:executing-plans inline, with one fresh focused review at the end. Do not commit, install or publish.

**Goal:** Directly edit the Markdown items Grove already supports in Formatted and Live Preview on desktop and web, including table structure, links, images/attachments, lists, quotes, code, diagrams and protected source blocks.

**Architecture:** Keep existing Tiptap extensions and CodeMirror ownership. Expose existing table/list commands through contextual controls. Reuse RichPreview inside Live table widgets so cells and structure edit without reverting to pipe syntax. Shared reference parsing/formatting and a small dialog handle Markdown links, wiki references and media properties. Source/raw edits remain literal and never execute HTML. Existing save, recovery and source-provenance guards remain authoritative.

**Tech stack:** Installed React, Tiptap TableKit/Link/TaskList, CodeMirror, mdast and Lucide. No new dependencies.

**Spec:** User request in this session: inspect Obsidian item editing, add rows/columns and link editing, then cover all existing Markdown items in both Preview styles. UI follows Grove's icons/components; the goal is editing behavior, not an exact Obsidian chrome clone.

**User correction:** Preserve Grove's old appearance. The first permanent control bars were rejected. Actions now live in right-click menus using Grove's existing menu styles; no new always-visible action rows. Native installed Obsidian was inspected both in isolated captures and a visible desktop sample window.

**Completed:** All four tasks implemented and checked.208 tests pass,10 database cases skipped; desktop/browser item flows and existing preview regressions pass. Focused review fixes include source replacement closing stale table menus, synchronously acknowledged rapid Live cell writes, canonical table fragments and preserved nested/global undo. No install or Git operation performed. Row/column move/duplicate/sort and typed Properties values remain outside this implementation; source editing remains available.

## Constraints

- Plain Markdown remains the stored format; table operations must survive Markdown round trips. Keep an editable source escape hatch for every rendered block.
- Dialogs and node edits must reject stale documents/nodes and preserve unrelated source and duplicates. Remove actions remove a note item, never its underlying vault file.
- Preserve independent pane/editor histories, live widget ownership guards, CRLF and normal browser focus outside editing controls.
- Use isolated synthetic vaults/profiles for native QA and fake GitHub for browser QA. Never touch normal Grove/Obsidian windows or private notes.

## Tasks

1. Add tested reference parsing/serialization and a shared reference dialog. Support label/alt, address, optional title, wiki syntax and removal. Extend Editor's link action to edit an existing reference or insert one, guarding the source snapshot. Test escaping, code literals, reference definitions and malicious protocols.
2. Add contextual Tiptap table and list controls. Tables support insertion, row/column insertion/deletion, column alignment and table deletion; keep header semantics compatible with Markdown. Links expose editing/removal through the existing selection and improved dialog. Reuse native commands and preserve selection when clicking controls. Test table structural round trips and links with preserved neighboring source.
3. Complete block controls in existing rich node views: reference properties/replace/remove, protected block source editing/removal, and code/diagram source/language/removal. Live tables use RichPreview widgets; media widgets reuse the same item actions, and widget mouse handling respects nested editors. Test stale callback rejection, duplicate targeting, edits/undo and outside-source preservation.
4. Verify desktop and fake-GitHub browser item flows, formatted/live regressions, viewport controls and typing performance. Request one focused review, fix material findings, update docs and leave changes uncommitted and uninstalled.

## Verification

- Unit: reference syntax, safe serialization, Markdown table structure and source provenance.
- Native/browser: add/delete rows and columns, type cells, Tab navigation, align columns, edit/unlink labels and addresses, media properties/removal without deleting files, code/diagram/properties source edits, undo/redo, save/reload, stale source replacement and duplicate isolation in both styles.
- Re-run existing spacing/list, formatted editing and document-view QA; input p95 below50ms on the existing51KB/1000file fixture.

## Reference

- Obsidian tables: https://obsidian.md/help/Editing%2Band%2Bformatting/Advanced%2Bformatting%2Bsyntax
- Installed Tiptap TableKit owns structure/alignment commands: https://tiptap.dev/docs/editor/extensions/nodes/table
