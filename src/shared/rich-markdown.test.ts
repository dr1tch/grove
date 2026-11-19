import { expect, it } from "vite-plus/test";
import { RichMarkdownModel, richExtensions } from "../renderer/rich-markdown";
import { MarkdownManager } from "@tiptap/markdown";
import { fromMarkdown } from "mdast-util-from-markdown";
const manager = () => new MarkdownManager({ extensions: richExtensions });
it("does not rewrite untouched syntax, properties, comments, wiki links or duplicate fences", () => {
  const source =
    "---\r\ntitle: Notes\r\n---\r\n\r\n# Heading\r\n\r\nAn __unchanged__ [[Page|alias]] with <!-- secret --> text.\r\n\r\n```markdown meta\r\n# Same\r\n```\r\n\r\n```markdown meta\r\n# Same\r\n```\r\n\r\n[id]: /Other.md\r\n";
  const model = new RichMarkdownModel(source);
  expect(model.serialize(model.document)).toBe(source);
});
it("changes only a modified paragraph while keeping other original Markdown bytes", () => {
  const source =
    "# Keep _this_\n\nOriginal **bold** paragraph.\n\n<!-- untouched -->\n\n```mermaid\nflowchart LR\n A-->B\n```\n";
  const model = new RichMarkdownModel(source),
    next = structuredClone(model.document);
  const paragraph = next.content!.find((node) => node.type === "paragraph")!;
  paragraph.content!.push({ type: "text", text: " Added." });
  const output = model.serialize(next);
  expect(output.startsWith("# Keep _this_\n\n")).toBe(true);
  expect(output.endsWith("\n\n<!-- untouched -->\n\n```mermaid\nflowchart LR\n A-->B\n```\n")).toBe(
    true,
  );
  expect(output).toContain("**bold**");
  expect(output).toContain("Added.");
});
it("preserves wiki syntax and HTML comments when their paragraph is edited", () => {
  const model = new RichMarkdownModel("A [[Page|Alias]] <!-- keep --> paragraph.\n");
  const next = structuredClone(model.document);
  next.content![0].content!.push({ type: "text", text: " Changed." });
  expect(model.serialize(next)).toContain("[[Page|Alias]]");
  expect(model.serialize(next)).toContain("<!-- keep -->");
});
it("contains fence delimiters and updates only the chosen duplicate code node", () => {
  const source = "```markdown\nSame\n```\n\n```markdown\nSame\n```\n";
  const model = new RichMarkdownModel(source),
    next = structuredClone(model.document);
  next.content![1].attrs!.body = "New\n```\nStill inside";
  const output = model.serialize(next);
  expect(output.startsWith("```markdown\nSame\n```\n\n")).toBe(true);
  expect(output).toContain("````markdown\nNew\n```\nStill inside\n````");
});
it("serializes inserted and removed blocks without reviving deleted source", () => {
  const model = new RichMarkdownModel("# First\n\nDelete me\n\nLast\n"),
    next = structuredClone(model.document);
  next.content!.splice(1, 1, { type: "paragraph", content: [{ type: "text", text: "New block" }] });
  const output = model.serialize(next);
  expect(output).toBe("# First\n\nNew block\n\nLast\n");
});
it("supports formatted GFM lists, task lists and tables without executable HTML", () => {
  const source = "- [x] Done\n- [ ] Todo\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
  const model = new RichMarkdownModel(source);
  expect(model.document.content!.map((node) => node.type)).toEqual(["taskList", "table"]);
  expect(model.serialize(model.document)).toBe(source);
  expect(JSON.stringify(manager().parse("Text <!-- secret --> end"))).toContain("groveInline");
});
it("keeps table fragments canonical without adding extra outer blank lines on edits", () => {
  const source = "| A | B |\n| --- | --- |\n| One | Two |";
  const model = new RichMarkdownModel(source),
    next = structuredClone(model.document);
  next.content![0].content![1].content![0].content![0].content![0].text = "OneABC";
  const output = model.serialize(next);
  expect(output.startsWith("|")).toBe(true);
  expect(output.endsWith("|")).toBe(true);
  expect(output).toContain("OneABC");
});
it("retains inline images and links when typing beside them", () => {
  const model = new RichMarkdownModel("Before ![alt](<Media/a.png>) and [note](Other.md).\n");
  const next = structuredClone(model.document);
  next.content![0].content!.push({ type: "text", text: " Edit." });
  expect(model.serialize(next)).toContain("![alt](<Media/a.png>)");
  expect(model.serialize(next)).toContain("[note](<Other.md>)");
});
it("keeps a caption editable when its paragraph begins with an image", () => {
  const model = new RichMarkdownModel("![alt](Media/a.png) Caption.\n");
  expect(model.document.content![0].type).toBe("paragraph");
});
it("does not duplicate leading whitespace when a split inherits a source identity", () => {
  const model = new RichMarkdownModel("\n\n\n\nOriginal\n"),
    next = structuredClone(model.document);
  next.content!.unshift({
    ...structuredClone(next.content![0]),
    content: [{ type: "text", text: "Before" }],
  });
  expect(model.serialize(next)).toBe("\n\n\n\nBefore\n\nOriginal\n");
});
it("keeps GFM table rows editable when their last row omits pipes", () => {
  const model = new RichMarkdownModel("| A | B |\n| - | - |\n| 1 | 2 |\nAfter table\n");
  expect(model.document.content!.map((node) => node.type)).toEqual(["table"]);
});
it("keeps prose immediately after TOML properties visible and independent from the following block", () => {
  const source = "+++\na=1\n+++\nHello\n\nOther\n";
  const model = new RichMarkdownModel(source),
    next = structuredClone(model.document);
  expect(next.content!.map((node) => node.type)).toEqual(["groveRaw", "paragraph", "paragraph"]);
  next.content!.pop();
  expect(model.serialize(next)).toBe("+++\na=1\n+++\nHello\n");
});
it.each([
  { text: "Before [note](<Folder/My note.md>) after.\n", url: "Folder/My note.md", title: null },
  { text: 'Before [note](Other.md "A \\"quote\\"") after.\n', url: "Other.md", title: 'A "quote"' },
])("retains valid links while typing beside them: $url", ({ text, url, title }) => {
  const model = new RichMarkdownModel(text),
    next = structuredClone(model.document);
  next.content![0].content!.push({ type: "text", text: " Added." });
  const paragraph = fromMarkdown(model.serialize(next)).children[0];
  if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
  const link = paragraph.children.find((node) => node.type === "link");
  expect(link?.url).toBe(url);
  expect(link?.title ?? null).toBe(title);
});
