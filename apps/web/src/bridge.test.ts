import { expect, it } from "vite-plus/test";
import { createWebBridge } from "./bridge";
import { VaultSession } from "@grove/github-vault/sync";
import { VaultStore } from "@grove/github-vault/store";
import { MemoryCache } from "../../../packages/github-vault/src/test-cache";
import { createFakeGitHub } from "../../../scripts/fake-github.mjs";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
it("represents unsigned state and rejects unsupported native methods truthfully", async () => {
  const bridge = createWebBridge(undefined, { storage: storage() });
  expect(bridge.platform).toBe("web");
  expect(await bridge.list()).toBeNull();
  await expect(bridge.read("a.md")).rejects.toThrow("Sign in first");
  await expect(bridge.agent("claude", "", [], "")).rejects.toThrow(
    "Available in the Grove desktop app",
  );
  bridge.dispose();
});
it("persists sanitized UI state and enforces repository scope on writes", async () => {
  const fake = createFakeGitHub({ "a.md": "# Hello" });
  const store = new VaultStore({ owner: "test", repo: "vault", branch: "main" }, "fake", {
    fetch: fake.fetch,
  });
  const session = new VaultSession(store, new MemoryCache(store.root));
  const bridge = createWebBridge(session, { storage: storage() });
  expect((await bridge.list())?.root).toBe(store.root);
  await bridge.persist({ sidebar: false, assistant: true });
  expect(await bridge.state()).toMatchObject({ sidebar: false, assistant: false });
  const doc = await bridge.read("a.md");
  await expect(bridge.write("a.md", "wrong", doc.hash, "other")).rejects.toThrow(/vault/);
  expect((await bridge.write("a.md", "# New", doc.hash, store.root)).status).toBe("saved");
  expect((await bridge.read("a.md")).content).toBe("# New");
  bridge.dispose();
});
