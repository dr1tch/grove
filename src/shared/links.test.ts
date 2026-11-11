import { it, expect } from "vite-plus/test";
import { parseLinks, renameReferences } from "./links";
it("finds real Markdown/wiki/definition links while excluding code", () => {
  const text =
    '[one](../assets/a%20b.png#part)\n![[Target|Label]]\n`[[Fake]]`\n\n```md\n[x](fake.md)\n```\n\n[ref]: <Target.md> "Title"\n';
  const links = parseLinks("notes/n.md", text, ["assets/a b.png", "notes/Target.md"]);
  expect(links.map((l) => l.targetPath)).toEqual([
    "assets/a b.png",
    "notes/Target.md",
    "notes/Target.md",
  ]);
  expect(links.every((l) => text.slice(l.from, l.to) === l.raw)).toBe(true);
});
it("rewrites destinations and moved-source relative links without touching code or labels", () => {
  const text = "[Keep label](../assets/a.png)\n`[ignore](../assets/a.png)`";
  expect(renameReferences("notes/n.md", text, ["assets/a.png"], "assets", "media")).toBe(
    "[Keep label](../media/a.png)\n`[ignore](../assets/a.png)`",
  );
  expect(renameReferences("notes/n.md", text, ["assets/a.png"], "notes", "archive/notes")).toBe(
    "[Keep label](../../assets/a.png)\n`[ignore](../assets/a.png)`",
  );
});
