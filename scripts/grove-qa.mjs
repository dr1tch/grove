import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-qa-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
for (const folder of ["src", "docs", "notes", "images", "archive"])
  await mkdir(join(vault, folder));
await writeFile(join(vault, "notes/First.md"), "# First\n\nFirst note.");
await writeFile(join(vault, "notes/Second.md"), "# Second\n\nSecond note.");
await writeFile(join(vault, "docs/Reference.md"), "# Reference");
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, settings: { theme: "light" } }),
);
await mkdir("qa-artifacts/grove", { recursive: true });
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1200);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  const open = async (path) => {
    await page.locator(`.file-tree .file-row[data-path="${path}"]`).click();
    await page.waitForTimeout(100);
  };
  await page.locator('.file-tree .file-row[data-path="notes/First.md"]').waitFor();
  await page.locator(".folder-code").first().waitFor();
  for (const category of ["code", "docs", "notes", "images", "archive"])
    assert.ok(
      (await page.locator(".folder-" + category).count()) > 0,
      "Missing category " + category,
    );
  await page.screenshot({ path: "qa-artifacts/grove/workspace-light.png" });
  await page.getByRole("button", { name: "Settings (Ctrl+,)", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.waitFor();
  const bounds = await settings.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2);
  assert.ok(await page.locator(".settings-navigation").isVisible());
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByLabel("Editor font size", { exact: true }).fill("16");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Reading width", { exact: true }).selectOption("960");
  await page.screenshot({ path: "qa-artifacts/grove/settings-light.png" });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.screenshot({ path: "qa-artifacts/grove/settings-dark.png" });
  await page.keyboard.press("Escape");
  await settings.waitFor({ state: "hidden" });
  await open("notes/First.md");
  await page
    .locator('.file-tree .file-row[data-path="notes/Second.md"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in new tab", exact: true }).click();
  await page.getByRole("heading", { name: "Second", exact: true }).waitFor();
  assert.equal(await page.locator(".tab").count(), 2);
  assert.ok((await page.locator('.tab[data-path="notes/First.md"]').count()) > 0);
  await page.locator('.tab[data-path="notes/Second.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
  const pinned = page.locator(".tab.pinned");
  assert.equal(await pinned.count(), 1);
  assert.equal(await pinned.locator("span").count(), 0);
  assert.ok((await pinned.boundingBox()).width <= 44);
  await page.screenshot({ path: "qa-artifacts/grove/pinned-tab.png" });
  await page.getByRole("button", { name: "New file in notes", exact: true }).click();
  const fileName = page.getByRole("textbox", { name: "New file name", exact: true });
  await fileName.fill("Inline note");
  await fileName.press("Enter");
  await page.locator('.file-tree .file-row[data-path="notes/Inline note.md"]').waitFor();
  assert.match(await readFile(join(vault, "notes/Inline note.md"), "utf8"), /# Inline note/);
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await fileName.fill("Cancelled");
  await fileName.press("Escape");
  assert.ok(!(await readdir(join(vault, "notes"))).includes("Cancelled.md"));
  await page.getByRole("button", { name: "Folder actions for docs", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  const folderName = page.getByRole("textbox", { name: "New folder name", exact: true });
  await folderName.fill("Guides");
  await page.screenshot({ path: "qa-artifacts/grove/inline-folder.png" });
  await folderName.press("Enter");
  await page.locator(".folder-node summary").filter({ hasText: "Guides" }).waitFor();
  await access(join(vault, "docs/Guides"));
  await page.getByRole("button", { name: "New file in docs/Guides", exact: true }).click();
  await fileName.fill("First guide");
  await fileName.press("Enter");
  await page.locator('.file-tree .file-row[data-path="docs/Guides/First guide.md"]').waitFor();
  await access(join(vault, "docs/Guides/First guide.md"));
  await page.getByRole("button", { name: "New file in notes", exact: true }).click();
  await fileName.fill("Inline note.md");
  await fileName.press("Enter");
  await page.getByRole("alert").waitFor();
  assert.match(await readFile(join(vault, "notes/Inline note.md"), "utf8"), /# Inline note/);
  await fileName.press("Escape");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "qa-artifacts/grove/workspace-dark.png" });
  console.log(
    "PASS: folder-type icons, centered settings/navigation/Escape, new tab preserves preview, icon-only pin, inline file/folder creation in selected folder, Escape cancellation and duplicate protection. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
