import { it, expect } from "vite-plus/test";
import { rankFiles } from "./file-search";
const entries = ["notes/Test.md", "code/testing.ts", "other/tasty.md", "ÉTÉ.md"].map((path) => ({
  path,
  name: path.split("/").pop()!,
  kind: "text" as const,
  size: 0,
  modified: 0,
}));
it("ranks exact stem, substring and subsequence with stable matching ranges", () => {
  expect(rankFiles("test", entries, []).map((r) => r.path)).toEqual([
    "notes/Test.md",
    "code/testing.ts",
    "other/tasty.md",
  ]);
  expect(rankFiles("tst", entries, [])[0].path).toBe("notes/Test.md");
  expect(rankFiles("été", entries, [])[0].path).toBe("ÉTÉ.md");
});
it("shows only valid recents for empty queries and ignores folders", () => {
  expect(rankFiles("", entries, ["gone", "ÉTÉ.md", "notes/Test.md"]).map((r) => r.path)).toEqual([
    "ÉTÉ.md",
    "notes/Test.md",
  ]);
});
