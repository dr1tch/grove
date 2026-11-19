import { expect, it } from "vite-plus/test";
import { referenceAt, referenceMarkdown, validReference } from "../renderer/markdown-reference";

it("finds links, images and wiki references without touching code or escaped wiki syntax", () => {
  const text =
    'A [**label**](<Other note.md> "title") and ![alt](a.png). [[Note|Alias]] `[[Code]]` \\[[Literal]]';
  const link = referenceAt(text, text.indexOf("label"))!;
  expect(link).toMatchObject({
    kind: "link",
    label: "**label**",
    address: "Other note.md",
    title: "title",
  });
  expect(referenceMarkdown(link)).toBe(text.slice(link.from, link.to));
  expect(referenceAt(text, text.indexOf("alt"))).toMatchObject({ kind: "image", address: "a.png" });
  expect(referenceAt(text, text.indexOf("Alias"))).toMatchObject({
    kind: "wiki",
    address: "Note",
    label: "Alias",
  });
  expect(referenceAt(text, text.indexOf("Code"))).toBeNull();
  expect(referenceAt(text, text.indexOf("Literal"))).toBeNull();
});
it("retains original syntax unless edited and escapes edited labels, paths and titles", () => {
  const ref = referenceAt('![old](a.png "kept title")', 3)!;
  const edited = { ...ref, address: "attachments/new image.png", label: "a [caption]" };
  expect(referenceMarkdown(edited)).toBe(
    '![a \\[caption\\]](<attachments/new image.png> "kept title")',
  );
  const wiki = referenceAt("![[drawing.excalidraw|Preview]]", 5)!;
  expect(referenceMarkdown({ ...wiki, address: "new.excalidraw" })).toBe(
    "![[new.excalidraw|Preview]]",
  );
});
it("resolves reference links without rewriting their definition", () => {
  const source = "[Label][id]\n\n[id]: Other.md\n";
  expect(referenceAt(source, 3)).toMatchObject({
    kind: "link",
    address: "Other.md",
    label: "Label",
  });
});
it("preserves escaped brackets and formatted labels when only the destination changes", () => {
  const ref = referenceAt("[**a \\[caption\\]**](old.md)", 6)!;
  expect(referenceMarkdown({ ...ref, address: "new.md" })).toBe("[**a \\[caption\\]**](<new.md>)");
});
it("rejects executable addresses and malformed wiki references", () => {
  for (const address of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.test",
    "a\nb",
    "java\tscript:alert(1)",
    "javascript&colon;alert(1)",
  ])
    expect(validReference({ kind: "link", address })).toBe(false);
  expect(validReference({ kind: "wiki", address: "A]]B" })).toBe(false);
  expect(validReference({ kind: "link", address: "https://example.com" })).toBe(true);
});
