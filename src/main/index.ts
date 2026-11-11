import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  net,
  shell,
  clipboard,
  nativeImage,
} from "electron";
import { readFile, writeFile, mkdir, stat, realpath, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import chokidar from "chokidar";
import { Vault } from "./vault";
import { cleanState } from "../shared/state";
import { ask } from "./agents";
import { officePDF } from "./office";
import { importAttachments } from "./attachments";
import { fingerprint, searchVault } from "./search";
import { assetBytes } from "./assets";
import type { SearchHit } from "../shared/types";
import { Links } from "./links";
import { buildHtmlPreview, htmlCSP } from "./html-preview";
import { Exports } from "./export";
import { exportCSP } from "./export-document";
import type { ExportRequest } from "../shared/types";
const exports = new Exports(
  () => win,
  () => current(),
);
const htmlPreviews = new Map<string, { vault: Vault; path: string; html: string }>();
const linkIndexes = new WeakMap<Vault, Links>();
function links() {
  const vault = current();
  let index = linkIndexes.get(vault);
  if (!index) {
    index = new Links(vault);
    linkIndexes.set(vault, index);
  }
  return index;
}
const searches = new Map<string, AbortController>();
import { kindOf } from "../shared/types";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppState, PreviewInfo } from "../shared/types";
const here = dirname(fileURLToPath(import.meta.url));
// Keep the existing profile when the displayed product name changes.
if (!app.commandLine.hasSwitch("user-data-dir"))
  app.setPath("userData", join(app.getPath("appData"), "folio"));
app.setName("Grove");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "folio",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let win: BrowserWindow;
let vault: Vault | null = null;
let state: AppState = {};
const cacheAssets = new Map<string, string>();
const previews = new Map<
  string,
  { window: BrowserWindow; vault: Vault; path: string; info: PreviewInfo }
