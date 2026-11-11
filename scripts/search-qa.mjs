import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-panes-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "Note.md"), "# Notes\n\n" + "A paragraph for reading.\n\n".repeat(100));
await writeFile(join(vault, "Other.md"), "# Other\n");
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "Receipt.pdf"));
const benchmark = join(temp, "benchmark");
await mkdir(benchmark);
await Promise.all(
  Array.from({ length: 1000 }, (_, i) =>
    writeFile(
      join(benchmark, `file-${String(i).padStart(4, "0")}.txt`),
      i === 999 ? "benchmark sentinel" : "plain benchmark file",
    ),
  ),
);
const executable = process.env.FOLIO_SMOKE_EXECUTABLE;
let app;
try {
  app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: ["--ozone-platform=x11", ...(executable ? [] : ["."]), `--user-data-dir=${profile}`],
  });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  if (executable) await page.locator(".tabs").waitFor();
  else await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) =>
      app.emit("second-instance", {}, app.isPackaged ? ["folio", root] : ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  await page.keyboard.press("Control+Shift+f");
  const input = page.getByRole("textbox", { name: "Search file contents" });
  await input.fill("paragraph");
  await page.waitForFunction(() =>
    document.querySelector('.search-panel [role="status"]').textContent.includes("100 matches"),
  );
  await page.locator(".search-results button").first().click();
  await page.locator(".cm-search-hit").first().waitFor();
  await input.fill("Montant");
  await page.locator(".search-results button").filter({ hasText: "Receipt.pdf" }).first().click();
  await page.locator(".pdf-search-layer mark.active").waitFor();
  const box = await page.locator(".pdf-search-layer mark.active").first().boundingBox();
  assert.ok(box.width > 1 && box.height > 1);
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox", { name: "Search file contents" }).fill("First");
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await app.evaluate(
    ({ app }, root) =>
      app.emit("second-instance", {}, app.isPackaged ? ["folio", root] : ["electron", "app", root]),
    benchmark,
  );
  await page.locator('.file-row[data-path="file-0999.txt"]').waitFor();
  const metrics = await page.evaluate(
    async (root) =>
      new Promise((resolve, reject) => {
        const id = crypto.randomUUID(),
          start = performance.now();
        let count = 0;
        const timer = setTimeout(() => reject(new Error("Benchmark timeout")), 120000);
        const off = window.folio.onSearch((batch) => {
          if (batch.id !== id) return;
          count += batch.hits.length;
          if (batch.errors.length) reject(new Error(JSON.stringify(batch.errors)));
          if (batch.done) {
            clearTimeout(timer);
            off();
            resolve({ milliseconds: Math.round(performance.now() - start), matches: count });
          }
        });
        void window.folio.startSearch(id, "sentinel", undefined, root).catch(reject);
      }),
    benchmark,
  );
  assert.equal(metrics.matches, 1);
  console.log("1,000-file benchmark:", metrics);
  console.log(
    "PASS: note content matches/highlights and PDF extraction, navigation and painted highlight:",
    temp,
  );
} finally {
  await app?.close();
}
