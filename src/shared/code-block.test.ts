import { expect, it } from "vite-plus/test";
import { codeBlocks, markdownWithBlocks, replaceCodeBlock } from "@grove/core/code-block";
it("maps duplicate fenced blocks after multiline wiki links without changing their source", () => {
  const source =
    "[[a\nb\nc\nd\ne|Alias]]\n\n```markdown\n# Same [[raw]]\n```\n\n```markdown\n# Same [[raw]]\n```";
  const display = markdownWithBlocks(source);
  expect(display.blocks.map((block) => [block.line, block.displayLine])).toEqual([
    [7, 3],
    [11, 7],
  ]);
  expect(display.value).toContain("# Same [[raw]]");
  const second = display.blocks.find((block) => block.displayLine === 7)!;
  expect(replaceCodeBlock(source, source, second.line, "Changed")).toBe(
    source.slice(0, second.from) + "```markdown\nChanged\n```",
  );
});
it("changes only the chosen fenced block, preserving duplicate blocks and surrounding text", () => {
  const source = "Before\n\n```markdown title\n# Same\n```\n\n```markdown\n# Same\n```\n\nAfter\n";
  const blocks = codeBlocks(source);
  expect(replaceCodeBlock(source, source, blocks[1].line, "# Changed")).toBe(
    source.replace("```markdown\n# Same", "```markdown\n# Changed"),
  );
});
it("refuses stale note edits and safely contains fence characters and CRLF", () => {
  const source = "~~~markdown\r\nOld\r\n~~~\r\nTail";
  expect(() => replaceCodeBlock(source + "new", source, 1, "change")).toThrow("note changed");
  const changed = replaceCodeBlock(source, source, 1, "new\n~~~\ntext");
  expect(codeBlocks(changed)[0].body).toBe("new\n~~~\ntext");
  expect(changed.endsWith("\r\nTail")).toBe(true);
  expect(codeBlocks("    indented code\n")).toEqual([]);
});
