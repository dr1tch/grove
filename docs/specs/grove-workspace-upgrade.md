# Grove workspace upgrade

Status: implementation started, November 11, 2026. Current installed baseline: Grove 0.3.10. Tasks 1 through 10 are implemented in the 0.4.0 source build. Final verification and release evidence is recorded in the progress file.

## Requested scope

1. Drag to pan zoomed images and videos; double-click the media to return to Fit to window.
2. Search note, code and PDF contents with highlighted results and navigation to each match.
3. Quick file switcher with recent files, fuzzy path matching and keyboard navigation.
4. Backlinks, broken-link checks and safe link updates when renaming files or folders.
5. Two independent document panes, for example a PDF beside an editable note.
6. Paste screenshots into Markdown notes as saved attachments and inline images.
7. Clear external-change comparison and safe recovery from history.
8. Named workspace presets containing folders, tabs and pane layout.
9. Export a note and its images/diagrams to PDF or a self-contained HTML file.
10. Drop files into notes: inline images; embedded PDF, video and audio; clickable links for other files. Link existing vault files without duplication. Copy external files into a folder beside the note without modifying the source. Handle duplicate names and undo the note insertion.
11. HTML and genuine XHTML source editing with a rendered preview beside the source.

Duplicate requests are merged. Previously suggested persistent reading position is included as a workspace foundation. New AI editing features are outside this upgrade; existing proposal safety must remain intact.

## Product decisions proposed by this plan

Attachments live in `<note-directory>/attachments/`. Existing vault files use relative links, external files are copied, and exact name collisions gain a numeric suffix without overwriting. Undo removes the inserted note content, not the attachment file, because another note may already reference it. Unreferenced files can be listed later; automatic deletion is excluded.

Two document panes are the initial limit. Each pane can independently use source, preview or source/preview split. Workspace presets reference files in one vault; they never copy file contents or carry credentials.

HTML preview is offline and sandboxed. It displays HTML/CSS and local images, but cannot execute scripts, submit forms, navigate the app, contact remote hosts or access the preload bridge. Missing remote resources are explained in the preview UI. A PDF with an HTML-like filename continues to use content detection and the PDF viewer.

Existing strict UTF-8 editing, version history, conflict detection, recoverable Trash, confined filesystem access, renderer isolation and explicit vault scope are mandatory. Features remain local and originals remain portable.
