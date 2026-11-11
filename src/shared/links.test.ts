import { describe, it, expect } from "vite-plus/test";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { parseLinks, renameReferences, wikiToMarkdown } from "./links";
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
describe("wikiToMarkdown", () => {
  const firstLink = (markdown: string) => {
    const found: Nodes[] = [];
    const walk = (node: Nodes) => {
      if (node.type === "link" || node.type === "image") found.push(node);
      if ("children" in node) node.children.forEach(walk);
    };
    walk(fromMarkdown(markdown));
    return found[0] as { type: string; url: string } | undefined;
  };
  it("turns embeds and links with spaces into real Markdown links", () => {
    expect(firstLink(wikiToMarkdown("![[../drawings/How Grove works.excalidraw]]"))).toMatchObject({
      type: "link",
      url: "folio-drawing:../drawings/How Grove works.excalidraw",
    });
    expect(firstLink(wikiToMarkdown("[[My Note|the alias]]"))).toMatchObject({
      type: "link",
      url: "folio-note:My Note",
    });
    expect(firstLink(wikiToMarkdown("![[media/my photo.png]]"))).toMatchObject({
      type: "image",
      url: "media/my photo.png",
    });
  });
  it("keeps the visible text and ignores angle brackets in names", () => {
    expect(wikiToMarkdown("[[Plain]]")).toBe("[Plain](<folio-note:Plain>)");
    expect(firstLink(wikiToMarkdown("[[a<b>c]]"))?.type).toBe("link");
  });
});
