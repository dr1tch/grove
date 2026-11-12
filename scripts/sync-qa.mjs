import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
const temp = await mkdtemp(join(tmpdir(), "grove-sync-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile"),
  bare = join(temp, "remote.git"),
  clone = join(temp, "clone");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "Note.md"), "# Notes\n\nShared line\n");
git(temp, "init", "--bare", "-b", "main", bare);
const until = async (read, ok, label, ms = 20000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = read();
      if (ok(last)) return last;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out: ${label} (last: ${last})`);
};
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      GROVE_SYNC_DEBOUNCE_MS: "500",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "init.defaultBranch",
      GIT_CONFIG_VALUE_0: "main",
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  const small = page.locator(".vault-switch small");
  assert.ok((await small.textContent()).includes("Local folder"), "footer before sync");

  // Settings > Sync, connect to the local bare repo
  await page.keyboard.press("Control+Comma");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Sync", exact: true }).click();
  await settings.getByText("Sync this vault with GitHub").waitFor();
  await settings.getByRole("button", { name: "Use existing repository" }).click();
  await settings.getByLabel("Repository URL").fill(bare);
  await settings.getByRole("button", { name: "Connect", exact: true }).click();
  await settings.getByRole("button", { name: "Sync now" }).waitFor();
  await settings.getByRole("button", { name: "Turn off sync" }).waitFor();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".vault-switch small")?.textContent?.startsWith("Synced"),
  );

  // Auto commit after a save
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Edited in Grove");
  await page.keyboard.press("Control+s");
  await until(
    () => git(temp, "--git-dir", bare, "show", "main:Note.md"),
    (t) => t.includes("Edited in Grove"),
    "auto commit reaches remote",
  );

  // Pull into the open note
  git(temp, "clone", bare, clone);
  await writeFile(
    join(clone, "Note.md"),
    "# Notes\n\nShared line\nEdited in Grove\nFrom another device\n",
  );
  git(clone, "commit", "-am", "remote edit");
  git(clone, "push", "origin", "main");
  await small.click();
  await settings.getByRole("button", { name: "Sync now" }).click();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("From another device"),
  );

  // Same-line conflict
  await writeFile(
    join(clone, "Note.md"),
    "# Notes\n\nRemote version\nEdited in Grove\nFrom another device\n",
  );
  git(clone, "commit", "-am", "remote conflict");
  git(clone, "push", "origin", "main");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("# Notes\n\nLocal version\n");
  await page.keyboard.press("Control+s");
  await page
    .getByText("Another device changed this file at the same time. Both versions are kept.")
    .waitFor({ timeout: 30000 });
  assert.ok((await small.textContent()).startsWith("Conflict"), "footer shows conflict");
  await page.getByRole("button", { name: "Compare side by side" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  await page.screenshot({ path: join(temp, "sync-conflict.png") });
  console.log(
    "PASS: sync settings, auto commit, pull into open note, conflict banner. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
