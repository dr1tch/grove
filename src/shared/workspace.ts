export function conflictCopyPath(path: string, stamp = Date.now()): string {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash + 1);
  const filename = path.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const split = dot > 0 ? dot : filename.length;
  return `${folder}${filename.slice(0, split)} (conflict ${stamp})${filename.slice(split)}`;
}
export function draftMoves(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  root: string,
  from: string,
  to: string,
): { oldKey: string; newKey: string; path: string; value: string; displaced: string | null }[] {
  const prefix = `folio:draft:${root}:`;
  const result = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const path = key.slice(prefix.length);
    if (path !== from && !path.startsWith(from + "/")) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    const target = to + path.slice(from.length);
    const newKey = prefix + target;
    result.push({ oldKey: key, newKey, path: target, value, displaced: storage.getItem(newKey) });
  }
  return result;
}
