// New notes open as unsaved "Untitled" tabs and are only written after the save prompt.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const temp = await mkdtemp(join(tmpdir(), "grove-draft-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(join(vault, "notes"), { recursive: true });
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "notes", "Existing.md"), "# Existing\n");
const files = async () =>
  (await readdir(vault, { recursive: true })).filter((f) => f.endsWith(".md")).sort();
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
    env: process.env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="notes/Existing.md"]').waitFor();
  const before = await files();

  // Ctrl+N opens an Untitled tab in edit mode and writes nothing.
  await page.keyboard.press("Control+n");
  const tab = page.locator(".tab.active");
  await tab.filter({ hasText: "Untitled" }).waitFor();
  const editor = page.locator(".cm-content").first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("# Meeting notes\n\nAgenda");
  await tab.filter({ hasText: "Meeting notes" }).waitFor();
  await page.waitForTimeout(1500); // longer than autosave
  assert.deepEqual(await files(), before, "draft not written before saving");
  assert.equal(
    await page.locator(".file-row", { hasText: /^[0-9a-f]{8}-/ }).count(),
    0,
    "draft not in Recent",
  );

  // Ctrl+S asks for name and folder, then creates the file and opens it.
  await page.keyboard.press("Control+s");
  const dialog = page.getByRole("dialog", { name: "Save note" });
  assert.equal(await dialog.getByLabel("Name").inputValue(), "Meeting notes");
  await dialog.getByLabel("Folder").selectOption("notes");
  await dialog.getByText("Saves as notes/Meeting notes.md").waitFor();
  await page.screenshot({ path: join(temp, "draft-save.png") });
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator('.tab.active[data-path="notes/Meeting notes.md"]').waitFor();
  assert.equal(
    await readFile(join(vault, "notes", "Meeting notes.md"), "utf8"),
    "# Meeting notes\n\nAgenda",
  );
  assert.equal(await page.locator(".tab", { hasText: "Untitled" }).count(), 0);

  // Closing an edited draft asks; Discard writes nothing.
  await page.keyboard.press("Control+n");
  await tab.filter({ hasText: "Untitled" }).waitFor();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("scratch");
  await page.keyboard.press("Control+w");
  const closing = page.getByRole("dialog", { name: "Save note" });
  await closing.getByText("Save this note before closing?").waitFor();
  await closing.getByRole("button", { name: "Discard" }).click();
  await closing.waitFor({ state: "detached" });
  assert.equal(await page.locator(".tab", { hasText: "Untitled" }).count(), 0);

  // An untouched draft closes without asking.
  await page.keyboard.press("Control+n");
  await tab.filter({ hasText: "Untitled" }).waitFor();
  await page.keyboard.press("Control+w");
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog", { name: "Save note" }).count(), 0);
  assert.equal(await page.locator(".tab", { hasText: "Untitled" }).count(), 0);
  assert.deepEqual(await files(), [...before, "notes/Meeting notes.md"].sort());

  // Quitting with an unsaved draft asks first; Cancel keeps Grove open, Save writes and closes.
  await page.keyboard.press("Control+n");
  await tab.filter({ hasText: "Untitled" }).waitFor();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("# Last thought\n\nKeep me");
  await page.waitForTimeout(300);
  void page.evaluate(() => window.folio.window("close"));
  const quit = page.getByRole("dialog", { name: "Save note" });
  await quit.getByText("Save this note before closing?").waitFor();
  await quit.getByRole("button", { name: "Cancel" }).click();
  await quit.waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  assert.equal(page.isClosed(), false, "Cancel keeps the window open");
  void page.evaluate(() => window.folio.window("close"));
  await quit.getByText("Save this note before closing?").waitFor();
  const closed = page.waitForEvent("close", { timeout: 15000 });
  await quit.getByRole("button", { name: "Save" }).click();
  await closed;
  assert.equal(await readFile(join(vault, "Last thought.md"), "utf8"), "# Last thought\n\nKeep me");
  console.log(
    `PASS: draft tab, save prompt, discard, untouched close, quit prompt. Fixture: ${temp}`,
  );
} finally {
  await app?.close();
}
