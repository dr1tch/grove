# Folio 0.2.0 verification

The requested workspace and preview improvements are implemented. Source changes remain unstaged and uncommitted.

1. `vp check` passes formatting, lint and types. All 43 tests pass, covering file capability detection, CSV quoting, persistent settings, recovery guards, folder and binary trash, rename collisions and history migration. Deterministic save race checks pass.
2. Native QA passes 12 checks for bounded outline text, full reading width, installed fonts, sidebar resizing, tab actions, empty folder creation, file rename, CSV tables, formatted coloured Vue/TypeScript, unknown UTF-8 text and Mermaid zoom. F11 toggles the native full-screen state true then false. Drag regions and movable/resizable flags are verified; actual compositor movement is not measurable under Xvfb without a window manager.
3. Word DOCX, Excel XLSX and PowerPoint PPTX fixture files render in Folio through the isolated LibreOffice converter. Source files are copied and never converted in place. Separate native feature checks pass conflict keep-both, drawing opening unchanged, real drawing edits and PDF rendering.
4. The packaged executable passes native smoke checks for launch, bridge isolation preferences, preview task changes, theme switching, autosave and settings. The deb and AppImage build successfully. LibreOffice Writer, Calc and Impress are installed; the deb depends on fontconfig and recommends those document readers.
5. Arbitrary proprietary or malformed binary formats are not guaranteed to render. Unsupported formats retain Open externally. Only valid UTF-8 text is editable; Office files are read-only previews. Real assistant service calls remain untested.

Screenshots are in `qa-artifacts/improvements/`. The native UI scripts use temporary profiles and vaults. Playwright adds no-sandbox for automation; installed launch previously verified the renderer sandbox without that flag.

Review fixes include origin-vault identity on pending actions, tab identity on delayed reads, preservation of closed recovery drafts, extensionless conflict-copy naming and migration of version history when a file or folder is renamed. History migration uses a retained journal and serialized metadata operations so a failed update can recover on the next operation.
