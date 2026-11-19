import { describe, expect, it } from "vite-plus/test";
import { chunkedSecretStorage, memorySecretStorage } from "./auth-storage";
import { validateConnection } from "./auth-connection";

function device() {
  const values = new Map<string, string>();
  let failWrite = -1,
    writes = 0;
  return {
    values,
    failAfter(count: number) {
      failWrite = writes + count;
    },
    recover() {
      failWrite = -1;
    },
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (++writes === failWrite) throw new Error("Device secure storage unavailable");
        expect(new TextEncoder().encode(value).byteLength).toBeLessThan(2048);
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  };
}
describe("native credential storage", () => {
  it("round trips large Unicode auth sessions without oversized native writes", async () => {
    const native = device(),
      storage = chunkedSecretStorage(native.storage);
    const value = JSON.stringify({
      access_token: "secret",
      metadata: "🌿".repeat(5000),
    });
    await storage.setItem("supabase-session", value);
    expect(await storage.getItem("supabase-session")).toBe(value);
    await storage.removeItem("supabase-session");
    expect(native.values.size).toBe(0);
    expect(await storage.getItem("supabase-session")).toBeNull();
  });
  it("keeps the previous session if writing a new bank fails and removes interrupted writes on sign-out", async () => {
    const native = device(),
      storage = chunkedSecretStorage(native.storage);
    await storage.setItem("session", "previous");
    native.failAfter(3);
    await expect(storage.setItem("session", "new".repeat(700))).rejects.toThrow("unavailable");
    expect(await storage.getItem("session")).toBe("previous");
    native.recover();
    await storage.removeItem("session");
    expect(native.values.size).toBe(0);
  });
  it("serializes replacement, reads and sign-out without reviving removed credentials", async () => {
    const native = device(),
      storage = chunkedSecretStorage(native.storage);
    await storage.setItem("session", "initial");
    const writing = storage.setItem("session", "latest".repeat(500));
    const reading = storage.getItem("session");
    const removing = storage.removeItem("session");
    await writing;
    expect(await reading).toBe("latest".repeat(500));
    await removing;
    expect(await storage.getItem("session")).toBeNull();
    expect(native.values.size).toBe(0);
  });
  it("surfaces damaged native chunks instead of silently signing in with partial data", async () => {
    const native = device(),
      storage = chunkedSecretStorage(native.storage);
    await storage.setItem("session", "secret");
    const chunk = [...native.values.keys()].find((key) => key.endsWith(".0.0"))!;
    native.values.delete(chunk);
    await expect(storage.getItem("session")).rejects.toThrow("incomplete");
  });
  it("keeps browser preview credentials only in the current adapter", async () => {
    const first = memorySecretStorage();
    await first.setItem("session", "secret");
    expect(await first.getItem("session")).toBe("secret");
    expect(await memorySecretStorage().getItem("session")).toBeNull();
  });
  it("keeps the previous value when committing the bank pointer fails", async () => {
    const native = device(),
      storage = chunkedSecretStorage(native.storage);
    await storage.setItem("session", "previous");
    native.failAfter(3);
    await expect(storage.setItem("session", "next")).rejects.toThrow("unavailable");
    expect(await storage.getItem("session")).toBe("previous");
    native.recover();
    await storage.setItem("session", "recovered");
    expect(await storage.getItem("session")).toBe("recovered");
  });
  it("reports failed secure deletion and allows a complete retry", async () => {
    const native = device();
    let fail = true;
    const storage = chunkedSecretStorage({
      ...native.storage,
      removeItem: async (key) => {
        if (fail && key.endsWith(".0.1")) throw new Error("Device secure deletion failed");
        await native.storage.removeItem(key);
      },
    });
    await storage.setItem("session", "secret".repeat(100));
    await expect(storage.removeItem("session")).rejects.toThrow("deletion failed");
    fail = false;
    await storage.removeItem("session");
    expect(native.values.size).toBe(0);
  });
  it("reports a committed replacement as saved when old-bank cleanup fails", async () => {
    const native = device();
    let failCleanup = false;
    const storage = chunkedSecretStorage({
      ...native.storage,
      removeItem: async (key) => {
        if (failCleanup && key.endsWith(".0.1")) throw new Error("Device secure deletion failed");
        await native.storage.removeItem(key);
      },
    });
    await storage.setItem("session", "previous".repeat(100));
    failCleanup = true;
    await expect(storage.setItem("session", "replacement")).resolves.toBeUndefined();
    expect(await storage.getItem("session")).toBe("replacement");
    expect(await chunkedSecretStorage(native.storage).getItem("session")).toBe("replacement");
    // Keep the old header so deletion can retry every partially removed chunk.
    expect([...native.values.keys()].some((key) => key.endsWith(".0"))).toBe(true);
    await expect(storage.removeItem("session")).rejects.toThrow("deletion failed");
    failCleanup = false;
    await storage.removeItem("session");
    expect(native.values.size).toBe(0);
  });
});
describe("saved connection validation", () => {
  it("rejects invalid repo refs, tokens and account ids before persistence", () => {
    expect(() =>
      validateConnection({
        kind: "github",
        ref: { owner: "me", repo: "../secret", branch: "main" },
        token: "token",
      }),
    ).toThrow();
    expect(() =>
      validateConnection({
        kind: "github",
        ref: { owner: "me", repo: "notes", branch: "main" },
        token: "token\nheader",
      }),
    ).toThrow();
    expect(() =>
      validateConnection({
        kind: "cloud",
        userId: "another-person",
        email: "",
      }),
    ).toThrow();
    expect(
      validateConnection({
        kind: "github",
        ref: { owner: "me", repo: "notes", branch: "main" },
        token: "token",
        extraSecret: "omit",
      }),
    ).toEqual({
      kind: "github",
      ref: { owner: "me", repo: "notes", branch: "main" },
      token: "token",
    });
  });
});
