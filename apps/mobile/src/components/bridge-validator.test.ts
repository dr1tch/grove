import { describe, expect, it } from "vite-plus/test";
import {
  MAX_DOCUMENT_LENGTH,
  MAX_MESSAGE_LENGTH,
  validateEditorMessage,
  validateHostMessage,
} from "../../editor/protocol";
const identity = {
  documentId: "notes/été.md",
  session: "instance-1",
  revision: 4,
};
const change = {
  ...identity,
  type: "change",
  revision: 5,
  value: "hello",
  selection: { anchor: 1, head: 5 },
};
describe("isolated editor bridge", () => {
  it("accepts only the next revision for the current document and surface", () => {
    expect(validateEditorMessage(JSON.stringify(change), identity)).toEqual(change);
    for (const override of [
      { revision: 4 },
      { revision: 6 },
      { documentId: "other.md" },
      { session: "old-instance" },
    ])
      expect(
        validateEditorMessage(JSON.stringify({ ...change, ...override }), identity),
      ).toBeNull();
  });
  it("rejects malformed messages, unexpected fields, invalid selections and unbounded content", () => {
    for (const raw of [null, "{", "[]", "null", "x".repeat(MAX_MESSAGE_LENGTH + 1)])
      expect(validateEditorMessage(raw, identity)).toBeNull();
    for (const override of [
      { value: "x".repeat(MAX_DOCUMENT_LENGTH + 1) },
      { selection: { anchor: -1, head: 1 } },
      { selection: { anchor: 0, head: 6 } },
      { selection: { anchor: 0.5, head: 1 } },
      { selection: null },
      { token: "must-never-cross" },
    ])
      expect(
        validateEditorMessage(JSON.stringify({ ...change, ...override }), identity),
      ).toBeNull();
  });
  it("rejects stale ready handshakes and credential fields", () => {
    expect(
      validateEditorMessage(JSON.stringify({ ...identity, type: "ready" }), identity)?.type,
    ).toBe("ready");
    expect(
      validateEditorMessage(JSON.stringify({ ...identity, type: "ready", revision: 0 }), identity),
    ).toBeNull();
    expect(
      validateHostMessage(
        JSON.stringify({
          type: "initialize",
          ...identity,
          value: "ok",
          mode: "read",
          dark: false,
          token: "secret",
        }),
      ),
    ).toBeNull();
  });
  it("limits commands to explicit formatting and bounded cursor insertion", () => {
    const command = (value: unknown) =>
      JSON.stringify({
        type: "command",
        ...identity,
        revision: undefined,
        command: value,
      });
    expect(validateHostMessage(command({ id: 1, action: "bold" }))?.type).toBe("command");
    expect(
      validateHostMessage(command({ id: 2, action: "insert", text: "![photo](assets/a.png)" }))
        ?.type,
    ).toBe("command");
    for (const invalid of [
      { id: 1, action: "execute", text: "evil()" },
      { id: -1, action: "undo" },
      { id: 1, action: "insert" },
      { id: 1, action: "insert", text: "x".repeat(MAX_DOCUMENT_LENGTH + 1) },
    ])
      expect(validateHostMessage(command(invalid))).toBeNull();
  });
  it("requires a new session for external source replacement", () => {
    const replacement = {
      type: "replace",
      documentId: identity.documentId,
      session: identity.session,
      revision: 0,
      nextSession: "instance-2",
      value: "remote update",
    };
    expect(validateHostMessage(JSON.stringify(replacement))?.type).toBe("replace");
    expect(
      validateHostMessage(JSON.stringify({ ...replacement, nextSession: identity.session })),
    ).toBeNull();
    expect(validateHostMessage(JSON.stringify({ ...replacement, revision: 1 }))).toBeNull();
    expect(
      validateEditorMessage(JSON.stringify(change), {
        ...identity,
        session: replacement.nextSession,
        revision: 0,
      }),
    ).toBeNull();
  });
});
