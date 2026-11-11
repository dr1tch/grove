import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "folio-smoke-"));
const vault = join(temp, "vault");
const profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
const content =
  "# Local-first sync\n\nThis note tracks how the vault stays in sync. Files on disk remain the source of truth.\n\n## Goals\n\n- Open any folder without importing or converting it.\n- Never lose a keystroke.\n\n## Status\n\n- [x] Build the desktop foundation\n- [ ] Verify the writing experience\n\n## Architecture\n\n```typescript\nconst local = true;\n```\n\n| Layer | Responsibility |\n| --- | --- |\n| Main | Safe file access |\n";
await writeFile(join(vault, "Local-first sync.md"), content);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({
    vault,
    tabs: [{ path: "Local-first sync.md", mode: "preview" }],
    active: "Local-first sync.md",
    settings: { theme: "light" },
  }),
);
const executable = process.env.FOLIO_SMOKE_EXECUTABLE;
const app = await electron.launch({
  ...(executable ? { executablePath: executable } : {}),
  args: [...(executable ? [] : ["."]), `--user-data-dir=${profile}`],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
const page = await app.firstWindow();
page.on("console", (m) => {
  if (m.type() === "error") console.error("renderer:", m.text());
});
page.on("pageerror", (e) => console.error("pageerror:", e));
await page.getByRole("heading", { name: "Local-first sync", exact: true }).waitFor();
assert.equal(
  await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
  ),
  true,
);
assert.equal(await page.evaluate(() => typeof window.require), "undefined");
await mkdir("qa-artifacts", { recursive: true });
await page.screenshot({ path: "qa-artifacts/light.png" });
await page.getByRole("button", { name: "Toggle light/dark" }).click();
await page.screenshot({ path: "qa-artifacts/dark.png" });
await page.getByRole("checkbox", { name: "Complete task" }).click();
await page.waitForTimeout(1200);
assert.match(
  await readFile(join(vault, "Local-first sync.md"), "utf8"),
  /\[x\] Verify the writing experience/,
);
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nVerified native editing.");
await page.waitForTimeout(1500);
assert.match(await readFile(join(vault, "Local-first sync.md"), "utf8"), /Verified native editing/);
await page.getByRole("button", { name: "Settings (Ctrl+,)" }).click();
await page.getByRole("button", { name: "Aa Mono", exact: true }).click();
assert.equal(await page.evaluate(() => document.documentElement.dataset.docfont), "mono");
await page.getByRole("button", { name: "Close settings" }).click();
await app.close();
console.log(
  "PASS: native launch, sandbox preference, preview task toggle, themes, editing/autosave, settings. Fixture:",
  temp,
);
