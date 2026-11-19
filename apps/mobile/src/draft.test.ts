import { describe, expect, it } from "vite-plus/test";
import { insertReference, noteDestination, proposedName, recoveryNote } from "./draft";
describe("phone draft boundaries", () => {
  it("proposes a heading name and rejects traversal at first save", () => {
    expect(proposedName("# Meeting / notes\nbody")).toBe("Meeting   notes.md");
    expect(noteDestination("Meeting", "Projects")).toBe("Projects/Meeting.md");
    expect(() => noteDestination("../outside", "")).toThrow();
    expect(() => noteDestination("Note", "../outside")).toThrow();
  });
  it("keeps root references stable and rejects invalid recovery records", () => {
    expect(insertReference("Reading/Note.md", false)).toContain("/Reading/Note.md");
    expect(recoveryNote({ draft: false, value: "text" })).toBeUndefined();
    expect(
      recoveryNote({ id: "x", path: "../bad", value: "text", saved: "", hash: "", draft: false }),
    ).toBeUndefined();
  });
});
