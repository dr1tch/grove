import { expect, it } from "vite-plus/test";
import { SourceAcknowledgements } from "./source-acknowledgements";
it("does not replace newer typing when React acknowledges an older change", () => {
  const source = new SourceAcknowledgements("");
  source.record("# P");
  source.record("# Ph");
  source.record("# Phone");
  expect(source.isExternal("# P")).toBe(false);
  expect(source.isExternal("# Phone")).toBe(false);
  expect(source.isExternal("# Phone")).toBe(false);
  expect(source.isExternal("# Remote")).toBe(true);
});
it("releases coalesced acknowledgements and applies backpressure before memory grows", () => {
  const source = new SourceAcknowledgements("");
  for (let i = 1; i <= 32; i++) source.record("x".repeat(i));
  expect(source.needsAcknowledgement).toBe(true);
  expect(source.isExternal("x".repeat(32))).toBe(false);
  expect(source.needsAcknowledgement).toBe(false);
  expect(source.isExternal("remote")).toBe(true);
});

it("acknowledges the newest repeated value even when React coalesces back to initial source", () => {
  const source = new SourceAcknowledgements("");
  for (let i = 0; i < 16; i++) {
    source.record("a");
    source.record("");
  }
  expect(source.needsAcknowledgement).toBe(true);
  expect(source.isExternal("")).toBe(false);
  expect(source.needsAcknowledgement).toBe(false);
  source.record("after undo");
  expect(source.isExternal("after undo")).toBe(false);
});
