import { expect, it } from "vite-plus/test";
import { cleanState } from "./state";
it("handles malformed persisted state without invalid window geometry", () => {
  expect(cleanState(null)).toEqual({});
  expect(
    cleanState({
      bounds: { width: "broken", height: -1 },
      tabs: [null, { path: 4 }, { path: "ok.md", mode: "preview" }],
    }),
  ).toEqual({ tabs: [{ path: "ok.md", mode: "preview" }] });
});
it("clamps appearance and window sizes", () => {
  const result = cleanState({
    settings: { fontSize: Infinity, font: "bad", theme: "oops" },
    bounds: { width: 2, height: 1 },
  });
  expect(result.bounds).toEqual({ width: 1000, height: 640 });
  expect(result.settings?.font).toBe("serif");
  expect(result.settings?.fontSize).toBe(14);
});
it("preserves full and spacious reading widths, local fonts and sidebar size", () => {
  for (const readingWidth of [0, 960, 1200]) {
    const state = cleanState({
      settings: { font: "local", localFont: "DejaVu Sans", readingWidth },
      sidebarWidth: 380,
    });
    expect(state.settings?.readingWidth).toBe(readingWidth);
    expect(state.settings?.localFont).toBe("DejaVu Sans");
    expect(state.settings?.font).toBe("local");
    expect(state.sidebarWidth).toBe(380);
  }
});
