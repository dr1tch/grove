import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import type { RepoRef } from "@grove/github-vault/types";
import type { VaultCache } from "@grove/github-vault/cache";
import { cacheRoot, SQLiteVaultCache } from "./sqlite-cache";

let database: Promise<SQLiteDatabase> | undefined;
function open(): Promise<SQLiteDatabase> {
  return (database ??= openDatabaseAsync("grove-vaults.db")
    .then((db) => {
      db.execSync(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
      );
      return db;
    })
    .catch((error) => {
      database = undefined;
      throw error;
    }));
}
export async function openVaultCache(source: RepoRef | string): Promise<VaultCache> {
  cacheRoot(source);
  return new SQLiteVaultCache(await open(), source, randomUUID);
}
