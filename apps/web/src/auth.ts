import { VaultStore } from "@grove/github-vault/store";
import { VaultSession } from "@grove/github-vault/sync";
import { GitHubError, rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";
import { BrowserCache } from "./cache";
export type Credentials = { ref: RepoRef; token: string; remember: boolean };
const key = "grove:web:credentials";
export function storedCredentials(): Credentials | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value.token !== "string" ||
      !value.token ||
      typeof value.remember !== "boolean"
    )
      return;
    rootOf(value.ref);
    return {
      ref: { owner: value.ref.owner, repo: value.ref.repo, branch: value.ref.branch },
      token: value.token,
      remember: value.remember,
    };
  } catch {
    return;
  }
}
export function forgetCredentials(): void {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}
export function rememberCredentials(value: Credentials): void {
  forgetCredentials();
  (value.remember ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
}
export async function openVault(credentials: Credentials, resume = false) {
  const store = new VaultStore(credentials.ref, credentials.token, { device: "browser" });
  const cache = new BrowserCache(credentials.ref);
  try {
    try {
      await store.head();
    } catch (error) {
      if (
        !(
          resume &&
          error instanceof GitHubError &&
          error.kind === "offline" &&
          (await cache.getTree())
        )
      )
        throw error;
    }
    return { store, cache, session: new VaultSession(store, cache) };
  } catch (error) {
    store.dispose();
    await cache.close().catch(() => {});
    throw error;
  }
}
