import { expect, it } from "vite-plus/test";
import { attachmentMarkdown } from "./attachments";
it("creates portable relative encoded links without breaking Markdown labels", () => {
  expect(
    attachmentMarkdown("notes/n.md", {
      path: "notes/attachments/a #1.png",
      kind: "image",
      copied: true,
    }),
  ).toBe("![a #1.png](attachments/a%20%231.png)");
  expect(
    attachmentMarkdown("notes/n.md", { path: "docs/a[b].pdf", kind: "pdf", copied: false }),
  ).toBe("[a\\[b\\].pdf](../docs/a%5Bb%5D.pdf)");
});
