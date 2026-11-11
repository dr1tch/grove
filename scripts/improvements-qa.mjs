import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

// Run from the repository: xvfb-run -a node scripts/improvements-qa.mjs
// Uses the existing production out build. Never starts a server or changes product files.
const temp = await mkdtemp(join(tmpdir(), "folio-improvements-"));
const vault = join(temp, "vault");
const profile = join(temp, "profile");
const artifacts = resolve("qa-artifacts/improvements");
await Promise.all([mkdir(vault), mkdir(profile), mkdir(artifacts, { recursive: true })]);
const longTitle = "Long-title-note-" + "viewport-ellipsis-check-".repeat(5);
const vue =
  '<template><div class="greeting">{{ message }}</div></template>\n<script setup lang="ts">const message:string="Hello Folio";</script>\n<style scoped>.greeting{color:green}</style>\n';
const fixtures = {
  "Code.vue": vue,
  "source.ts": 'export const greeting:string="Hello Folio";\n',
  "sample.csv": 'name,value\n"Alpha, Beta",42\n"Quoted ""value""",7\n',
  "unknown.custom": "Unknown UTF8 content: café 日本語 🌿\n",
  [`${longTitle}.md`]:
    "# Outline QA\n\n" +
    Array.from(
      { length: 35 },
      (_, i) =>
        `## Heading ${i + 1} ${"Very long heading text for ellipsis ".repeat(8)}\n\nParagraph ${i + 1}.\n\n`,
    ).join(""),
  "Diagram.md":
    "# Mermaid QA\n\n```mermaid\nflowchart LR\n A[Start] --> B[Review]\n B --> C[Finish]\n```\n",
};
await Promise.all(
  Object.entries(fixtures).map(([name, value]) => writeFile(join(vault, name), value)),
);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, tabs: [], active: "", settings: { theme: "light" } }),
);
const results = [];
const errors = [];
let app, page;
async function shot(name) {
  await page.screenshot({ path: join(artifacts, `${name}.png`) });
}
async function check(name, fn) {
  try {
    const details = await fn();
    await shot(name);
    await rm(join(artifacts, `${name}-FAIL.png`), { force: true });
    results.push({ name, status: "PASS", details });
  } catch (error) {
    await shot(`${name}-FAIL`).catch(() => {});
    results.push({ name, status: "FAIL", error: String(error) });
  }
  console.log(JSON.stringify(results.at(-1)));
  const dismiss = page.locator(".dismiss").last();
  if (await dismiss.isVisible().catch(() => false))
    await dismiss.click({ position: { x: 1, y: 1 } });
  const closeDialog = page.getByRole("button", { name: "Close dialog", exact: true });
  if (await closeDialog.isVisible().catch(() => false)) await closeDialog.click();
}
async function open(name) {
  await page.locator(`.file-tree .file-row[data-path=${JSON.stringify(name)}]`).click();
  await page.waitForTimeout(350);
}
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1200);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator(".file-tree .file-row").first().waitFor();
  await check("native-drag-and-fullscreen", async () => {
    const regions = await page.evaluate(() =>
      Object.fromEntries(
        [".titlebar", ".tabs", ".drag-handle", ".tab", ".titlebar button"].map((selector) => [
          selector,
          document.querySelector(selector)
            ? getComputedStyle(document.querySelector(selector)).webkitAppRegion
            : "absent",
        ]),
      ),
    );
    assert.equal(regions[".titlebar"], "drag");
    assert.equal(regions[".tabs"], "drag");
    assert.equal(regions[".drag-handle"], "drag");
    assert.equal(regions[".titlebar button"], "no-drag");
    await page.keyboard.press("F11");
    const first = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen(),
    );
    await page.keyboard.press("F11");
    const second = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen(),
    );
    const native = await app.evaluate(({ BrowserWindow }) => ({
      resizable: BrowserWindow.getAllWindows()[0].isResizable(),
      movable: BrowserWindow.getAllWindows()[0].isMovable(),
    }));
    assert.equal(native.resizable, true);
    return {
      regions,
      native,
      fullscreenRequestedStates: [first, second],
      movement: "Actual compositor drag is not measurable under Xvfb without a window manager.",
    };
  });
  await check("outline-hover", async () => {
    await open(`${longTitle}.md`);
    const outline = page.getByRole("navigation", { name: "Document outline" });
    await outline.waitFor();
    await outline.hover();
    await page.waitForTimeout(400);
    const metrics = await outline.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = el.querySelectorAll("button span")[1];
      const css = getComputedStyle(s);
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        vw: innerWidth,
        vh: innerHeight,
        count: el.querySelectorAll("button").length,
        ellipsis: css.textOverflow,
        whiteSpace: css.whiteSpace,
        client: s.clientWidth,
        scroll: s.scrollWidth,
        overflow: getComputedStyle(el).overflowY,
      };
    });
    assert.equal(metrics.count, 36);
    assert.ok(
      metrics.x >= 0 &&
        metrics.y >= 0 &&
        metrics.right <= metrics.vw &&
        metrics.bottom <= metrics.vh,
      JSON.stringify(metrics),
    );
    assert.equal(metrics.ellipsis, "ellipsis");
    assert.ok(metrics.scroll > metrics.client, JSON.stringify(metrics));
    const title = await page.locator(".tab.active").evaluate((el) =>
      [...el.querySelectorAll("*")]
        .map((e) => ({
          text: e.textContent,
          ellipsis: getComputedStyle(e).textOverflow,
          client: e.clientWidth,
          scroll: e.scrollWidth,
        }))
        .find((e) => e.ellipsis === "ellipsis" && e.scroll > e.client),
    );
    assert.ok(title, "Long tab title must be truncated with ellipsis");
    return metrics;
  });
  await check("appearance-full-width-local-font", async () => {
    await page.getByRole("button", { name: "Settings (Ctrl+,)", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.y > 0 && bounds.height < (await page.evaluate(() => innerHeight)));
    await page.getByLabel("Reading width", { exact: true }).selectOption("0");
    await dialog.getByRole("button", { name: "Aa Local", exact: true }).click();
    const select = page.getByLabel("Installed font", { exact: true });
    await page.waitForFunction(() => document.querySelector("#local-font")?.options.length > 1);
    const font = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(font);
    assert.equal(await select.inputValue(), font);
    assert.equal(await page.getByLabel("Reading width", { exact: true }).inputValue(), "0");
    await shot("appearance-selected");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.waitForTimeout(400);
    const applied = await page
      .locator(".md")
      .first()
      .evaluate((el) => ({
        font: getComputedStyle(el).fontFamily,
        maxWidth: getComputedStyle(el).maxWidth,
        reading: document.documentElement.dataset.reading,
      }));
    assert.equal(applied.reading, "full");
    assert.ok(applied.font.includes(font), JSON.stringify(applied));
    return { font, applied };
  });
  await check("sidebar-pointer-resize", async () => {
    const bar = page.locator(".sidebar-resizer");
    const before = await page.locator(".sidebar").boundingBox();
    const b = await bar.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 85, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    const after = await page.locator(".sidebar").boundingBox();
    assert.ok(after.width > before.width + 40, JSON.stringify({ before, after }));
    return { before: before.width, after: after.width };
  });
  await check("tab-context-close", async () => {
    await open("source.ts");
    await page.locator(".tab.active").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Tab actions", exact: true });
    await menu.waitFor();
    assert.equal(await menu.getByRole("menuitem", { name: "Appearance", exact: true }).count(), 0);
    await shot("tab-context-menu");
    await menu.getByRole("menuitem", { name: "Close tab", exact: true }).click();
    assert.equal(await page.locator('.tab[data-path="source.ts"]').count(), 0);
  });
  await check("create-empty-folder", async () => {
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByLabel("Folder path", { exact: true }).fill("Empty QA folder");
    await page.getByRole("button", { name: "Create folder", exact: true }).click();
    await page.locator(".folder-node summary").filter({ hasText: "Empty QA folder" }).waitFor();
    assert.deepEqual(await readdir(join(vault, "Empty QA folder")), []);
  });
  await check("rename-preserves-content", async () => {
    await page.getByRole("button", { name: "Actions for source.ts", exact: true }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.getByLabel("New path", { exact: true }).fill("renamed.ts");
    await page.getByRole("button", { name: "Preview changes", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Rename", exact: true })
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await page.locator('.file-tree .file-row[data-path="renamed.ts"]').waitFor();
    assert.equal(await readFile(join(vault, "renamed.ts"), "utf8"), fixtures["source.ts"]);
    assert.ok(!(await readdir(vault)).includes("source.ts"));
  });
  await check("csv-table", async () => {
    await open("sample.csv");
    await page.locator(".text-preview-table").waitFor();
    assert.equal(await page.locator(".text-preview-table tr").count(), 3);
    assert.equal(
      await page.locator(".text-preview-table tr").nth(1).locator("td").first().innerText(),
      "Alpha, Beta",
    );
    assert.equal(
      await page.locator(".text-preview-table tr").nth(2).locator("td").first().innerText(),
      'Quoted "value"',
    );
  });
  await check("vue-formatted-highlighted", async () => {
    await open("Code.vue");
    await page.getByRole("status").filter({ hasText: "Formatted preview" }).waitFor();
    const tokens = await page.locator('.text-preview-code span[style*="color"]').count();
    assert.ok(tokens > 10, `Only ${tokens} highlighted tokens`);
    const preview = await page.locator(".text-preview-code").innerText();
    assert.ok(preview.includes('const message: string = "Hello Folio";'), preview);
    assert.equal(await readFile(join(vault, "Code.vue"), "utf8"), vue);
    return { tokens };
  });
  await check("typescript-preview", async () => {
    await open("renamed.ts");
    await page.getByRole("status").filter({ hasText: "Formatted preview" }).waitFor();
    assert.ok((await page.locator('.text-preview-code span[style*="color"]').count()) > 3);
  });
  await check("unknown-utf8-preview", async () => {
    await open("unknown.custom");
    await page.locator(".text-preview").waitFor();
    assert.ok((await page.locator(".text-preview-code").innerText()).includes("café 日本語 🌿"));
  });
  await check("mermaid-styled-rounded-svg-zoom", async () => {
    await open("Diagram.md");
    await page.locator(".mermaid svg .node rect").first().waitFor({ timeout: 20000 });
    const nodes = await page.locator(".mermaid svg .node rect").evaluateAll((els) =>
      els.map((el) => ({
        rx: getComputedStyle(el).rx,
        fill: getComputedStyle(el).fill,
        stroke: getComputedStyle(el).stroke,
      })),
    );
    assert.equal(await page.locator(".mermaid svg g.node").count(), 3);
    assert.ok(
      nodes.some((n) => parseFloat(n.rx) > 0 && n.fill !== "none"),
      JSON.stringify(nodes),
    );
    const before = await page.locator(".mermaid").boundingBox();
    await page.getByRole("button", { name: "Zoom in diagram", exact: true }).click();
    assert.equal(await page.locator(".diagram-fit").innerText(), "125%");
    const after = await page.locator(".mermaid").boundingBox();
    assert.ok(after.width > before.width, JSON.stringify({ before, after }));
    return { nodes, before: before.width, after: after.width };
  });
  console.log(JSON.stringify({ results, pageErrors: errors, artifacts, fixture: temp }, null, 2));
  process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
