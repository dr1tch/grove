import { it, expect } from "vite-plus/test";
import { folderStyle, entryPath, suggestedName } from "./tree";
it("recognizes conventional folder categories independently of case", () => {
  expect(folderStyle("app/src")).toBe("code");
  expect(folderStyle("Documents")).toBe("docs");
  expect(folderStyle("Research")).toBe("docs");
  expect(folderStyle("Notes")).toBe("notes");
  expect(folderStyle("photos")).toBe("images");
  expect(folderStyle("My folder")).toBe("default");
});
it("creates notes in selected folder without changing explicit file types", () => {
  expect(entryPath("Projects", "Idea", "file")).toBe("Projects/Idea.md");
  expect(entryPath("src", "App.vue", "file")).toBe("src/App.vue");
  expect(entryPath("", "New folder", "folder")).toBe("New folder");
  for (const name of ["../escape", "a/b", ".folio", ""])
    expect(() => entryPath("", name, "file")).toThrow();
});
it("suggests collision-free names", () => {
  const entries = [
    {
      path: "Notes/Untitled.md",
      name: "Untitled.md",
      kind: "markdown" as const,
      size: 0,
      modified: 0,
    },
  ];
  expect(suggestedName(entries, "Notes", "file")).toBe("Untitled 1.md");
  expect(suggestedName(entries, "", "file", true)).toBe("Untitled.excalidraw");
});
