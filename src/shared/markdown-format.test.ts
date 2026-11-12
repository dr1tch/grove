import { describe, expect, it } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { fromMarkdown } from "mdast-util-from-markdown";
import { formatMarkdown } from "./markdown-format";

function format(
  text: string,
  from: number,
  to: number,
  action: Parameters<typeof formatMarkdown>[3],
) {
  const state = EditorState.create({ doc: text, selection: { anchor: from, head: to } });
  return state.update(formatMarkdown(text, from, to, action)).state;
}

describe("Markdown formatting", () => {
  it("wraps the selected text and keeps it selected", () => {
    const next = format("hello world", 6, 11, "bold");
    expect(next.doc.toString()).toBe("hello **world**");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("world");
    expect(format(next.doc.toString(), 8, 13, "bold").doc.toString()).toBe("hello world");
  });
  it("removes selected formatting markers and preserves other text", () => {
    expect(format("a **word** z", 2, 10, "bold").doc.toString()).toBe("a word z");
  });
  it("adds italic inside bold without removing the bold markers", () => {
    const next = format("**word**", 2, 6, "italic");
    expect(next.doc.toString()).toBe("***word***");
    expect(format("***word***", 3, 7, "italic").doc.toString()).toBe("**word**");
  });
  it("selects a placeholder at an empty caret", () => {
    const next = format("", 0, 0, "bold");
    expect(next.doc.toString()).toBe("**text**");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("text");
  });
  it("keeps surrounding whitespace outside emphasis markers", () => {
    expect(format(" hello ", 0, 7, "bold").doc.toString()).toBe(" **hello** ");
  });
  it("uses a longer inline code delimiter when text contains backticks", () => {
    expect(format("a`b", 0, 3, "code").doc.toString()).toBe("``a`b``");
  });
  it("removes outer code formatting without deleting selected literal backticks", () => {
    expect(format("`` `x` ``", 3, 6, "code").doc.toString()).toBe("`x`");
  });
  it("formats each paragraph separately instead of producing literal emphasis markers", () => {
    const next = format("one\n\ntwo", 0, 8, "bold");
    expect(next.doc.toString()).toBe("**one**\n\n**two**");
    expect(
      fromMarkdown(next.doc.toString()).children.map(
        (node) => node.type === "paragraph" && node.children[0].type,
      ),
    ).toEqual(["strong", "strong"]);
    expect(format("one\n\ntwo", 0, 8, "italic").doc.toString()).toBe("*one*\n\n*two*");
  });
  it("uses a safe fence for multiline code", () => {
    expect(format("one\n```\ntwo", 0, 11, "code").doc.toString()).toBe("````\none\n```\ntwo\n````");
  });
  it("creates a link and selects its destination", () => {
    const next = format("read this", 5, 9, "link");
    expect(next.doc.toString()).toBe("read [this](url)");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("url");
  });
  it("changes a heading level instead of stacking headings", () => {
    expect(format("## Title", 4, 4, "h3").doc.toString()).toBe("### Title");
    expect(format("### Title", 5, 5, "h0").doc.toString()).toBe("Title");
  });
  it("toggles headings without changing the following line", () => {
    expect(format("Title\nBody", 0, 6, "h2").doc.toString()).toBe("## Title\nBody");
    expect(format("## Title", 3, 8, "h2").doc.toString()).toBe("Title");
  });
  it("changes a selected ordered list to a task list without duplicate prefixes", () => {
    expect(format("1. one\n2. two", 0, 13, "task").doc.toString()).toBe("- [ ] one\n- [ ] two");
  });
  it("removes task markers including checked tasks when toggled off", () => {
    expect(format("- [x] one\n- [ ] two", 0, 19, "task").doc.toString()).toBe("one\ntwo");
  });
  it("numbers selected list items while retaining indentation and blank separators", () => {
    expect(format("  - one\n\n  - two", 0, 16, "ordered").doc.toString()).toBe(
      "  1. one\n\n  2. two",
    );
  });
  it("toggles quotes and does not double-prefix partially quoted selections", () => {
    expect(format("> one\ntwo", 0, 9, "quote").doc.toString()).toBe("> one\n> two");
    expect(format("> one\n> two", 0, 11, "quote").doc.toString()).toBe("one\ntwo");
  });
  it("can start a list in an empty document", () => {
    expect(format("", 0, 0, "bullet").doc.toString()).toBe("- ");
  });
});
