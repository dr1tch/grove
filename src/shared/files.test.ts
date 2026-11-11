import { expect, it } from "vite-plus/test";
import { kindOf, languageOf } from "./files";

it("recognizes source and configuration files across platforms", () => {
  for (const path of [
    "App.vue",
    "app.tsx",
    "mod.mts",
    "file.cjs",
    "main.py",
    "schema.graphql",
    ".env.local",
    "Dockerfile.dev",
    "Makefile",
    ".gitignore",
    "LICENSE",
    "data.tsv",
  ])
    expect(kindOf(path)).toBe("text");
  expect(languageOf("C:\\src\\APP.VUE")).toBe("vue");
  expect(languageOf("app.ts")).toBe("typescript");
  expect(languageOf("app.js")).toBe("javascript");
  expect(languageOf("unknown.weird")).toBe("text");
  expect(languageOf("CMakeLists.txt")).toBe("cmake");
});
it("preserves document types and distinguishes media", () => {
  for (const [path, kind] of Object.entries({
    "note.md": "markdown",
    "note.MARKDOWN": "markdown",
    "diagram.excalidraw.md": "drawing",
    "a.excalidraw": "drawing",
    "a.pdf": "pdf",
    "a.svg": "image",
    "a.tiff": "image",
    "a.rtf": "office",
    "a.docx": "office",
    "a.xlsx": "office",
    "a.odp": "office",
    "a.opus": "audio",
    "a.webm": "video",
  }))
    expect(kindOf(path)).toBe(kind);
});
it("leaves binary, archives and unknown paths unsupported", () => {
  for (const path of [
    "app.exe",
    "Dockerfile.exe",
    "Makefile.zip",
    "a.dll",
    "a.so",
    "a.wasm",
    "a.zip",
    "a.tar.gz",
    "a.7z",
    "a.db",
    "font.woff2",
    "mystery",
    "a.unknown",
    "/folder.ts/unknown",
    "",
  ])
    expect(kindOf(path)).toBe("unsupported");
});
