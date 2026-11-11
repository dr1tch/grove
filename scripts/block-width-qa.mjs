import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-width-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await mkdir("qa-artifacts/width", { recursive: true });
await writeFile(
  join(vault, "Width.md"),
  '# Full width blocks\n\nThe code, chart and diagram frames share the same document edges.\n\n```typescript\nconst ready: boolean = true;\n```\n\n```mermaid\nflowchart LR\n A[Create] --> B[Read] --> C[Edit] --> D[Save]\n```\n\n```mermaid\npie title File types\n "Notes" : 60\n "Drawings" : 40\n```\n\n| Type | Status |\n| --- | --- |\n| Notes | Ready |\n',
);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, settings: { theme: "dark", readingWidth: 0 } }),
);
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForTimeout(1000);
  await app.evaluate(({ app, BrowserWindow }, root) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000);
    app.emit("second-instance", {}, ["electron", "app", root]);
  }, vault);
  await page.locator('.file-tree .file-row[data-path="Width.md"]').click();
  await page.locator(".mermaid svg").first().waitFor();
  const check = async (label) => {
    const result = await page.locator(".md").evaluate((el) => {
      const style = getComputedStyle(el);
      const inner =
        el.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const blocks = [...el.querySelectorAll(".code-block,.table-wrap")].map((block) => ({
        width: block.getBoundingClientRect().width,
        left: block.getBoundingClientRect().left,
      }));
      const pane = el.closest(".preview");
      return { inner, blocks, paneWidth: pane.clientWidth, scrollWidth: pane.scrollWidth };
    });
    assert.equal(result.blocks.length, 4);
    for (const block of result.blocks)
      assert.ok(Math.abs(block.width - result.inner) < 2, label + JSON.stringify(result));
    assert.ok(result.scrollWidth <= result.paneWidth + 1, label + JSON.stringify(result));
    return result;
  };
  const full = await check("full");
  assert.ok(full.inner > 900);
  await page.screenshot({ path: "qa-artifacts/width/full-width.png" });
  await page.getByRole("button", { name: "Settings (Ctrl+,)", exact: true }).click();
  await page.getByLabel("Reading width", { exact: true }).selectOption("1200");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  const wide = await check("wide");
  assert.ok(wide.inner > 900);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await check("split");
  console.log(
    "PASS: code, flowchart and chart frames match table/document width in full-width, wide and split previews; no horizontal pane overflow. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
