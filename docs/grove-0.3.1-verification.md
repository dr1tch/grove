# Grove 0.3.1

1. File icons distinguish Vue, JavaScript, TypeScript, React, Markdown, JSON, CSV, Office files, PDF, drawings and media. The same component is used in the tree, recent files, tabs and assistant context.
2. Expanded diagrams use a native modal. The header is explicitly excluded from native dragging and double-click events are contained. Tall diagrams start at scroll position zero, align from the top and retain their natural scale instead of stretching a narrow diagram across the window.
3. Markdown rendering stays mounted while the outline tracks scrolling. This prevents copy, zoom and expanded state from resetting when the current heading changes.
4. Copy uses a validated main-process Electron clipboard operation. The button shows an animated check and Copied state, respects reduced-motion preferences and provides a retry state on failure. Code blocks, diagrams, code-file previews and path-copy actions use the native clipboard route.
5. Expanded diagrams, settings, rename, history, trash and menus dismiss outside. Escape also dismisses application menus. New files open in preview, and an adjacent plus button is part of the tab strip.

All 48 tests pass. Native UI checks verify file icons, a tall diagram's initial node position, unchanged window bounds after header and Copy double-clicks, exact clipboard source with Copied feedback, outside dismissal, the tab-strip plus button and new-note preview mode. Screenshots are under `qa-artifacts/popups/`. Desktop compositor behaviour is tested through non-draggable regions and native window state in Xvfb; the user's live window is not interrupted.

The changes remain unstaged and uncommitted. Package identity and the user profile are unchanged.
