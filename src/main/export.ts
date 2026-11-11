import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { Vault } from "./vault";
import type { ExportInfo, ExportRequest, PreparedExport } from "../shared/types";
import { parseLinks } from "../shared/links";
import { portableDocument, exportLimit } from "./export-document";
import { destinationIdentity, publishOutput } from "./publish";
const here = dirname(fileURLToPath(import.meta.url)),
  renderer = join(here, "../renderer");
type Job = {
  id: string;
  vault: Vault;
  info: ExportInfo;
  allowed: Set<string>;
  window: BrowserWindow;
  html?: string;
  print?: BrowserWindow;
  bytes?: Buffer;
  warnings: string[];
  resolve: (info: PreparedExport) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
async function bundledCSS() {
  const folder = join(renderer, "assets"),
    file = (await readdir(folder)).find((name) => /^index-.*\.css$/.test(name));
  if (!file) throw new Error("Export styles are missing");
  let css = await readFile(join(folder, file), "utf8");
  const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)],
    fonts = new Map<string, string>();
  for (const match of urls) {
    const url = match[1];
    if (url.startsWith("data:")) continue;
    let replacement = "";
    if (/\.(woff2?|ttf|otf)$/i.test(url)) {
      const path = await realpath(join(folder, url));
      if (relative(renderer, path).startsWith("..")) throw new Error("Invalid bundled font");
      if (!fonts.has(path))
        fonts.set(
          path,
          `data:font/${extname(path).slice(1)};base64,${(await readFile(path)).toString("base64")}`,
        );
      replacement = fonts.get(path)!;
    }
    css = css.replaceAll(match[0], `url("${replacement}")`);
  }
  return css;
}
export class Exports {
  private jobs = new Map<string, Job>();
  private windows = new Map<number, Job>();
  constructor(
    private parent: () => BrowserWindow,
    private current: () => Vault,
  ) {}
  register() {
    for (const method of [
      "exportInfo",
      "exportAsset",
      "exportRead",
      "exportInspect",
      "exportReady",
    ])
      ipcMain.handle(`folio:${method}`, async (event, ...args) => {
        const job = this.windows.get(event.sender.id);
        if (!job || event.senderFrame !== event.sender.mainFrame)
          return { ok: false, error: "Unauthorized export sender" };
        try {
          if (method === "exportInfo") return { ok: true, value: job.info };
          if (method === "exportReady") {
            await this.rendered(job, args[0], args[1]);
            return { ok: true };
          }
          const path = args[0];
          if (typeof path !== "string" || !job.allowed.has(path))
            throw new Error("Asset is outside this note");
          if (method === "exportRead") return { ok: true, value: await job.vault.read(path) };
          if (method === "exportAsset")
            return { ok: true, value: `folio://app/_export/${job.id}/${encodeURIComponent(path)}` };
          const info = await job.vault.info(path);
          return {
            ok: true,
            value: {
              path,
              name: path.split("/").pop(),
              kind: info.mime === "application/pdf" ? "pdf" : "image",
              ...info,
            },
          };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
  }
  private secure(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
  }
  async prepare(vault: Vault, request: ExportRequest): Promise<PreparedExport> {
    if (
      !request ||
      typeof request.path !== "string" ||
      !request.path.match(/\.(md|markdown)$/i) ||
      typeof request.content !== "string" ||
      Buffer.byteLength(request.content) > 20 * 1024 * 1024 ||
      !["html", "pdf"].includes(request.format) ||
      !["light", "dark"].includes(request.theme)
    )
      throw new Error("Choose a Markdown note to export");
    const info = await vault.info(request.path),
      paths = (await vault.list()).map((e) => e.path),
      id = randomUUID();
    if (vault !== this.current()) throw new Error("The folder changed during export");
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 1000,
      parent: this.parent(),
      webPreferences: {
        preload: join(here, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    this.secure(window);
    const contentId = window.webContents.id;
    const promise = new Promise<PreparedExport>((resolve, reject) => {
      const job: Job = {
        id,
        vault,
        window,
        info: {
          ...request,
          id,
          document: {
            path: request.path,
            content: request.content,
            hash: createHash("sha256").update(request.content).digest("hex"),
            modified: info.modified,
          },
        },
        allowed: new Set(
          parseLinks(request.path, request.content, paths).map((ref) => ref.targetPath),
        ),
        warnings: [],
        resolve,
        reject,
        timer: setTimeout(() => {
          reject(new Error("Export rendering timed out"));
          this.cancel(id);
        }, 30000),
      };
      this.jobs.set(id, job);
      this.windows.set(window.webContents.id, job);
      window.webContents.once("render-process-gone", () => {
        reject(new Error("Export renderer closed"));
        this.cancel(id);
      });
    });
    void promise.catch(() => {});
    try {
      await window.loadURL(`folio://app/index.html?export=${id}`);
      return await promise;
    } catch (error) {
      this.cancel(id);
      throw error;
    } finally {
      this.windows.delete(contentId);
      if (!window.isDestroyed()) window.destroy();
    }
  }
  private async rendered(job: Job, html: unknown, warnings: unknown) {
    if (job.bytes) return;
    if (
      typeof html !== "string" ||
      Buffer.byteLength(html) > exportLimit ||
      !Array.isArray(warnings)
    )
      throw new Error("Invalid export document");
    try {
      const portable = await portableDocument(job.vault, job.info, html, await bundledCSS());
      job.html = portable.html;
      job.warnings = [
        ...portable.warnings,
        ...warnings.filter((w): w is string => typeof w === "string").slice(0, 100),
      ];
      if (job.info.format === "pdf") {
        const print = new BrowserWindow({
          show: false,
          width: 1100,
          height: 1000,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
          },
        });
        this.secure(print);
        job.print = print;
        try {
          await print.loadURL(`folio://export/${job.id}`);
          await print.webContents.executeJavaScript(
            "Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode().catch(()=>{}))])",
          );
          job.bytes = await print.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
          });
        } finally {
          if (!print.isDestroyed()) print.destroy();
          job.print = undefined;
        }
      } else job.bytes = Buffer.from(job.html);
      clearTimeout(job.timer);
      job.resolve({
        id: job.id,
        size: job.bytes.length,
        warnings: job.warnings,
        format: job.info.format,
      });
    } catch (error) {
      clearTimeout(job.timer);
      job.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  async response(id: string, path?: string): Promise<Response> {
    const job = this.jobs.get(id);
    if (!job) return new Response("", { status: 404 });
    if (path === undefined)
      return job.html
        ? new Response(job.html, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          })
        : new Response("", { status: 404 });
    if (!job.allowed.has(path)) return new Response("", { status: 403 });
    const info = await job.vault.info(path),
      child = job.vault.stream(path);
    return new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": info.mime },
    });
  }
  async finish(id: string, allowOmissions: boolean) {
    const job = this.jobs.get(id);
    if (!job?.bytes || job.vault !== this.current())
      throw new Error("Export expired or folder changed");
    if (job.warnings.length && !allowOmissions)
      throw new Error("Review the omitted assets before saving");
    const choice = await dialog.showSaveDialog(this.parent(), {
      defaultPath: job.info.path.replace(/\.(md|markdown)$/i, `.${job.info.format}`),
      filters: [{ name: job.info.format.toUpperCase(), extensions: [job.info.format] }],
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    if (job.vault !== this.current() || !this.jobs.has(id))
      throw new Error("Folder changed. Prepare the export again.");
    const identity = await destinationIdentity(choice.filePath);
    const result = await publishOutput(choice.filePath, job.bytes, identity);
    this.cancel(id);
    return { saved: true, ...result };
  }
  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    if (job.print && !job.print.isDestroyed()) job.print.destroy();
    job.reject(new Error("Export canceled"));
    if (!job.window.isDestroyed()) {
      this.windows.delete(job.window.webContents.id);
      job.window.destroy();
    }
    this.jobs.delete(id);
  }
  cancelAll() {
    for (const id of this.jobs.keys()) this.cancel(id);
  }
}
