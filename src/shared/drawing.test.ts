import { it, expect } from "vite-plus/test";
import LZString from "lz-string";
import { decodeDrawing, encodeDrawing } from "./drawing";
const scene = {
  type: "excalidraw",
  version: 2,
  elements: [{ id: "one", type: "text", text: "hello" }],
  appState: {},
  files: {},
};
it("round trips plain drawing JSON", () => {
  expect(decodeDrawing(encodeDrawing(JSON.stringify(scene), scene))).toEqual(scene);
});
it("preserves surrounding Obsidian markdown and compressed format", () => {
  const original = `---\nexcalidraw-plugin: parsed\n---\n# Drawing\n\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(scene))}\n\`\`\`\n`;
  const changed = { ...scene, elements: [] };
  const encoded = encodeDrawing(original, changed);
  expect(encoded.startsWith("---\nexcalidraw-plugin: parsed")).toBe(true);
  expect(encoded).toContain("compressed-json");
  expect(decodeDrawing(encoded)).toEqual(changed);
});
it("rejects malformed drawing data", () => {
  expect(() => decodeDrawing('{"hello":1}')).toThrow();
});
