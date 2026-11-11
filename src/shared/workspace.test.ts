import { it, expect } from "vite-plus/test";
import { conflictCopyPath, draftMoves } from "./workspace";
it("names conflict copies of extensionless files and dotted directories", () => {
  expect(conflictCopyPath("README", 1)).toBe("README (conflict 1)");
  expect(conflictCopyPath("folder.v2/README", 1)).toBe("folder.v2/README (conflict 1)");
  expect(conflictCopyPath("a/note.md", 1)).toBe("a/note (conflict 1).md");
});
it("finds closed drafts in renamed folders and excludes other vaults", () => {
  const map = new Map([
    ["folio:draft:A:folder/closed.md", "closed"],
    ["folio:draft:A:folder/nested/open.md", "open"],
    ["folio:draft:B:folder/closed.md", "other"],
    ["folio:draft:A:folder2/no.md", "unrelated"],
  ]);
  const storage = {
    length: map.size,
    key: (i: number) => [...map.keys()][i],
    getItem: (k: string) => map.get(k) ?? null,
  };
  expect(draftMoves(storage, "A", "folder", "new").map((m) => m.newKey)).toEqual([
    "folio:draft:A:new/closed.md",
    "folio:draft:A:new/nested/open.md",
  ]);
});
