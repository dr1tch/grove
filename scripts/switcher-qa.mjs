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
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  await page.locator('.file-tree .file-row[data-path="Other.md"]').dblclick();
  await page.locator('.tab.active[data-path="Other.md"]').waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Quick file switcher" }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Find a file" }).fill("rcpt");
  await page.keyboard.press("Shift+Enter");
  await page.locator('.document-pane[data-pane="secondary"] canvas').waitFor();
  assert.equal(await page.locator(".document-pane").count(), 2);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "Quick file switcher" }).count(), 0);
  console.log("PASS: MRU ordering, keyboard switch, fuzzy path, open beside and Escape:", temp);
} finally {
  await app?.close();
}
