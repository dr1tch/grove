// Visual pass on the packaged build: themes x window sizes, two panes, tooltips, overlays, focus.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = process.argv[2] ?? "qa-artifacts/visual";
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "grove-visual-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(join(vault, "docs"), { recursive: true });
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(
  join(vault, "Note with a fairly long file name for truncation.md"),
  "# Notes\n\n| Col | Value |\n|---|---|\n| a | 1 |\n\n```ts\nconst x: number = 1;\n```\n\n- [ ] task\n- [x] done\n\n```mermaid\nflowchart LR\nStart-->Finish\n```\n\n" +
    "A paragraph for reading. ".repeat(60),
);
await writeFile(
  join(vault, "docs", "Page.html"),
  "<h1>Hello</h1><p style='color:teal'>HTML preview</p>",
);
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "Receipt.pdf"));
// GROVE_VISUAL_DEV=1 runs the source build (after `vp run build`) instead of the installed app.
const dev = process.env.GROVE_VISUAL_DEV;
const app = await electron.launch({
  ...(dev ? {} : { executablePath: process.env.FOLIO_SMOKE_EXECUTABLE ?? "/opt/Grove/folio" }),
  args: ["--ozone-platform=x11", ...(dev ? ["."] : []), `--user-data-dir=${profile}`],
});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
await page.locator(".tabs").waitFor();
await app.evaluate(
  ({ app }, root) =>
    app.emit("second-instance", {}, app.isPackaged ? ["folio", root] : ["electron", "app", root]),
  vault,
);
const note = "Note with a fairly long file name for truncation.md";
await page.locator(`.file-tree .file-row[data-path="${note}"]`).dblclick();
await page.locator(".tab.active").waitFor();
const size = (w, h) =>
  app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const b = BrowserWindow.getAllWindows()[0];
      b.unmaximize();
      b.setSize(w, h);
    },
    [w, h],
  );
const shot = async (n) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, n + ".png") });
};
const overflow = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed";
      })
      .slice(0, 5)
      .map((e) => e.className || e.tagName),
  );
const report = {};
for (const theme of ["light", "dark"]) {
  for (const [w, h] of [
    [1400, 900],
    [900, 700],
    [700, 600],
  ]) {
    await size(w, h);
    await shot(`${theme}-${w}-note`);
    report[`${theme}-${w}`] = await overflow();
  }
  await size(1400, 900);
  await page.getByRole("button", { name: "Open beside", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
  await page.locator('.document-pane[data-pane="primary"]').click({ position: { x: 20, y: 60 } });
  await page.locator('.file-tree .file-row[data-path="Receipt.pdf"]').dblclick();
  await page.waitForTimeout(1200);
  await shot(`${theme}-two-pane`);
  await size(900, 700);
  await shot(`${theme}-two-pane-900`);
  report[`${theme}-two-pane-900`] = await overflow();
  await size(1400, 900);
  await page.getByRole("button", { name: "Toggle light/dark" }).hover();
  await shot(`${theme}-tooltip-header`);
  await page.locator(`.file-tree .file-row[data-path="${note}"]`).hover();
  await shot(`${theme}-tooltip-sidebar`);
  await page.keyboard.press("Control+k");
  await shot(`${theme}-switcher`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+f");
  await page.keyboard.type("paragraph");
  await shot(`${theme}-search`);
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  await shot(`${theme}-focus`);
  report[`${theme}-focus`] = await page.evaluate(() => {
    const e = document.activeElement;
    const s = getComputedStyle(e);
    return [
      e.tagName,
      e.getAttribute("aria-label") || e.textContent?.slice(0, 30),
      s.outlineStyle,
      s.outlineWidth,
      s.boxShadow.slice(0, 40),
    ];
  });
  await page
    .locator(".document-pane")
    .nth(1)
    .getByRole("button", { name: /close/i })
    .first()
    .click()
    .catch(() => {});
  await page
    .locator(`.file-tree .file-row[data-path="docs"]`)
    .click()
    .catch(() => {});
  await page
    .locator('.file-tree .file-row[data-path="docs/Page.html"]')
    .dblclick()
    .catch(() => {});
  await shot(`${theme}-html`);
  await page.getByRole("button", { name: "Toggle light/dark" }).click();
}
console.log(JSON.stringify(report, null, 1));
await app.close();
