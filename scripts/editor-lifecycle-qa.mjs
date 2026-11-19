import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "grove-editor-lifecycle-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(join(vault, "folder"), { recursive: true });
await mkdir(profile);
const paths = Array.from({ length: 23 }, (_, index) => `Note-${index}.md`);
const original = "# Recent note\n\nOriginal text.\n";
await Promise.all(paths.map((path) => writeFile(join(vault, path), original)));
await writeFile(join(vault, "folder/Child.md"), "# Child\n");
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({
    vault,
    tabs: paths.map((path) => ({ path, mode: "edit" })),
    active: paths.at(-1),
  }),
);
let app;
try {
  const executablePath = process.env.FOLIO_SMOKE_EXECUTABLE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), "--ozone-platform=x11", `--user-data-dir=${profile}`],
  });
  if (process.env.GROVE_EXPECT_VERSION)
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      process.env.GROVE_EXPECT_VERSION,
    );
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await page.locator('.tabs [data-path="Note-22.md"].active').waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Undo survives closing.");
  await until(
    async () => (await readFile(join(vault, "Note-22.md"), "utf8")).includes("Undo survives"),
    "save before close",
  );
  await until(
    async () => (await page.locator('.tabs [data-path="Note-22.md"] .dirty').count()) === 0,
    "saved tab state",
  );
  for (const path of paths) {
    await page.locator(`.tabs [data-path="${path}"]`).click();
    await page.locator(`.tabs [data-path="${path}"].active`).waitFor();
    await page.keyboard.press("Control+w");
    await page.locator(`.tabs [data-path="${path}"]`).waitFor({ state: "detached" });
  }
  for (let index = 0; index < 23; index++) {
    await page.keyboard.press("Control+Shift+t");
    await until(
      async () => (await page.locator(".tabs .tab").count()) === Math.min(index + 1, 20),
      "bounded reopen history",
    );
  }
  for (const path of paths.slice(0, 3))
    assert.equal(await page.locator(`.tabs [data-path="${path}"]`).count(), 0);
  await page.locator('.tabs [data-path="Note-22.md"]').click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await until(
    async () => (await readFile(join(vault, "Note-22.md"), "utf8")) === original,
    "recent reopened undo",
  );
  console.log(
    "PASS: closed-tab history is bounded at20 and recent source undo survives reopening.",
  );

  const folder = page
    .locator(".folder-node")
    .filter({ has: page.locator(".folder-trigger", { hasText: "folder" }) })
    .first();
  await folder.locator(".folder-trigger").click();
  await until(
    async () => !(await page.locator('.file-tree [data-path="folder/Child.md"]').isVisible()),
    "folder collapse",
  );
  await folder.locator(".folder-trigger").click();
  await page.locator('.file-tree [data-path="folder/Child.md"]').click();
  await page.getByRole("heading", { name: "Child", exact: true }).waitFor();
  await page.locator('.file-tree [data-path="Note-22.md"]').click();
  await page.locator('.tabs [data-path="Note-22.md"].active').waitFor();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name", { exact: true }).fill("QA folder");
  await page.getByLabel("New folder name", { exact: true }).press("Enter");
  await page.locator(".folder-node .folder-trigger").filter({ hasText: "QA folder" }).waitFor();
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByLabel("New file name", { exact: true }).fill("Created.md");
  await page.getByLabel("New file name", { exact: true }).press("Enter");
  await page.locator('.file-tree [data-path="QA folder/Created.md"]').waitFor();
  assert.ok((await readFile(join(vault, "QA folder/Created.md"), "utf8")).includes("Created"));
  console.log("PASS: memoized tree keeps folder navigation and latest create callbacks working.");
} finally {
  await app?.close();
}
