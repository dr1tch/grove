# Obsidian-style Live Preview

After implementation, the user explicitly requested installation. Version 0.5.5 was packaged, tested and installed locally, with installed Live Preview QA passing in a temporary profile. The normal window/profile remains untouched. No Git or public publishing operation is authorized.

The user chose to reveal Markdown syntax where they edit, with the rest formatted. Add a second Preview style; preserve the installed formatted editor and all save/recovery behavior. Work in the current checkout, do not install, commit or publish.

1. Implement a CodeMirror decoration extension using its incremental Markdown syntax tree. Keep active lines as source; hide inactive formatting delimiters and style headings, emphasis, links, lists, quotes and inline code. Inactive code fences, tables, media and properties use reusable preview widgets; entering their source reveals the enclosing block. HTML stays escaped. Use native document positions and verify stale widget writes. Test source preservation, selection transitions, escaped syntax, code boundaries and widgets.
2. Reuse Editor and existing Markdown/Diagram/CodeBlock renderers through a LiveNote component. Add a Preview style picker shared by both preview styles; persist the optional formatted/live preference with a formatted fallback. Keep separate live/source editor cache keys and scroll positions. Preserve CRLF in LiveNote boundaries. No new dependencies.
3. Verify desktop and browser behavior: select style, click/arrow between lines, type, format, undo, duplicate task/fence edits, safe HTML, code/table/media source reveal, save/reload and style persistence. Measure the 51 KB / 1,000-file fixture and keep input p95 below50ms. Retain existing formatted mode checks.
4. Request one focused review, fix findings, update docs and leave the installed0.5.4/profile untouched. Unsupported Obsidian plugins and exact UI cloning are outside scope.
