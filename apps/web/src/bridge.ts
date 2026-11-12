import { kindOf } from "@grove/core/files";
import { conflictCopyName } from "@grove/core/conflicts";
import { parseLinks } from "@grove/core/links";
import { filePath } from "@grove/github-vault/types";
import type { VaultEntry } from "@grove/github-vault/types";
import type { VaultSession } from "@grove/github-vault/sync";
import type { FolioAPI, SearchBatch, SyncStatus } from "../../../src/shared/types";
import { cleanState } from "../../../src/shared/state";
import { textMatches } from "../../../src/shared/search";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const DESKTOP_ONLY = "Available in the Grove desktop app";
const unavailable = async (): Promise<never> => {
  throw new Error(DESKTOP_ONLY);
};
function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(callback: (value: T) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    emit(value: T) {
      for (const callback of listeners) {
        try {
          callback(value);
        } catch {
          /* Listeners cannot invalidate saved data. */
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
const mimeOf = (path: string) =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    wav: "audio/wav",
  })[path.split(".").pop()!.toLowerCase() as "png"] ?? "application/octet-stream";

export function createWebBridge(session?: VaultSession, options: { storage?: StorageLike } = {}) {
  const storage = options.storage ?? localStorage;
  let disposed = false,
    dirtyDraft = false;
  let entries: VaultEntry[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined,
    polling: ReturnType<typeof setInterval> | undefined;
  let flushing: Promise<SyncStatus> | undefined, prefetching: Promise<void> | undefined;
  let channel: BroadcastChannel | undefined;
  let lastHead = "";
  const changes = event<string>(),
    sync = event<SyncStatus>(),
    search = event<SearchBatch>();
  const searching = new Set<string>(),
    writing = new Set<string>();
  const urls = new Map<string, { path: string; hash: string; size: number; refs: number }>();
  let urlBytes = 0;
  const drops = new Map<number, File[]>();
  const need = (expected?: string) => {
    if (!session || disposed) throw new Error("Sign in first");
    if (expected !== undefined && expected !== session.store.root)
      throw new Error("The vault changed. Reopen the file before saving.");
    return session;
  };
  const stateKey = () => `grove:web:state:${need().store.root}`;
  const localChange = (path: string) => {
    changes.emit(path);
    channel?.postMessage(path);
  };
  const offChange = session?.onChange((path) => {
    if (!disposed && !writing.has(path)) localChange(path);
  });
  const offSync = session?.onSync((status) => {
    if (!disposed) sync.emit(status);
  });
  const list = async () => {
    const active = need();
    if (!entries) entries = await active.list();
    const current = new Map(entries.map((entry) => [entry.path, entry]));
    for (const edit of await active.cache.pending()) {
      current.set(edit.path, {
        path: edit.path,
        name: edit.path.split("/").pop()!,
        kind: kindOf(edit.path),
        size: new TextEncoder().encode(edit.content).length,
        modified: 0,
        sha: edit.revision,
      });
      const parts = edit.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const path = parts.slice(0, index).join("/");
        if (!current.has(path))
          current.set(path, {
            path,
            name: parts[index - 1],
            kind: "folder",
            size: 0,
            modified: 0,
            sha: "",
          });
      }
    }
    return { root: active.store.root, entries: [...current.values()] };
  };
  const read = async (path: string) => {
    filePath(path);
    const active = need(),
      pending = (await active.cache.pending()).find((edit) => edit.path === path);
    if (pending) return { path, content: pending.content, hash: pending.revision, modified: 0 };
    const expected = (await list()).entries.find((entry) => entry.path === path);
    const cached = await active.cache.getDocument(path);
    if (
      cached?.hash &&
      expected &&
      (cached.hash === expected.sha || expected.sha.startsWith("local:"))
    )
      return cached;
    return active.read(path);
  };
  const refresh = async () => {
    const active = need(),
      previous = new Map(entries?.map((entry) => [entry.path, entry.sha]));
    entries = await active.list();
    need();
    const next = new Map(entries.map((entry) => [entry.path, entry.sha]));
    for (const path of new Set([...previous.keys(), ...next.keys()]))
      if (previous.get(path) !== next.get(path)) changes.emit(path);
  };
  const prefetch = () => {
    if (prefetching) return prefetching;
    prefetching = (async () => {
      const notes = (await list()).entries
        .filter((entry) => entry.kind === "markdown" && entry.size <= 1024 * 1024)
        .slice(0, 300);
      let budget = 50 * 1024 * 1024;
      for (const note of notes) {
        if (disposed || note.size > budget) break;
        budget -= note.size;
        try {
          await read(note.path);
        } catch {
          /* Search remains available over successfully cached text. */
        }
      }
    })().finally(() => {
      prefetching = undefined;
    });
    return prefetching;
  };
  const flush = (): Promise<SyncStatus> => {
    if (flushing) return flushing;
    flushing = (async () => {
      const active = need();
      // One tab syncs a vault at a time; parallel tabs would upload stale queued bases.
      const status = await (globalThis.navigator?.locks
        ? navigator.locks.request(`grove-sync:${active.store.root}`, () => active.syncNow())
        : active.syncNow());
      if (!disposed && !["offline", "error"].includes(status.state)) {
        await refresh();
        if ((await active.cache.pending()).length) schedule();
      }
      return status;
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!disposed) void flush().catch(() => {});
    }, 1500);
  };
  const releaseAsset = async (url: string) => {
    const record = urls.get(url);
    if (!record || --record.refs > 0) return;
    URL.revokeObjectURL(url);
    urls.delete(url);
    urlBytes -= record.size;
  };
  const makeURL = (path: string, hash: string, bytes: Uint8Array, mime: string) => {
    for (const [url, record] of urls)
      if (record.path === path && record.hash === hash) {
        record.refs++;
        return url;
      }
    if (urlBytes + bytes.length > 128 * 1024 * 1024 || urls.size >= 256)
      throw new Error("Close another preview before opening more media.");
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    urls.set(url, { path, hash, size: bytes.length, refs: 1 });
    urlBytes += bytes.length;
    return url;
  };
  const checkpoint = async (path: string, content: string, root: string) => {
    const active = need(root);
    const used = new Set((await list()).entries.map((entry) => entry.path));
    const target = conflictCopyName(path, "browser recovery", new Date(), (candidate) =>
      used.has(candidate),
    );
    await active.create(target, content);
    schedule();
  };
  const upload = async (files: File[], root: string) => {
    const active = need(root),
      attachments = [],
      failures = [];
    for (const file of files.slice(0, 20)) {
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error("File exceeds 50 MiB.");
        const clean = file.name.replace(/[\\/]/g, "-").replace(/^\.+/, "") || "attachment";
        const dot = clean.lastIndexOf("."),
          stem = dot > 0 ? clean.slice(0, dot) : clean,
          ext = dot > 0 ? clean.slice(dot) : "";
        const used = new Set((await list()).entries.map((entry) => entry.path));
        let path = `attachments/${clean}`;
        for (let index = 2; used.has(path); index++) path = `attachments/${stem} ${index}${ext}`;
        await active.createBytes(path, new Uint8Array(await file.arrayBuffer()));
        need(root);
        entries = undefined;
        attachments.push({ path, kind: kindOf(path), copied: true });
      } catch (error) {
        failures.push({
          name: file.name,
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    }
    return { attachments, failures };
  };
  const captureDrop = (event: DragEvent) => {
    if (event.isTrusted && event.dataTransfer?.files.length) {
      drops.clear();
      drops.set(event.timeStamp, [...event.dataTransfer.files]);
    }
  };
  const capturePaste = (event: ClipboardEvent) => {
    if (event.isTrusted && event.clipboardData?.files.length) {
      drops.clear();
      drops.set(event.timeStamp, [...event.clipboardData.files]);
    }
  };
  const consumeFiles = async (_path: string, stamp: number, root: string) => {
    const files = drops.get(stamp);
    drops.delete(stamp);
    if (!files) throw new Error("Drop files or paste an image from your clipboard.");
    return upload(files, root);
  };
  const api: FolioAPI = {
    platform: "web",
    releaseAsset,
    state: async () => {
      if (!session || disposed) return {};
      const saved = cleanState(JSON.parse(storage.getItem(stateKey()) || "{}"));
      return {
        ...saved,
        vault: session.store.root,
        assistant: false,
        sync: { [session.store.root]: { enabled: true } },
      };
    },
    persist: async (partial) => {
      const saved = await api.state();
      storage.setItem(
        stateKey(),
        JSON.stringify(
          cleanState({ ...saved, ...partial, assistant: false, vault: need().store.root }),
        ),
      );
    },
    list: async () => (session && !disposed ? list() : null),
    openFolder: unavailable,
    fonts: async () => ["system-ui"],
    copyText: async (text) => {
      await navigator.clipboard.writeText(text);
    },
    read,
    inspect: async (path) => {
      filePath(path);
      const found = (await list()).entries.find((entry) => entry.path === path);
      if (!found) throw new Error("File not found in this vault");
      return found;
    },
    write: async (path, content, hash, root) => {
      const active = need(root);
      writing.add(path);
      try {
        const result = await active.write(path, content, hash);
        if (result.status === "saved") {
          schedule();
          channel?.postMessage(path);
        }
        return result;
      } finally {
        writing.delete(path);
      }
    },
    create: async (path, content, root) => {
      const active = need(root);
      writing.add(path);
      try {
        const result = await active.create(path, content);
        schedule();
        channel?.postMessage(path);
        return result;
      } finally {
        writing.delete(path);
      }
    },
    mkdir: async (path, root) => {
      await need(root).mkdir(path);
      entries = undefined;
    },
    rename: async (path, target, root) => {
      await need(root).rename(path, target);
      entries = undefined;
    },
    checkpoint,
    versions: async (path) => need().versions(path),
    restore: async (path, id, hash, root) => {
      const active = need(root);
      const version = (await active.versions(path)).find((version) => version.id === id);
      if (!version) throw new Error("Version no longer available");
      return api.write(path, version.content, hash, root);
    },
    trash: unavailable,
    trashEntry: unavailable,
    trashList: unavailable,
    undelete: unavailable,
    asset: async (path) => {
      const active = need();
      if (kindOf(path) === "office") throw new Error(DESKTOP_ONLY);
      const bytes = await active.assetBytes(path);
      need();
      const cached = await active.cache.getAsset(path);
      return makeURL(path, cached?.hash ?? "", bytes, mimeOf(path));
    },
    openPreview: unavailable,
    previewInfo: unavailable,
    closePreview: unavailable,
    external: unavailable,
    saveCopy: async (content) => {
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "Note.md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    },
    window: async (action) => {
      if (action !== "fullscreen") throw new Error(DESKTOP_ONLY);
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    },
    draftsPending: async (value) => {
      dirtyDraft = value;
    },
    agent: unavailable,
    syncConnect: unavailable,
    syncDisable: unavailable,
    syncStatus: async (root) => need(root).status(),
    syncNow: async (root) => {
      need(root);
      return flush();
    },
    onSync: (callback) => sync.on(callback),
    onChange: (callback) => changes.on(callback),
    onSearch: (callback) => search.on(callback),
    onOpen: () => () => {},
    onCloseRequest: () => () => {},
    startSearch: async (id, query, path, root) => {
      const active = need(root);
      searching.add(id);
      void (async () => {
        const hits = [],
          errors = [];
        try {
          await prefetch();
          const pending = new Map((await active.cache.pending()).map((edit) => [edit.path, edit]));
          for (const entry of (await list()).entries) {
            if (!searching.has(id) || disposed) return;
            if (path && entry.path !== path && !entry.path.startsWith(path + "/")) continue;
            const queued = pending.get(entry.path);
            const doc = queued
              ? { path: queued.path, content: queued.content, hash: queued.revision }
              : await active.cache.getDocument(entry.path);
            if (!doc) continue;
            for (const match of textMatches(doc.content, query, 1000 - hits.length))
              hits.push({ ...match, path: entry.path, sourceHash: doc.hash });
            if (hits.length >= 1000) break;
          }
        } catch {
          errors.push({
            path: "",
            error: "Search covers opened text files and up to 300 cached notes.",
          });
        }
        if (searching.delete(id) && !disposed)
          search.emit({ id, root, hits, errors, done: true, truncated: hits.length >= 1000 });
      })();
    },
    cancelSearch: async (id, root) => {
      need(root);
      searching.delete(id);
    },
    validateSearchHit: async (hit, root) => {
      need(root);
      const doc = await read(hit.path);
      return doc.hash === hit.sourceHash && hit.from >= 0 && hit.to <= doc.content.length;
    },
    linksFor: async (path, root) => {
      const active = need(root);
      await prefetch();
      const files = (await list()).entries
          .filter((entry) => entry.kind !== "folder")
          .map((entry) => entry.path),
        all = [];
      for (const file of files) {
        if (kindOf(file) !== "markdown") continue;
        const doc = await active.cache.getDocument(file);
        if (doc) all.push(...parseLinks(file, doc.content, files));
      }
      return {
        incoming: all.filter(
          (link) => link.targetPath === path && !link.missing && !link.ambiguous,
        ),
        outgoing: all.filter((link) => link.sourcePath === path),
        broken: all.filter((link) => link.missing || link.ambiguous),
      };
    },
    planRenameLinks: unavailable,
    applyRenamePlan: unavailable,
    linkRenameRecovery: async () => null,
    htmlPreview: async (path, source, root) => {
      need(root);
      filePath(path);
      if (source.length > 20 * 1024 * 1024) throw new Error("HTML exceeds the preview limit");
      const template = document.createElement("template");
      template.innerHTML = source;
      const safe = new Set(
        "div span p h1 h2 h3 h4 h5 h6 a ul ol li table thead tbody tfoot tr th td caption blockquote pre code strong em b i u s small sub sup br hr details summary figure figcaption dl dt dd q abbr time mark kbd samp var section article main header footer".split(
          " ",
        ),
      );
      for (const element of template.content.querySelectorAll("*")) {
        if (!safe.has(element.tagName.toLowerCase())) {
          element.remove();
          continue;
        }
        while (element.attributes.length) element.removeAttribute(element.attributes[0].name);
      }
      const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>body{font:16px/1.6 system-ui;padding:24px;overflow-wrap:anywhere}pre{white-space:pre-wrap}</style>${template.innerHTML}`;
      const url = makeURL(`html:${path}`, source, new TextEncoder().encode(html), "text/html");
      return {
        url,
        warnings: ["Browser HTML previews omit styles, scripts, forms and embedded resources."],
      };
    },
    revokeHtmlPreview: async (url, root) => {
      need(root);
      await releaseAsset(url);
    },
    prepareExport: unavailable,
    finishExport: unavailable,
    cancelExport: unavailable,
    exportInfo: unavailable,
    exportReady: unavailable,
    importDropped: consumeFiles,
    pasteScreenshot: consumeFiles,
    chooseAttachments: async (_path, root) => {
      need(root);
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      const files = await new Promise<File[]>((resolve) => {
        input.onchange = () => resolve([...(input.files ?? [])]);
        input.addEventListener("cancel", () => resolve([]), { once: true });
        input.click();
      });
      return upload(files, root);
    },
  };
  const online = () => {
    if (!disposed) void flush().catch(() => {});
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirtyDraft) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  return Object.assign(api, {
    canSignOut: () => !dirtyDraft,
    start: () => {
      need();
      window.addEventListener("drop", captureDrop, true);
      window.addEventListener("paste", capturePaste, true);
      window.addEventListener("online", online);
      window.addEventListener("beforeunload", beforeUnload);
      channel = new BroadcastChannel(`grove:${session!.store.root}`);
      channel.onmessage = (message) => {
        if (typeof message.data === "string") {
          try {
            filePath(message.data);
            changes.emit(message.data);
          } catch {
            /* Ignore malformed cross-tab notifications. */
          }
        }
      };
      polling = setInterval(() => {
        if (document.visibilityState === "visible")
          void (async () => {
            try {
              const head = await need().head();
              if (lastHead && head !== lastHead) await refresh();
              lastHead = head;
              if ((await need().cache.pending()).length) online();
            } catch {
              online();
            }
          })();
      }, 60_000);
      schedule();
      void prefetch().catch(() => {});
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(polling);
      offChange?.();
      offSync?.();
      session?.dispose();
      changes.clear();
      sync.clear();
      search.clear();
      searching.clear();
      channel?.close();
      for (const url of urls.keys()) URL.revokeObjectURL(url);
      urls.clear();
      urlBytes = 0;
      drops.clear();
      if (typeof window !== "undefined") {
        window.removeEventListener("drop", captureDrop, true);
        window.removeEventListener("paste", capturePaste, true);
        window.removeEventListener("online", online);
        window.removeEventListener("beforeunload", beforeUnload);
      }
    },
  });
}
