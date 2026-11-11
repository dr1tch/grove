# Grove 0.3.0

The existing Folio package is upgraded in place to Grove. The launcher name and custom leaf icon change; the package ID, desktop entry ID, vault format and existing user profile remain compatible. The old running window is not stopped by the installer.

1. All 46 tests pass. Formatting, lint and TypeScript checks pass. New tests cover folder categories, safe inline names and collision-free suggestions.
2. Native QA verifies category icons, centered settings with side navigation and Escape, preview preservation when opening a new tab, icon-only pinned tabs, inline file/folder creation in the selected folder, cancellation and duplicate-name protection. Screenshots are in `qa-artifacts/grove/`.
3. The packaged executable passes the native smoke test for Markdown preview, editing/autosave, themes and settings. The deb and AppImage build successfully; the deb is installed as version 0.3.0, with Name=Grove and the executable at `/opt/Grove/folio`.
4. Grove's icon uses a 512px canvas with visible bounds (40,46)-(472,476), matching the normalized visible footprint of the installed Claude Desktop 256px icon at (20,23)-(236,238). The artwork is an original vector-style leaf mark, not the Claude logo.
5. New file creation defaults to Markdown unless an explicit extension is supplied. Existing files are never overwritten by inline creation. Office, media and assistant limitations from the previous version remain unchanged.

Changes remain unstaged and uncommitted. The user can close the existing Folio window and open Grove from the application menu to load the update.
