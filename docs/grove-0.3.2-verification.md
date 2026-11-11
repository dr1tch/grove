# Grove 0.3.2

The sidebar retains vertical scrolling and prevents horizontal overflow. File and folder labels shrink with ellipsis inside the current sidebar width, including nested folders.

One shared tooltip component displays full file/folder paths and workspace/tab names on pointer hover and keyboard focus. It uses a native manual popover with role=tooltip and aria-describedby, not a title attribute. The tooltip is outside clipped sidebar containers, remains within the window, allows pointer movement onto its text, and closes on Escape, outside clicks, scrolling or pointer departure. Toolbar Button hints use the same component.

All 48 tests pass, along with formatting, lint and type checks. The native sidebar check uses long names and a narrow sidebar, confirms scrollWidth does not exceed clientWidth, verifies vertical scrolling, complete tooltip text, focus behaviour, dismissal and absence of title attributes on file/folder rows. Screenshots are saved under `qa-artifacts/sidebar/`.

Package identity, local files and the existing profile are unchanged. Changes remain unstaged and uncommitted.
