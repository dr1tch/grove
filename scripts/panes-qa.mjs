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
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  await page.locator('.document-pane[data-pane="primary"] canvas').waitFor();
  assert.ok(
    (
      await page.locator('.document-pane[data-pane="secondary"] .cm-content').textContent()
    ).includes("Shared edit"),
  );
  assert.ok((await readFile(join(vault, "Note.md"), "utf8")).includes("Shared edit"));
  await right.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Pending edit");
  await writeFile(join(vault, "Note.md"), "# External replacement\n");
  await page.getByRole("button", { name: "Keep mine", exact: true }).waitFor();
  await page.getByRole("button", { name: "Keep mine", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".banner.warning"));
  assert.ok((await readFile(join(vault, "Note.md"), "utf8")).includes("Pending edit"));
  const otherVault = join(temp, "second-vault");
  await mkdir(otherVault);
  await writeFile(join(otherVault, "Only-here.md"), "# Second vault");
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    otherVault,
  );
  await page.locator('.file-row[data-path="Only-here.md"]').waitFor();
  await page.waitForFunction(() => !document.querySelector(".pane-header"));
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  await page.locator('.document-pane[data-pane="secondary"] .cm-content').waitFor();
  await page
    .locator('.document-pane[data-pane="secondary"]')
    .getByRole("button", { name: "Close pane", exact: true })
    .click();
  assert.equal(await page.locator(".document-pane").count(), 1);
  console.log(
    "PASS: shared note edits, independent PDF/note panes, active-pane opening, keyboard divider, restart and close-pane. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
