import type { MarkdownAction } from "@grove/core/markdown-format";

export const PROTOCOL_VERSION = 1;
export const MAX_DOCUMENT_LENGTH = 2 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = MAX_DOCUMENT_LENGTH * 6 + 4096;
export type SurfaceCommand = {
  id: number;
  action: MarkdownAction | "undo" | "redo" | "insert";
  text?: string;
};
export type Identity = { documentId: string; session: string };
export type Selection = { anchor: number; head: number };
export type EditorMessage =
  | { type: "boot"; protocol: 1 }
  | (Identity & { type: "ready"; revision: number })
  | (Identity & {
      type: "change";
      revision: number;
      value: string;
      selection: Selection;
    })
  | (Identity & { type: "error"; message: string });
export type HostMessage =
  | { type: "probe" }
  | (Identity & {
      type: "initialize";
      revision: number;
      value: string;
      mode: "read" | "edit";
      dark: boolean;
    })
  | (Identity & {
      type: "replace";
      revision: 0;
      nextSession: string;
      value: string;
    })
  | (Identity & { type: "appearance"; mode: "read" | "edit"; dark: boolean })
  | (Identity & { type: "command"; command: SurfaceCommand });
const actions = new Set([
  "undo",
  "redo",
  "insert",
  "bold",
  "italic",
  "code",
  "link",
  "quote",
  "bullet",
  "ordered",
  "task",
  "table",
  "h0",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function identity(value: Record<string, unknown>): boolean {
  return (
    typeof value.documentId === "string" &&
    value.documentId.length <= 4096 &&
    typeof value.session === "string" &&
    value.session.length > 0 &&
    value.session.length <= 128
  );
}
export function validText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_DOCUMENT_LENGTH;
}
export function parseMessage(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_LENGTH) return null;
  try {
    const result: unknown = JSON.parse(raw);
    return record(result) ? result : null;
  } catch {
    return null;
  }
}
export function validateCommand(value: unknown): value is SurfaceCommand {
  return (
    record(value) &&
    exact(value, ["id", "action", "text"]) &&
    integer(value.id) &&
    typeof value.action === "string" &&
    actions.has(value.action) &&
    (value.action === "insert" ? validText(value.text) : value.text === undefined)
  );
}
/** Native code uses this before any editor callback or cache write. */
export function validateEditorMessage(
  raw: unknown,
  expected: Identity & { revision: number },
): EditorMessage | null {
  const value = parseMessage(raw);
  if (!value) return null;
  if (
    value.type === "boot" &&
    value.protocol === PROTOCOL_VERSION &&
    exact(value, ["type", "protocol"])
  )
    return value as EditorMessage;
  if (
    !identity(value) ||
    value.documentId !== expected.documentId ||
    value.session !== expected.session
  )
    return null;
  if (
    value.type === "ready" &&
    integer(value.revision) &&
    value.revision === expected.revision &&
    exact(value, ["type", "documentId", "session", "revision"])
  )
    return value as EditorMessage;
  if (
    value.type === "error" &&
    typeof value.message === "string" &&
    value.message.length <= 512 &&
    exact(value, ["type", "documentId", "session", "message"])
  )
    return value as EditorMessage;
  if (
    value.type !== "change" ||
    !exact(value, ["type", "documentId", "session", "revision", "value", "selection"]) ||
    !integer(value.revision) ||
    value.revision !== expected.revision + 1 ||
    !validText(value.value) ||
    !record(value.selection) ||
    !exact(value.selection, ["anchor", "head"])
  )
    return null;
  const { anchor, head } = value.selection;
  if (
    !integer(anchor) ||
    !integer(head) ||
    anchor > value.value.length ||
    head > value.value.length
  )
    return null;
  return value as EditorMessage;
}
export function validateHostMessage(raw: unknown): HostMessage | null {
  const value = parseMessage(raw);
  if (!value) return null;
  if (value.type === "probe" && exact(value, ["type"])) return value as HostMessage;
  if (!identity(value)) return null;
  const keys = ["type", "documentId", "session"];
  if (
    value.type === "initialize" &&
    exact(value, [...keys, "revision", "value", "mode", "dark"]) &&
    integer(value.revision) &&
    validText(value.value) &&
    (value.mode === "read" || value.mode === "edit") &&
    typeof value.dark === "boolean"
  )
    return value as HostMessage;
  if (
    value.type === "replace" &&
    exact(value, [...keys, "revision", "nextSession", "value"]) &&
    value.revision === 0 &&
    typeof value.nextSession === "string" &&
    value.nextSession.length > 0 &&
    value.nextSession.length <= 128 &&
    value.nextSession !== value.session &&
    validText(value.value)
  )
    return value as HostMessage;
  if (
    value.type === "appearance" &&
    exact(value, [...keys, "mode", "dark"]) &&
    (value.mode === "read" || value.mode === "edit") &&
    typeof value.dark === "boolean"
  )
    return value as HostMessage;
  if (
    value.type === "command" &&
    exact(value, [...keys, "command"]) &&
    validateCommand(value.command)
  )
    return value as HostMessage;
  return null;
}
