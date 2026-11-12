import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-popup-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await mkdir("qa-artifacts/popups", { recursive: true });
const diagram =
  "flowchart TB\n" +
  Array.from(
    { length: 18 },
    (_, i) =>
      `N${i}[${i === 0 ? "START OF THE DIAGRAM" : "Phase " + i}] --> N${i + 1}[${i === 17 ? "End" : "Details " + i}]`,
  ).join("\n");
await writeFile(
  join(vault, "Diagram.md"),
  "# Diagram test\n\n```mermaid\n" + diagram + "\n```\n\n## One\n\nText.\n\n## Two\n\nText.\n",
);
for (const [path, content] of Object.entries({
  "App.vue": "<template><div>Hello</div></template>",
  "script.js": "const a=1",
  "model.ts": "const a:number=1",
  "data.csv": "name,value\nx,1",
}))
  await writeFile(join(vault, path), content);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, settings: { theme: "dark" } }),
);
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1000);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Diagram.md"]').waitFor();
  for (const [path, color] of [
    ["App.vue", "green"],
    ["script.js", "yellow"],
    ["model.ts", "blue"],
  ])
    assert.equal(
      await page.locator(`.file-tree .file-row[data-path="${path}"] .file-${color}`).count(),
      1,
    );
  await page.locator('.file-tree .file-row[data-path="Diagram.md"]').click();
  await page.locator(".diagram-block .mermaid svg").waitFor();
  const preview = page.locator(".writing > .preview");
  await preview.evaluate((el) => (el.scrollTop = 150));
  await page.getByRole("button", { name: "Expand diagram", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Flowchart diagram", exact: true });
  await modal.waitFor().catch(async (e) => {
    console.error("ERRORS", errors);
    console.error(await page.locator("body").innerText());
    console.error(
      await page.locator("dialog").evaluateAll((els) =>
        els.map((el) => ({
          html: el.outerHTML.slice(0, 500),
          open: el.open,
          rect: el.getBoundingClientRect().toJSON(),
        })),
      ),
    );
    await page.screenshot({ path: "qa-artifacts/popups/modal-failure.png" });
    throw e;
  });
  await modal.locator(".mermaid svg").waitFor();
  const bounds = await modal.locator(".diagram-viewport").evaluate((el) => {
    const node = el.querySelector("g.node");
    const r = el.getBoundingClientRect(),
      n = node.getBoundingClientRect();
    return {
      scroll: el.scrollTop,
      viewportTop: r.top,
      nodeTop: n.top,
      nodeBottom: n.bottom,
      height: r.height,
    };
  });
  assert.equal(bounds.scroll, 0);
  assert.ok(
    bounds.nodeTop >= bounds.viewportTop,
    "Start of diagram must not be above viewport: " + JSON.stringify(bounds),
  );
  await page.screenshot({ path: "qa-artifacts/popups/tall-diagram-start.png" });
  const before = await app.evaluate(({ BrowserWindow }) => ({
    max: BrowserWindow.getAllWindows()[0].isMaximized(),
    bounds: BrowserWindow.getAllWindows()[0].getBounds(),
  }));
  await modal.locator("header").dblclick({ position: { x: 120, y: 20 } });
  const after = await app.evaluate(({ BrowserWindow }) => ({
    max: BrowserWindow.getAllWindows()[0].isMaximized(),
    bounds: BrowserWindow.getAllWindows()[0].getBounds(),
  }));
  assert.deepEqual(after, before);
  assert.equal(
    await modal.locator("header").evaluate((el) => getComputedStyle(el).webkitAppRegion),
    "no-drag",
  );
  await modal.getByRole("button", { name: "Copy", exact: true }).click();
  await modal.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), diagram);
  await page.screenshot({ path: "qa-artifacts/popups/copied-feedback.png" });
  await modal.getByRole("button", { name: "Copied", exact: true }).dblclick();
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) => ({
      max: BrowserWindow.getAllWindows()[0].isMaximized(),
      bounds: BrowserWindow.getAllWindows()[0].getBounds(),
    })),
    before,
  );
  await page.mouse.click(5, 5);
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Settings (Ctrl+,)", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  await page.mouse.click(5, 5);
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" });
  await page.locator('.file-tree .file-row[data-path="App.vue"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("dialog", { name: "Rename", exact: true }).waitFor();
  await page.mouse.click(5, 5);
  await page.getByRole("dialog", { name: "Rename", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator(".tabs > .tab-add").count(), 1);
  await page.getByRole("button", { name: "New tab (Ctrl+T)", exact: true }).click();
  // The plus button opens an unsaved Untitled note ready for typing.
  await page.locator(".tab.active", { hasText: "Untitled" }).waitFor();
  await page.locator(".editor-wrap").first().waitFor();
  await page.screenshot({ path: "qa-artifacts/popups/file-icons-tabs.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: file-type icons; tall diagram begins at top; double-click does not resize; clipboard matches source with copied feedback; diagram/settings/rename close outside; tab plus opens an Untitled draft. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
