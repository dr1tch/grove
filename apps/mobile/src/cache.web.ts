import { BrowserCache } from "@grove/github-vault/browser-cache";
import type { RepoRef } from "@grove/github-vault/types";
import type { VaultCache } from "@grove/github-vault/cache";

export async function openVaultCache(source: RepoRef | string): Promise<VaultCache> {
  return new BrowserCache(source, { localSample: true });
}
