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
  await page.getByRole("button", { name: "Open beside", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  const right = page.locator('.document-pane[data-pane="secondary"]'),
    left = page.locator('.document-pane[data-pane="primary"]');
  await right.getByRole("button", { name: "Edit", exact: true }).click();
  await right.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Shared edit");
  await left.getByRole("button", { name: "Edit", exact: true }).click();
  await left.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cm-content")].every((e) =>
      e.textContent.includes("Shared edit"),
    ),
  );
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".save-status")].every((e) => !e.textContent.includes("Unsaved")),
  );
  await left.locator(".pane-tabs button").first().click();
  await page.locator('.file-tree .file-row[data-path="Receipt.pdf"]').dblclick();
  await left.locator("canvas").waitFor();
  assert.equal(await right.locator(".cm-content").count(), 1, "Other pane remains on note");
  await page.getByRole("separator", { name: "Resize document panes" }).focus();
  await page.keyboard.press("ArrowRight");
  const widths = await page
    .locator(".document-pane")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().width));
  assert.ok(widths[0] > widths[1]);
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Research");
  await page.getByRole("button", { name: "Save workspace", exact: true }).click();
  await page.getByRole("button", { name: "Close workspaces", exact: true }).click();
  await right.getByRole("button", { name: "Close pane", exact: true }).click();
  assert.equal(await page.locator(".document-pane").count(), 1);
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByRole("button", { name: "Open Research", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  await page.locator('.document-pane[data-pane="primary"] canvas').waitFor();
  await page.reload();
  await page.locator('.document-pane[data-pane="primary"] canvas').waitFor();
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByRole("button", { name: "Rename Research", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Research saved");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("button", { name: "Open Research saved", exact: true }).waitFor();
  const saved = await page.evaluate((root) => localStorage.getItem(`folio:presets:${root}`), vault);
  assert.ok(!saved.includes("Shared edit"), "Preset stores no document contents");
  console.log(
    "PASS: save, apply, restart, rename and reference-only two-pane workspace presets:",
    temp,
  );
} finally {
  await app?.close();
}
