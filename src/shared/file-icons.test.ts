import { it, expect } from "vite-plus/test";
import { fileIconSpec } from "./file-icons";
it("distinguishes source, notes and Office file types", () => {
  expect(fileIconSpec("App.vue")).toMatchObject({ mark: "V", color: "green" });
  expect(fileIconSpec("script.js").mark).toBe("JS");
  expect(fileIconSpec("model.ts").mark).toBe("TS");
  expect(fileIconSpec("note.md").mark).toBe("M↓");
  expect(fileIconSpec("sheet.xlsx").mark).toBe("X");
  expect(fileIconSpec("slides.pptx").mark).toBe("P");
  expect(fileIconSpec("report.PDF").label).toBe("PDF document");
});
it("uses a safe neutral icon for unknown binary formats", () => {
  expect(fileIconSpec("file.custom")).toEqual({ label: "File", mark: "", color: "muted" });
});
