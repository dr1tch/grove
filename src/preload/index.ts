import { contextBridge, ipcRenderer, webUtils } from "electron";
const drops = new Map<number, { paths: string[]; expires: number }>();
const pastes = new Map<number, number>();
window.addEventListener(
  "drop",
  (event) => {
    if (!event.isTrusted || !event.dataTransfer?.files.length) return;
    for (const [stamp, drop] of drops) if (drop.expires < Date.now()) drops.delete(stamp);
    drops.set(event.timeStamp, {
      paths: [...event.dataTransfer.files]
        .map((file) => webUtils.getPathForFile(file))
        .filter(Boolean),
      expires: Date.now() + 10000,
    });
  },
  true,
);
window.addEventListener(
  "paste",
  (event) => {
    if (
      event.isTrusted &&
      [...(event.clipboardData?.items || [])].some((item) => item.type.startsWith("image/"))
    ) {
      pastes.clear();
      pastes.set(event.timeStamp, Date.now() + 10000);
    }
  },
  true,
);
const methods = [
  "state",
  "persist",
  "openFolder",
  "list",
  "fonts",
  "copyText",
  "mkdir",
  "rename",
  "trashEntry",
  "read",
  "write",
  "create",
  "checkpoint",
  "versions",
  "restore",
  "trash",
  "trashList",
  "undelete",
  "asset",
  "inspect",
  "openPreview",
  "previewInfo",
  "closePreview",
  "external",
  "saveCopy",
  "window",
  "agent",
  "chooseAttachments",
  "startSearch",
  "cancelSearch",
  "validateSearchHit",
  "linksFor",
  "planRenameLinks",
  "applyRenamePlan",
  "linkRenameRecovery",
  "htmlPreview",
  "revokeHtmlPreview",
  "prepareExport",
  "finishExport",
  "cancelExport",
  "syncStatus",
  "syncConnect",
  "syncNow",
  "syncDisable",
  "exportInfo",
  "exportReady",
];
const api: Record<string, unknown> = {};
api.importDropped = async (notePath: string, stamp: number, root: string) => {
  const drop = drops.get(stamp);
  drops.delete(stamp);
  if (!drop || drop.expires < Date.now() || !drop.paths.length)
    throw new Error("Drop files from your file manager, or use Attach file.");
  const result = await ipcRenderer.invoke("folio:importAttachments", notePath, drop.paths, root);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
api.pasteScreenshot = async (notePath: string, stamp: number, root: string) => {
  const expires = pastes.get(stamp);
  pastes.delete(stamp);
  if (!expires || expires < Date.now()) throw new Error("Paste an image from your clipboard.");
  const result = await ipcRenderer.invoke("folio:pasteScreenshot", notePath, root);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
for (const method of methods)
  api[method] = async (...args: unknown[]) => {
    const exportMethod =
      new URLSearchParams(location.search).has("export") &&
      ["read", "asset", "inspect"].includes(method)
        ? `export${method[0].toUpperCase()}${method.slice(1)}`
        : method;
    const result = await ipcRenderer.invoke(`folio:${exportMethod}`, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
for (const [method, channel] of [
  ["onChange", "folio:change"],
  ["onOpen", "folio:open"],
])
  api[method] = (callback: (path: string) => void) => {
    const listener = (_event: unknown, path: string) => callback(path);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
api.onSearch = (callback: (batch: unknown) => void) => {
  const listener = (_event: unknown, batch: unknown) => callback(batch);
  ipcRenderer.on("folio:search", listener);
  return () => ipcRenderer.removeListener("folio:search", listener);
};
api.onSync = (callback: (status: unknown) => void) => {
  const listener = (_event: unknown, status: unknown) => callback(status);
  ipcRenderer.on("folio:sync", listener);
  return () => ipcRenderer.removeListener("folio:sync", listener);
};
contextBridge.exposeInMainWorld("folio", api);
