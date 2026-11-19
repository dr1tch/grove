/** Async credential storage. The native implementation must never fall back to plaintext. */
export interface SecretStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function memorySecretStorage(): SecretStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

// Each chunk contains at most 400 Unicode code points, or 1600 UTF-8 bytes.
// Two banks let a failed write leave the previous complete value available.
export function chunkedSecretStorage(store: SecretStorage): SecretStorage {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }
  const prefix = (key: string) =>
    `grove.${Array.from(key, (char) => char.codePointAt(0)!.toString(16)).join("-")}`;
  async function header(key: string): Promise<number | null> {
    const value = await store.getItem(key);
    if (value === null) return null;
    const count = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(count) || count < 1 || count > 512)
      throw new Error("Saved secure credentials are damaged. Sign out and reconnect.");
    return count;
  }
  async function active(key: string): Promise<"0" | "1" | null> {
    const value = await store.getItem(key);
    if (value !== null && value !== "0" && value !== "1")
      throw new Error("Saved secure credentials are damaged. Sign out and reconnect.");
    return value;
  }
  async function clearBank(key: string): Promise<void> {
    const count = await header(key);
    if (count === null) return;
    // Keep the header until every chunk is gone, so deletion can be retried.
    for (let index = 0; index < count; index++) await store.removeItem(`${key}.${index}`);
    await store.removeItem(key);
  }
  return {
    getItem: (name) =>
      serial(async () => {
        const key = prefix(name),
          bank = await active(key);
        if (bank === null) return null;
        const count = await header(`${key}.${bank}`);
        if (count === null)
          throw new Error("Saved secure credentials are incomplete. Sign out and reconnect.");
        const chunks: string[] = [];
        for (let index = 0; index < count; index++) {
          const chunk = await store.getItem(`${key}.${bank}.${index}`);
          if (chunk === null)
            throw new Error("Saved secure credentials are incomplete. Sign out and reconnect.");
          chunks.push(chunk);
        }
        return chunks.join("");
      }),
    setItem: (name, value) =>
      serial(async () => {
        const characters = Array.from(value);
        const count = Math.max(1, Math.ceil(characters.length / 400));
        if (count > 512)
          throw new Error("These credentials are too large for secure device storage.");
        const key = prefix(name),
          previous = await active(key),
          bank = previous === "0" ? "1" : "0";
        const target = `${key}.${bank}`;
        await clearBank(target);
        // Record planned chunks before writing them. Interrupted writes remain removable.
        await store.setItem(target, String(count));
        for (let index = 0; index < count; index++)
          await store.setItem(
            `${target}.${index}`,
            characters.slice(index * 400, (index + 1) * 400).join(""),
          );
        await store.setItem(key, bank);
        // The pointer is the commit. A cleanup error must not report this saved
        // value as failed. clearBank retains its header for the next write or
        // explicit sign-out to retry, and sign-out still reports deletion errors.
        if (previous !== null) await clearBank(`${key}.${previous}`).catch(() => {});
      }),
    removeItem: (name) =>
      serial(async () => {
        const key = prefix(name);
        // Both banks include interrupted writes as well as the active session.
        await clearBank(`${key}.0`);
        await clearBank(`${key}.1`);
        await store.removeItem(key);
      }),
  };
}
