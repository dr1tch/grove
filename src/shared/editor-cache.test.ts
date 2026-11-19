import { expect, it } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { rememberEditor, takeEditor, forgetEditor } from "../renderer/editor-cache";

it("evicts old inactive histories while retaining the 32 most recently saved states", () => {
  for (let index = 0; index < 34; index++)
    rememberEditor(`cache-${index}`, {
      state: EditorState.create({ doc: `Note ${index}` }),
      scroll: index,
    });
  expect(takeEditor("cache-0")).toBeUndefined();
  expect(takeEditor("cache-1")).toBeUndefined();
  expect(takeEditor("cache-2")?.state.doc.toString()).toBe("Note 2");
  expect(takeEditor("cache-33")?.scroll).toBe(33);
  expect(takeEditor("cache-33")).toBeUndefined();
  for (let index = 0; index < 34; index++) forgetEditor(`cache-${index}`);
});
it("refreshes an existing cache key without evicting a different recent document", () => {
  for (let index = 0; index < 32; index++)
    rememberEditor(`refresh-${index}`, {
      state: EditorState.create({ doc: "Original" }),
      scroll: 0,
    });
  rememberEditor("refresh-0", { state: EditorState.create({ doc: "Updated" }), scroll: 99 });
  rememberEditor("extra", { state: EditorState.create(), scroll: 0 });
  expect(takeEditor("refresh-1")).toBeUndefined();
  expect(takeEditor("refresh-0")?.scroll).toBe(99);
  for (let index = 0; index < 32; index++) forgetEditor(`refresh-${index}`);
  forgetEditor("extra");
});
