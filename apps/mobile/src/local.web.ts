// Separate from vault storage and credentials. IndexedDB keeps recovery drafts durable.
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("grove-mobile-local", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("local");
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      blocked = true;
      database = undefined;
      reject(new Error("Close other Grove previews before upgrading local storage."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("local", mode, { durability: "strict" });
    const request = action(tx.objectStore("local"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Local changes were not saved."));
  });
}
export async function loadLocal<T>(key: string): Promise<T | undefined> {
  return transaction("readonly", (store) => store.get(key));
}
export async function saveLocal(key: string, value: unknown): Promise<void> {
  if (value === undefined) await transaction("readwrite", (store) => store.delete(key));
  else await transaction("readwrite", (store) => store.put(value, key));
}
