const reviewRepo = process.cwd();
const sourceURL = new URL("../src/", import.meta.url).href;
process.chdir(reviewRepo);
import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({
  resolve(s, c, n) {
    return n(
      c.parentURL?.startsWith(sourceURL) && s.startsWith(".") && !extname(s) ? s + ".ts" : s,
      c,
    );
  },
});
import { createRequire } from "node:module";
const { _electron: electron } = createRequire(reviewRepo + "/package.json")("playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
const { Vault } = await import("../src/main/vault.ts");
const { Links } = await import("../src/main/links.ts");
const temp = await mkdtemp(tmpdir() + "/grove-review-rename-ui-"),
  vault = temp + "/vault",
  profile = temp + "/profile";
await mkdir(vault);
await mkdir(profile);
await writeFile(vault + "/target.md", "# Target");
await writeFile(vault + "/source.md", "[Target](target.md)");
await writeFile(profile + "/state.json", JSON.stringify({ vault }));
const v = new Vault(vault),
  links = new Links(v),
  plan = await links.plan("target.md", "renamed.md");
await v.putLinkJournal(plan, true);
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", "--user-data-dir=" + profile],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForTimeout(1000);
  await app.evaluate(
    ({ app }, vault) => app.emit("second-instance", {}, ["electron", "app", vault]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="source.md"]').click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("button", { name: "Backlinks and broken links", exact: true }).click();
  await page.getByRole("button", { name: "Resume link updates", exact: true }).waitFor();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("folio:applyRenamePlan");
    ipcMain.handle(
      "folio:applyRenamePlan",
      () => new Promise((resolve) => (globalThis.reviewApply = () => resolve({ ok: true }))),
    );
  });
  await page.getByRole("button", { name: "Resume link updates", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" NEW UNSAVED EDIT");
  console.log("before resume completion", await page.locator(".cm-content").innerText());
  await links.apply(plan.id);
  await app.evaluate(() => globalThis.reviewApply());
  await page.waitForTimeout(300);
  console.log("after completion", await page.locator(".cm-content").innerText());
  console.log(
    "draft",
    await page.evaluate(
      (root) => localStorage.getItem("folio:draft:" + root + ":source.md"),
      vault,
    ),
  );
  console.log("disk", await readFile(vault + "/source.md", "utf8"));
  console.log("fixture", temp);
  if (!(await page.locator(".cm-content").innerText()).includes("NEW UNSAVED EDIT"))
    throw new Error("FAIL: link-update completion erased the newer edit");
  const savedDraft = await page.evaluate(
    (root) => localStorage.getItem(`folio:draft:${root}:source.md`),
    vault,
  );
  if (!savedDraft || !JSON.parse(savedDraft).value.includes("NEW UNSAVED EDIT"))
    throw new Error("FAIL: newer recovery draft was discarded");
  console.log("PASS: newer edits survive link-update completion");
} finally {
  await app?.close();
}
