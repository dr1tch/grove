import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

// Preferences and draft recovery only. Credentials belong in SecureStore.
let database: Promise<SQLiteDatabase> | undefined;
function open(): Promise<SQLiteDatabase> {
  return (database ??= openDatabaseAsync("grove-local.db")
    .then((db) => {
      db.execSync(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS local_values (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
      );
      return db;
    })
    .catch((error) => {
      database = undefined;
      throw error;
    }));
}
export async function loadLocal<T>(key: string): Promise<T | undefined> {
  const row = (await open()).getFirstSync<{ value: string }>(
    "SELECT value FROM local_values WHERE key = ?",
    key,
  );
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export async function saveLocal(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (value === undefined) db.runSync("DELETE FROM local_values WHERE key = ?", key);
  else
    db.runSync(
      "INSERT OR REPLACE INTO local_values (key, value) VALUES (?, ?)",
      key,
      JSON.stringify(value),
    );
}
