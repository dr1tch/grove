import { createHash } from "node:crypto";
import { assetBytes } from "./assets";
import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { SearchBatch, SearchHit } from "../shared/types";
import { textMatches, pdfPageText } from "../shared/search";
import type { Vault } from "./vault";
export const fingerprint = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export async function searchVault(
  vault: Vault,
  id: string,
  query: string,
  path: string | undefined,
  signal: AbortSignal,
  send: (batch: SearchBatch) => void,
  cache?: string,
) {
  const entries = (await vault.list()).filter(
    (e) =>
      e.kind !== "folder" &&
      !e.path.split("/").some((p) => p === "node_modules" || p.startsWith(".")) &&
      (!path || e.path === path),
  );
  let cursor = 0,
    total = 0;
  const batch = (hits: SearchHit[], errors: SearchBatch["errors"] = []) => {
    if (!signal.aborted) send({ id, root: vault.root, hits, errors });
  };
  const pdfPaths: string[] = [];
  await vault.searchText(
    entries
      .filter((file) => ["markdown", "text", "pdf", "unsupported"].includes(file.kind))
      .map((file) => file.path),
    query,
    signal,
    (record) => {
      if (record.pdf) pdfPaths.push(record.pdf);
      if (record.hits) {
        const hits = record.hits.slice(0, Math.max(0, 1000 - total));
        total += hits.length;
        batch(hits);
      }
      if (record.error) batch([], [record.error]);
    },
  );
  const files = pdfPaths.map((path) => ({ path, kind: "pdf" }));
  const worker = async () => {
    while (cursor < files.length && total < 1000 && !signal.aborted) {
      const file = files[cursor++];
      if (!["markdown", "text", "pdf", "unsupported"].includes(file.kind)) continue;
      try {
        const info = await vault.info(file.path);
        if (info.mime === "application/pdf") {
          const bytes = await assetBytes(vault, file.path, signal),
            hash = fingerprint(bytes);
          if (cache) {
            try {
              const cachedFile = join(cache, hash + ".json");
              if ((await stat(cachedFile)).size <= 20 * 1024 * 1024) {
                const pages: unknown = JSON.parse(await readFile(cachedFile, "utf8"));
                if (
                  Array.isArray(pages) &&
                  pages.length <= 1000 &&
                  pages.every((page) => typeof page === "string")
                ) {
                  for (const [index, text] of pages.entries()) {
                    if (signal.aborted || total >= 1000) break;
                    const hits = textMatches(text, query, 1000 - total).map((match) => ({
                      ...match,
                      path: file.path,
                      sourceHash: hash,
                      page: index + 1,
                    }));
                    total += hits.length;
                    batch(hits);
                  }
                  continue;
                }
              }
            } catch {}
          }
          const task = getDocument({
            data: new Uint8Array(bytes),
            useSystemFonts: false,
            disableFontFace: true,
            stopAtErrors: true,
          });
          const cancel = () => {
            void task.destroy();
          };
          signal.addEventListener("abort", cancel, { once: true });
          let textLength = 0;
          const cachedPages: string[] = [];
          try {
            const pdf = await task.promise;
            if (pdf.numPages > 1000) throw new Error("PDF exceeds 1,000-page search limit");
            for (let page = 1; page <= pdf.numPages && !signal.aborted && total < 1000; page++) {
              const content = await (await pdf.getPage(page)).getTextContent();
              const { text } = pdfPageText(content.items);
              textLength += text.trim().length;
              if (textLength < 8 * 1024 * 1024) cachedPages.push(text);
              const hits = textMatches(text, query, 1000 - total).map((match) => ({
                ...match,
                path: file.path,
                sourceHash: hash,
                page,
              }));
              total += hits.length;
              batch(hits);
            }
            if (cache && !signal.aborted && cachedPages.length === pdf.numPages) {
              try {
                await mkdir(cache, { recursive: true, mode: 0o700 });
                await writeFile(join(cache, hash + ".json"), JSON.stringify(cachedPages), {
                  flag: "wx",
                  mode: 0o600,
                });
                const files = await readdir(cache);
                if (files.length > 64) {
                  const ordered = await Promise.all(
                    files.map(async (name) => ({
                      name,
                      at: (await stat(join(cache, name))).mtimeMs,
                    })),
                  );
                  ordered.sort((a, b) => a.at - b.at);
                  for (const old of ordered.slice(0, ordered.length - 64))
                    await unlink(join(cache, old.name));
                }
              } catch {}
            }
            if (!textLength)
              batch([], [{ path: file.path, error: "No searchable text. This PDF may need OCR." }]);
          } finally {
            signal.removeEventListener("abort", cancel);
            await task.destroy();
          }
        }
      } catch (error) {
        if (!signal.aborted) batch([], [{ path: file.path, error: String(error) }]);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  if (!signal.aborted)
    send({ id, root: vault.root, hits: [], errors: [], done: true, truncated: total >= 1000 });
}
