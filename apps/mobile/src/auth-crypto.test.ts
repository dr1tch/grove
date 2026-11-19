import { createHash, randomFillSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA1: "SHA-1", SHA256: "SHA-256" },
  digest: async (algorithm: string, input: BufferSource) => {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    const result = createHash(algorithm.replace("-", "").toLowerCase()).update(bytes).digest();
    return Uint8Array.from(result).buffer;
  },
  getRandomValues: (array: Uint8Array) => randomFillSync(array),
}));
const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "crypto", original);
  vi.resetModules();
});
it("adapts native SHA-1 Git blobs and SHA-256 PKCE with no browser crypto", async () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });
  await import("./auth-crypto.native");
  const input = new TextEncoder().encode("blob 5\0hello");
  const hash = await crypto.subtle.digest("SHA-1", input);
  expect(Buffer.from(hash).toString("hex")).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  const pkce = await crypto.subtle.digest({ name: "SHA-256" }, new TextEncoder().encode("abc"));
  expect(Buffer.from(pkce).toString("hex")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(crypto.getRandomValues(new Uint8Array(32)).some((byte) => byte !== 0)).toBe(true);
  await expect(crypto.subtle.digest("MD5", input)).rejects.toThrow("Unsupported");
});
it("preserves existing platform WebCrypto", async () => {
  const existing = globalThis.crypto;
  await import("./auth-crypto.native");
  expect(globalThis.crypto).toBe(existing);
  expect(globalThis.crypto.subtle).toBe(existing.subtle);
});