>();
let watcher: ReturnType<typeof chokidar.watch> | undefined;
let stateQueue = Promise.resolve();
const stateFile = () => join(app.getPath("userData"), "state.json");
function saveState() {
  const snapshot = JSON.stringify(state);
  stateQueue = stateQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(app.getPath("userData"), { recursive: true });
      const temp = `${stateFile()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      const { rename } = await import("node:fs/promises");
      await rename(temp, stateFile());
    });
  return stateQueue;
}
function current() {
  if (!vault) throw new Error("Open a folder first");
  return vault;
}
async function openVault(root: string) {
  exports.cancelAll();
  htmlPreviews.clear();
  for (const search of searches.values()) search.abort();
  searches.clear();
  const resolved = await realpath(root);
  if (!(await stat(resolved)).isDirectory()) throw new Error("Choose a folder");
  await watcher?.close();
  vault = new Vault(resolved);
  if (state.vault !== resolved) {
    state.tabs = [];
    state.active = undefined;
  }
  state.vault = resolved;
  await saveState();
  watcher = chokidar.watch(resolved, {
    ignored: (path) =>
      relative(resolved, path)
        .split(/[\\/]/)
        .some((p) => p.startsWith(".") || p === "node_modules"),
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });
  const watchingVault = vault;
  watcher.on("all", (_event, path) => {
    if (vault !== watchingVault) return;
    const relativePath = relative(resolved, path);
    linkIndexes.get(watchingVault)?.invalidate(relativePath);
    void (watchingVault.observe(relativePath).catch(() => {}) || Promise.resolve()).finally(() => {
      if (win && !win.isDestroyed()) win.webContents.send("folio:change", relativePath);
    });
  });
  return { root: resolved, entries: await vault.list() };
}
function register() {
  exports.register();
  for (const method of ["previewInfo", "closePreview"]) {
    ipcMain.handle(`folio:${method}`, (event) => {
      const preview = [...previews.values()].find((p) => p.window.webContents === event.sender);
      if (!preview || event.senderFrame !== event.sender.mainFrame)
        return { ok: false, error: "Unauthorized sender" };
      if (method === "previewInfo") return { ok: true, value: preview.info };
      preview.window.close();
      return { ok: true };
    });
  }
  const methods: Record<string, (...args: any[]) => unknown> = {
    prepareExport: (request: ExportRequest) => exports.prepare(current(), request),
    finishExport: (id: string, allowOmissions: boolean) => exports.finish(id, allowOmissions),
    cancelExport: (id: string) => (id ? exports.cancel(id) : exports.cancelAll()),
    htmlPreview: async (path: string, source: string) => {
      const vault = current();
      const result = await buildHtmlPreview(vault, path, source);
      if (vault !== current()) throw new Error("The folder changed during preview");
      const token = randomUUID();
      htmlPreviews.set(token, { vault, path, html: result.html });
      if (htmlPreviews.size > 30) htmlPreviews.delete(htmlPreviews.keys().next().value!);
      return { url: `folio://html-preview/${token}`, warnings: result.warnings };
    },
    revokeHtmlPreview: (url: string) => {
      if (typeof url !== "string" || !url.startsWith("folio://html-preview/"))
        throw new Error("Invalid preview");
      htmlPreviews.delete(new URL(url).pathname.slice(1));
    },
    linksFor: (path: string) => links().forPath(path),
    planRenameLinks: (path: string, target: string) => links().plan(path, target),
    applyRenamePlan: (id: string) => links().apply(id),
    linkRenameRecovery: () => links().recovery(),
    startSearch: (id: string, query: string, path?: string) => {
      if (
        typeof id !== "string" ||
        id.length > 100 ||
        typeof query !== "string" ||
        !query.length ||
        query.length > 256 ||
        (path !== undefined && typeof path !== "string")
      )
        throw new Error("Invalid search");
      for (const search of searches.values()) search.abort();
      searches.clear();
      const source = current(),
        controller = new AbortController();
      searches.set(id, controller);
      void searchVault(
        source,
        id,
        query,
        path,
        controller.signal,
        (batch) => {
          if (!win.isDestroyed()) win.webContents.send("folio:search", batch);
        },
        join(app.getPath("userData"), "search-cache"),
      )
        .catch((error) => {
          if (!controller.signal.aborted && !win.isDestroyed())
            win.webContents.send("folio:search", {
              id,
              root: source.root,
              hits: [],
              errors: [{ path: path || "Workspace", error: String(error) }],
              done: true,
            });
        })
        .finally(() => {
          if (searches.get(id) === controller) searches.delete(id);
        });
    },
    cancelSearch: (id: string) => {
      searches.get(id)?.abort();
      searches.delete(id);
    },
    validateSearchHit: async (hit: SearchHit) => {
      if (!hit || typeof hit.path !== "string" || typeof hit.sourceHash !== "string")
        throw new Error("Invalid search result");
      return fingerprint(await assetBytes(current(), hit.path)) === hit.sourceHash;
    },
    importAttachments: (notePath: string, sources: string[]) =>
      importAttachments(current(), notePath, sources),
    chooseAttachments: async (notePath: string) => {
      const vault = current();
      const choice = await dialog.showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
      });
      if (choice.canceled) return { attachments: [], failures: [] };
      if (vault !== current()) throw new Error("The active folder changed. Try again.");
      return importAttachments(vault, notePath, choice.filePaths);
    },
    pasteScreenshot: async (notePath: string) => {
      const vault = current();
      const items = await clipboard.read();
      const item = items.find((item) => item.types.includes("image/png"));
      if (!item) throw new Error("The clipboard has no PNG image.");
      const data = await item.getType("image/png");
      const image = nativeImage.createFromBuffer(Buffer.from(await data.arrayBuffer()));
      if (image.isEmpty()) throw new Error("The clipboard has no image.");
      const folder = await mkdtemp(join(tmpdir(), "grove-paste-"));
      try {
        const file = join(
          folder,
          `Screenshot ${new Date().toISOString().replaceAll(":", "-")}.png`,
        );
        await writeFile(file, image.toPNG(), { flag: "wx" });
        return await importAttachments(vault, notePath, [file]);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
    openPreview: async (path: string) => {
      const source = current();
      await source.path(path);
      const kind = (await source.info(path)).mime === "application/pdf" ? "pdf" : kindOf(path);
      if (!["pdf", "office", "image"].includes(kind))
        throw new Error("This file has no standalone preview");
      const token = randomUUID();
      let url = `folio://app/_preview/${token}`;
      if (kind === "office") {
        const pdf = await officePDF(source, path, join(app.getPath("userData"), "office-cache"));
        cacheAssets.set(token, pdf);
        url = `folio://app/_cache/${token}`;
      }
      const preview = new BrowserWindow({
        width: 1200,
        height: 850,
        fullscreen: true,
        show: false,
        title: `${basename(path)} · Grove`,
        backgroundColor: "#1A1918",
        webPreferences: {
          preload: join(here, "../preload/index.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      previews.set(token, {
        window: preview,
        vault: source,
        path,
        info: {
          url,
          image: kind === "image" ? basename(path) : undefined,
          theme:
            state.settings?.theme === "light" ||
            (state.settings?.theme !== "dark" && !nativeTheme.shouldUseDarkColors)
              ? "light"
              : "dark",
          accent: state.settings?.accent || "emerald",
        },
      });
      preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      preview.webContents.on("will-navigate", (e) => e.preventDefault());
      preview.on("closed", () => {
        previews.delete(token);
        cacheAssets.delete(token);
      });
      try {
        await preview.loadURL("folio://app/index.html?viewer");
        preview.show();
      } catch (error) {
        preview.destroy();
        throw error;
      }
    },
    state: () => state,
    persist: async (next: AppState) => {
      if (!next || typeof next !== "object") throw new Error("Invalid state");
      // Renderer cannot replace vault authority or native window geometry.
      const { tabs, active, settings, sidebar, assistant, sidebarWidth } = next;
      state = {
        ...state,
        ...(tabs ? { tabs } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(settings ? { settings } : {}),
        ...(sidebar !== undefined ? { sidebar } : {}),
        ...(assistant !== undefined ? { assistant } : {}),
        ...(sidebarWidth !== undefined
          ? { sidebarWidth: Math.max(190, Math.min(520, sidebarWidth)) }
          : {}),
      };
      await saveState();
    },
    openFolder: async () => {
      const choice = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
      return choice.canceled ? null : openVault(choice.filePaths[0]);
    },
    list: async () => (vault ? { root: vault.root, entries: await vault.list() } : null),
    copyText: (text: string) => {
      if (typeof text !== "string" || Buffer.byteLength(text) > 20 * 1024 * 1024)
        throw new Error("Invalid clipboard text");
      return clipboard.writeText(text);
    },
    fonts: async () => {
      const { stdout } = await promisify(execFile)(
        "/usr/bin/fc-list",
        ["--format", "%{family[0]}\n"],
        { timeout: 5000, maxBuffer: 1000000 },
      );
      return [
        ...new Set(
          stdout
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b));
    },
    mkdir: (path: string) => current().mkdir(path),
    rename: (path: string, newPath: string) => current().rename(path, newPath),
    trashEntry: (path: string) => current().trashEntry(path),
    read: (path: string) => current().read(path),
    write: (path: string, content: string, hash: string) => current().write(path, content, hash),
    create: (path: string, content: string) => current().create(path, content),
    checkpoint: (path: string, content: string) => current().checkpoint(path, content),
    versions: (path: string) => current().versions(path),
    restore: (path: string, id: string, hash: string) => current().restore(path, id, hash),
    trash: (path: string, hash: string) => current().trash(path, hash),
    trashList: () => current().trashList(),
    undelete: (id: string) => current().undelete(id),
    inspect: async (path: string) => {
      const info = await current().info(path);
      return {
        path,
        name: basename(path),
        size: info.size,
        modified: info.modified,
        kind: info.mime === "application/pdf" ? "pdf" : kindOf(path),
      };
    },
    asset: async (path: string) => {
      await current().path(path);
      if (kindOf(path) === "office" && (await current().info(path)).mime !== "application/pdf") {
        const pdf = await officePDF(current(), path, join(app.getPath("userData"), "office-cache"));
        const token = randomUUID();
        cacheAssets.set(token, pdf);
        return `folio://app/_cache/${token}`;
      }
      return `folio://app/_vault/${encodeURIComponent(path)}`;
    },
    external: async (path: string, reveal: boolean) => {
      const target = await current().path(path);
      if (reveal) shell.showItemInFolder(target);
      else {
        const error = await shell.openPath(target);
        if (error) throw new Error(error);
      }
    },
    saveCopy: async (content: string) => {
      if (typeof content !== "string") throw new Error("Invalid content");
      const choice = await dialog.showSaveDialog(win, { defaultPath: "Recovered note.md" });
      if (choice.canceled || !choice.filePath) return false;
      await writeFile(choice.filePath, content, { flag: "wx" });
      return true;
    },
    window: (action: string) => {
      if (action === "minimize") win.minimize();
      if (action === "maximize") {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      }
      if (action === "close") win.close();
      if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
    },
    agent: (provider: "claude" | "codex", prompt: string, paths: string[]) =>
      ask(current(), provider, prompt, paths),
  };
  for (const [method, fn] of Object.entries(methods))
    ipcMain.handle(`folio:${method}`, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        return { ok: false, error: "Unauthorized sender" };
      try {
        if (
          [
            "write",
            "create",
            "checkpoint",
            "restore",
            "trash",
            "undelete",
            "agent",
            "mkdir",
            "rename",
            "trashEntry",
            "openPreview",
            "importAttachments",
            "pasteScreenshot",
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
          ].includes(method)
        ) {
          const scope = args.pop();
          if (scope !== current().root)
            throw new Error(
              "This action belongs to a different vault. Reopen the file and try again.",
            );
        }
        return { ok: true, value: await fn(...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Operation failed" };
      }
    });
}
async function routePath(path?: string) {
  if (!path || path.startsWith("-")) return;
  try {
    const absolute = await realpath(path);
    if ((await stat(absolute)).isDirectory()) {
      await openVault(absolute);
      win.webContents.send("folio:open", "");
    } else {
      if (
        !vault ||
        relative(vault.root, absolute).startsWith("..") ||
        isAbsolute(relative(vault.root, absolute))
      )
        await openVault(dirname(absolute));
      win.webContents.send("folio:open", relative(current().root, absolute));
    }
  } catch (e) {
    dialog.showErrorBox("Could not open path", String(e));
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (win.isMinimized()) win.restore();
    win.focus();
    void routePath(argv.filter((a) => !a.startsWith("-")).slice(app.isPackaged ? 1 : 2)[0]);
  });
  void app.whenReady().then(async () => {
    try {
      const saved = JSON.parse(await readFile(stateFile(), "utf8"));
      state = cleanState(saved);
    } catch {
      state = {};
    }
    protocol.handle("folio", async (request) => {
      const url = new URL(request.url);
      try {
        if (url.hostname === "export") return await exports.response(url.pathname.slice(1));
        if (url.hostname === "app" && url.pathname.startsWith("/_export/")) {
          const parts = url.pathname.split("/");
          return await exports.response(parts[2], decodeURIComponent(parts.slice(3).join("/")));
        }
        if (url.hostname === "html-preview") {
          const preview = htmlPreviews.get(url.pathname.slice(1));
          return preview
            ? new Response(preview.html, {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Content-Security-Policy": htmlCSP,
                  "Cache-Control": "no-store",
                },
              })
            : new Response("Preview expired", { status: 404 });
        }
        if (url.hostname !== "app") return new Response("", { status: 404 });
        if (url.hostname === "app" && url.pathname.startsWith("/_cache/")) {
          const path = cacheAssets.get(url.pathname.slice(8));
          return path
            ? net.fetch(pathToFileURL(path).toString())
            : new Response("", { status: 404 });
        }
        if (
          url.hostname === "app" &&
          (url.pathname.startsWith("/_vault/") || url.pathname.startsWith("/_preview/"))
        ) {
          const preview = url.pathname.startsWith("/_preview/")
            ? previews.get(url.pathname.slice(10))
            : undefined;
          if (url.pathname.startsWith("/_preview/") && !preview)
            return new Response("", { status: 404 });
          const source = preview?.vault || current();
          const path = preview?.path || decodeURIComponent(url.pathname.slice(8));
          const info = await source.info(path);
          const range = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
          const start = range ? Number(range[1]) : 0;
          const end = range && range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
          if (start < 0 || start > end) return new Response("", { status: 416 });
          const child = source.stream(path, start, end);
          return new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, {
            status: range ? 206 : 200,
            headers: {
              "Content-Type": info.mime,
              "Content-Length": String(end - start + 1),
              "Accept-Ranges": "bytes",
              ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
            },
          });
        }
        if (url.hostname === "app") {
          const target = join(
            here,
            "../renderer",
            decodeURIComponent(url.pathname.slice(1) || "index.html"),
          );
          if (relative(join(here, "../renderer"), target).startsWith(".."))
            return new Response("", { status: 403 });
          return net.fetch(pathToFileURL(target).toString());
        }
      } catch {
        return new Response("Not found", { status: 404 });
      }
      return new Response("", { status: 403 });
    });
    win = new BrowserWindow({
      width: Math.max(1000, state.bounds?.width || 1400),
      height: Math.max(640, state.bounds?.height || 900),
      ...(state.bounds?.x !== undefined ? { x: state.bounds.x, y: state.bounds.y } : {}),
      minWidth: 1000,
      minHeight: 640,
      frame: false,
      titleBarStyle: "hidden",
      title: "Grove",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1A1918" : "#F5F4F1",
      icon: join(here, "../renderer/grove-icon.png"),
      show: false,
      webPreferences: {
        preload: join(here, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    win.webContents.session.webRequest.onHeadersReceived((details, cb) =>
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            new URL(details.url).hostname === "html-preview"
              ? htmlCSP
              : new URL(details.url).hostname === "export"
                ? exportCSP
                : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' folio: data: blob:; font-src 'self' data:; media-src 'self' folio: blob:; worker-src 'self' blob:; connect-src 'self' folio:; object-src 'none'; frame-src folio://html-preview; base-uri 'none'",
          ],
        },
      }),
    );
    register();
    if (state.vault) {
      try {
        await openVault(state.vault);
      } catch {
        state.vault = undefined;
        state.tabs = [];
      }
    }
    win.on("close", () => {
      state.bounds = win.getNormalBounds();
      state.maximized = win.isMaximized();
      void saveState();
    });
    win.on("closed", () => {
      exports.cancelAll();
      void watcher?.close();
      for (const preview of previews.values()) preview.window.close();
    });
    const devURL = process.env.ELECTRON_RENDERER_URL;
    if (devURL && ["localhost", "127.0.0.1"].includes(new URL(devURL).hostname))
      await win.loadURL(devURL);
    else await win.loadURL("folio://app/index.html");
    if (state.maximized) win.maximize();
    win.show();
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    await routePath(args.find((a) => !a.startsWith("-")));
  });
  let finishing = false;
  app.on("before-quit", (event) => {
    if (finishing) return;
    event.preventDefault();
    finishing = true;
    void stateQueue.finally(() => app.exit());
  });
  app.on("window-all-closed", () => app.quit());
}
