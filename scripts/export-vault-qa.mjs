const reviewRepo = process.cwd();
process.chdir(reviewRepo);
import { createRequire } from "node:module";
const { _electron: electron } = createRequire(reviewRepo + "/package.json")("playwright");
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
const temp = await mkdtemp(tmpdir() + "/grove-review-scope-"),
  a = temp + "/a",
  b = temp + "/b",
  profile = temp + "/profile";
for (const p of [a, b, profile]) await mkdir(p);
await writeFile(a + "/note.md", "# PRIVATE A");
await writeFile(b + "/note.md", "# PUBLIC B");
await writeFile(profile + "/state.json", JSON.stringify({ vault: a }));
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", "--user-data-dir=" + profile],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForTimeout(1000);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    a,
  );
  await page.locator('.file-tree .file-row[data-path="note.md"]').click();
  await page.getByRole("button", { name: "Document menu", exact: true }).click();
  await page.getByRole("button", { name: "Export note…", exact: true }).click();
  await page.getByRole("dialog", { name: "Export note", exact: true }).waitFor();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("folio:prepareExport");
    ipcMain.handle("folio:prepareExport", (e, request, root) => {
      globalThis.reviewRequest = { request, root };
      return { ok: false, error: "Review probe" };
    });
  });
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    b,
  );
  await page.waitForTimeout(600);
  const remaining = page.getByRole("dialog", {
    name: "Export note",
    exact: true,
  });
  if (await remaining.count()) {
    await page.getByRole("button", { name: "Prepare export", exact: true }).click();
    console.log("requested export", await app.evaluate(() => globalThis.reviewRequest));
    throw new Error("FAIL: old export dialog survives a vault change");
  }
  console.log("PASS: vault change dismissed the originating export snapshot");
  console.log("fixture", temp);
} finally {
  await app?.close();
}
