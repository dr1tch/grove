import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
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
await writeFile(join(vault, "Note.md"), "[Other](Other.md)");
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
  await page.getByRole("button", { name: "Backlinks and broken links", exact: true }).click();
  await page.locator(".backlinks-panel").getByText("Other.md", { exact: true }).waitFor();
  await page.locator('.file-tree .file-row[data-path="Other.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByLabel("New path", { exact: true }).fill("Renamed.md");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await page.locator(".rename-preview").getByText("Note.md → Note.md", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.locator('.file-tree .file-row[data-path="Renamed.md"]').waitFor();
  assert.equal(await readFile(join(vault, "Note.md"), "utf8"), "[Other](Renamed.md)");
  await page.locator('.file-tree .file-row[data-path="Renamed.md"]').dblclick();
  await page.locator(".backlinks-panel").getByText("Note.md", { exact: true }).waitFor();
  console.log("PASS: outgoing/backlinks, rename preview and safe reference updates:", temp);
} finally {
  await app?.close();
}
