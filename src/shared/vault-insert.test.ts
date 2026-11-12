import { expect, it } from "vite-plus/test";
import { mermaidBlocks, vaultReference } from "./vault-insert";
import { parseLinks } from "./links";

it("inserts vault-root references that survive choosing a new draft's folder", () => {
  const path = "media/Café #[1] 🌱.pdf";
  const source = vaultReference(path, true);
  expect(source).toBe(
    "![Café #\\[1\\] 🌱.pdf](</media/Caf%C3%A9%20%23%5B1%5D%20%F0%9F%8C%B1.pdf>)",
  );
  for (const note of ["Note.md", "projects/notes/Note.md"])
    expect(parseLinks(note, source, [path])[0]?.targetPath).toBe(path);
  expect(vaultReference("media/video.mp4", false)).toBe("[video.mp4](</media/video.mp4>)");
});

it("finds actual Mermaid blocks, not similar prose or other code, and keeps editable source", () => {
  const source =
    '# Release\n\n```text\nmermaid\n```\n\n## Progress\n\n```mermaid\npie\n  "Done" : 4\n```\n';
  expect(mermaidBlocks(source)).toEqual([
    { label: "Progress", content: '```mermaid\npie\n  "Done" : 4\n```' },
  ]);
});

it("retains safe fences when Mermaid content contains backticks", () => {
  expect(mermaidBlocks("````mermaid\nflowchart LR\n A[```] --> B\n````")[0]?.content).toBe(
    "````mermaid\nflowchart LR\n A[```] --> B\n````",
  );
});
