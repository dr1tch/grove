import { expect, it } from "vite-plus/test";
import { cleanLayout, renameLayout, pruneLayout } from "./panes";
it("migrates old tabs and clamps invalid persisted positions", () => {
  const layout = cleanLayout(null, [{ path: "note.md", mode: "edit", pinned: true }], "note.md");
  expect(layout.panes[0].tabs).toEqual(["note.md"]);
  expect(layout.panes[0].views["note.md"].mode).toBe("edit");
  const dirty = cleanLayout({
    panes: [
      {
        id: "a",
        tabs: ["x"],
        active: "x",
        views: {
          x: {
            editorScroll: -5,
            previewScroll: Infinity,
            page: -2,
            media: { fit: false, scale: 999, scrollLeft: -1, scrollTop: 8 },
          },
        },
      },
    ],
    splitRatio: 9,
  });
  expect(dirty.splitRatio).toBe(0.75);
  expect(dirty.panes[0].views.x.editorScroll).toBe(0);
  expect(dirty.panes[0].views.x.page).toBe(1);
  expect(dirty.panes[0].views.x.media?.scale).toBe(20);
});
it("renames both pane references and prunes missing paths without losing valid view state", () => {
  const layout = cleanLayout({
    panes: [
      {
        id: "a",
        tabs: ["folder/n.md", "gone"],
        active: "folder/n.md",
        views: { "folder/n.md": { mode: "edit", editorScroll: 23 } },
      },
      { id: "b", tabs: ["folder/n.md"], active: "folder/n.md" },
    ],
  });
  const moved = renameLayout(layout, "folder", "renamed");
  expect(moved.panes[1].active).toBe("renamed/n.md");
  const result = pruneLayout(moved, ["renamed/n.md"]);
  expect(result.panes[0].tabs).toEqual(["renamed/n.md"]);
  expect(result.panes[0].views["renamed/n.md"].editorScroll).toBe(23);
});
