import LZString from "lz-string";
export type Scene = {
  type?: string;
  version?: number;
  elements: any[];
  appState?: Record<string, any>;
  files?: Record<string, any>;
};
const block = /```(compressed-json|json)\s*\n([\s\S]*?)\n```/;
export function decodeDrawing(content: string): Scene {
  const match = content.match(block);
  const raw = match
    ? match[1] === "compressed-json"
      ? LZString.decompressFromBase64(match[2].replace(/\s/g, ""))
      : match[2]
    : content;
  if (!raw) throw new Error("Empty drawing");
  const scene = JSON.parse(raw);
  if (!scene || !Array.isArray(scene.elements)) throw new Error("Invalid Excalidraw scene");
  return scene;
}
export function encodeDrawing(original: string, scene: unknown): string {
  const match = original.match(block);
  const json = JSON.stringify(scene, null, 2);
  if (!match) return json;
  return original.replace(
    block,
    () =>
      `\`\`\`${match[1]}\n${match[1] === "compressed-json" ? LZString.compressToBase64(json) : json}\n\`\`\``,
  );
}
