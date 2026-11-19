import type { EditorState } from "@codemirror/state";

const inactive = new Map<string, { state: EditorState; scroll: number }>();
export function rememberEditor(key: string, value: { state: EditorState; scroll: number }) {
  inactive.delete(key);
  inactive.set(key, value);
  while (inactive.size > 32) inactive.delete(inactive.keys().next().value!);
}
export function takeEditor(key: string) {
  const value = inactive.get(key);
  inactive.delete(key);
  return value;
}
export function forgetEditor(key: string) {
  inactive.delete(key);
}
