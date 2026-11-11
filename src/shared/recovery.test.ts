import { it, expect } from "vite-plus/test";
import { recoverTab, type WorkingTab } from "./recovery";
const doc = { path: "note.md", content: "base", hash: "base-hash", modified: 1 };
const expected: WorkingTab = {
  id: "tab-a",
  path: "note.md",
  mode: "edit",
  doc,
  value: "first draft",
};
const disk = { ...doc, content: "external", hash: "new-hash" };
it("keeps edits made while recovery is pending", () => {
  const current = { ...expected, value: "newer draft" };
  const result = recoverTab(current, expected, disk, "A", "A");
  expect(result.tab.value).toBe("newer draft");
  expect(result.tab.disk).toEqual(disk);
  expect(result.clearDraft).toBe(false);
});
it("ignores recovery from another vault or reopened tab", () => {
  expect(recoverTab(expected, expected, disk, "B", "A").tab).toBe(expected);
  const reopened = { ...expected, id: "tab-b" };
  expect(recoverTab(reopened, expected, disk, "A", "A").tab).toBe(reopened);
});
it("replaces only the exact unchanged draft and permits clearing recovery storage", () => {
  const result = recoverTab(expected, expected, disk, "A", "A");
  expect(result.tab.value).toBe("external");
  expect(result.clearDraft).toBe(true);
});
