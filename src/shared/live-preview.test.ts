import { expect, it } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview } from "../renderer/live-preview";

const options = { dark: false, open: () => {}, render: () => () => {} };
function state(doc: string, anchor = doc.length) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage }), livePreview(options)],
  }).update({ selection: { anchor } }).state;
}
function hidden(value: EditorState) {
  const result: { from: number; to: number }[] = [];
  for (const set of value.facet(EditorView.decorations)) {
    if (typeof set === "function") continue;
    set.between(0, value.doc.length, (from, to, deco) => {
      if (deco.spec.liveHidden) result.push({ from, to });
    });
  }
  return result;
}
it("hides inactive Markdown without changing its source, and reveals the editing line", () => {
  const doc = "# Heading\n\nA **bold** and _italic_ [link](Other.md).\n\nLast\n";
  const initial = state(doc);
  expect(initial.doc.toString()).toBe(doc);
  expect(hidden(initial).some((range) => doc.slice(range.from, range.to) === "# ")).toBe(true);
  const active = initial.update({ selection: { anchor: doc.indexOf("bold") + 1 } }).state;
  const line = active.doc.lineAt(active.selection.main.head);
  expect(hidden(active).some((range) => range.from >= line.from && range.to <= line.to)).toBe(
    false,
  );
  expect(active.doc.toString()).toBe(doc);
});
it("keeps fenced code literal while active and makes an inactive code widget", () => {
  const doc = "```markdown\n**literal** [[Wiki]]\n```\n\nAfter\n";
  const inactive = state(doc);
  expect(
    hidden(inactive).some((range) => range.from === 0 && range.to === doc.indexOf("\n\n")),
  ).toBe(true);
  const active = inactive.update({ selection: { anchor: doc.indexOf("literal") } }).state;
  expect(hidden(active).filter((range) => range.from < doc.indexOf("After"))).toEqual([]);
});
it("preserves escapes and protects frontmatter and HTML instead of executing them", () => {
  const doc =
    "---\ntitle: Original\n---\n\n<script>alert(1)</script>\n\n\\*literal\\* and `**code**`\n\nEnd\n";
  const value = state(doc);
  expect(value.doc.toString()).toBe(doc);
  expect(hidden(value).some((range) => range.from === 0)).toBe(true);
  expect(
    hidden(value).some((range) => doc.slice(range.from, range.to) === "<script>alert(1)</script>"),
  ).toBe(true);
  expect(hidden(value).some((range) => doc.slice(range.from, range.to) === "**")).toBe(false);
});
it("leaves every selected line as source for formatting and multi-line selections", () => {
  const doc = "# Heading\n\n**Bold**\n\n```js\nconst value=1;\n```\n";
  const value = state(doc).update({ selection: { anchor: 0, head: doc.length } }).state;
  expect(hidden(value)).toEqual([]);
});
it("renders GFM task markers and tables outside the active line", () => {
  const doc = "- [ ] Task\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nEnd\n";
  const value = state(doc);
  expect(hidden(value).some((range) => doc.slice(range.from, range.to) === "[ ]")).toBe(true);
  expect(hidden(value).some((range) => doc.slice(range.from, range.to).startsWith("| A |"))).toBe(
    true,
  );
});
it("keeps a checkbox rendered while editing its text, and reveals a selected source prefix", () => {
  const doc = "- [ ] First task\n\nEnd\n";
  const value = state(doc, doc.indexOf("task"));
  expect(hidden(value).some((range) => doc.slice(range.from, range.to) === "[ ]")).toBe(true);
  const prefix = value.update({ selection: { anchor: 2 } }).state;
  expect(hidden(prefix).some((range) => range.from < 5)).toBe(false);
  const all = value.update({ selection: { anchor: 0, head: doc.length } }).state;
  expect(hidden(all)).toEqual([]);
});
it("reveals an entire active table including wiki syntax on its other lines", () => {
  const doc = "| A | B |\n| - | - |\n| [[Other|Wiki]] | 2 |\n\nEnd\n";
  const value = state(doc, 2);
  expect(hidden(value).filter((range) => range.from < doc.indexOf("End"))).toEqual([]);
});
it("keeps distinct widget identities through local changes and replaces them for a whole-note replacement", () => {
  const table = "| A | B |\n| --- | --- |\n| One | Two |",
    source = table + "\n\n" + table + "\n\nEnd\n";
  const items = (value: EditorState) => {
    const result: { identity: object; source: string }[] = [];
    for (const set of value.facet(EditorView.decorations))
      if (typeof set !== "function")
        set.between(0, value.doc.length, (_from, _to, decoration) => {
          if (decoration.spec.widget?.kind === "markdown")
            result.push({
              identity: decoration.spec.widget.identity,
              source: decoration.spec.widget.source,
            });
        });
    return result;
  };
  const initial = state(source),
    before = items(initial);
  expect(before).toHaveLength(2);
  expect(before[0].identity).not.toBe(before[1].identity);
  const local = initial.update({
      changes: { from: 0, to: table.length, insert: table.replace("One", "OneABC") },
    }).state,
    after = items(local);
  expect(after[0].identity).toBe(before[0].identity);
  expect(after[1].identity).toBe(before[1].identity);
  const foreign = local.update({
    changes: { from: 0, to: local.doc.length, insert: "Replacement\n\n" + source },
  }).state;
  expect(items(foreign).some((item) => before.some((old) => old.identity === item.identity))).toBe(
    false,
  );
});
