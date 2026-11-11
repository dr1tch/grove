import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-sidebar-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
const folder = "A very long folder name for architecture decisions and documentation "
  .repeat(2)
  .trim();
const file =
  "A complete very long note filename with important context that must never require scrolling horizontally "
    .repeat(2)
    .trim() + ".md";
await mkdir(join(vault, folder));
await mkdir(join(vault, folder, "nested-folder"));
await writeFile(join(vault, folder, file), "# Long filename\n\nSome text.");
for (let i = 0; i < 60; i++)
  await writeFile(join(vault, `Note ${String(i).padStart(2, "0")}.md`), "# Note");
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, sidebarWidth: 220, settings: { theme: "dark" } }),
);
await mkdir("qa-artifacts/sidebar", { recursive: true });
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1000);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  const path = `${folder}/${file}`;
  const target = page
    .locator(".file-tree .file-row")
    .filter({ hasText: file.replace(/\.md$/, "") });
  await target.waitFor();
  const sidebar = await page.locator(".tree").evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
    height: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowX: getComputedStyle(el).overflowX,
  }));
  assert.equal(sidebar.overflowX, "hidden");
  assert.ok(sidebar.scroll <= sidebar.client + 1, JSON.stringify(sidebar));
  assert.ok(sidebar.scrollHeight > sidebar.height, "Vertical scrolling is preserved");
  assert.equal(await target.getAttribute("title"), null);
  await target.hover();
  const tip = page.getByRole("tooltip", { name: path, exact: true });
  await tip.waitFor();
  const tipId = await tip.getAttribute("id");
  assert.equal(await target.getAttribute("aria-describedby"), tipId);
  const metrics = await tip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
      text: el.textContent,
    };
  });
  assert.ok(
    metrics.left >= 0 &&
      metrics.right <= metrics.width &&
      metrics.top >= 0 &&
      metrics.bottom <= metrics.height,
    JSON.stringify(metrics),
  );
  assert.equal(metrics.text, path);
  await page.screenshot({ path: "qa-artifacts/sidebar/full-file-tooltip.png" });
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });
  await target.focus();
  await tip.waitFor();
  await page.keyboard.press("Tab");
  await tip.waitFor({ state: "hidden" });
  const summary = page.locator(".folder-node > summary").filter({ hasText: folder }).first();
  await summary.hover();
  const folderTip = page.getByRole("tooltip", { name: folder, exact: true });
  await folderTip.waitFor();
  assert.equal(await summary.getAttribute("title"), null);
  assert.equal(await summary.locator("[title]").count(), 0);
  await page.screenshot({ path: "qa-artifacts/sidebar/full-folder-tooltip.png" });
  await page.mouse.move(1000, 700);
  await folderTip.waitFor({ state: "hidden" });
  const control = page.getByRole("button", { name: "Toggle light/dark", exact: true });
  const originalStyle = await control.getAttribute("style");
  for (const position of [
    "top",
    "bottom",
    "left-edge",
    "right-edge",
    "side-right",
    "side-left",
    "cramped",
  ]) {
    await control.evaluate((el, position) => {
      const tall = position.startsWith("side") || position === "cramped";
      Object.assign(el.style, {
        position: "fixed",
        zIndex: "9999",
        margin: "0",
        top:
          position === "bottom"
            ? `${innerHeight - 40}px`
            : tall
              ? "8px"
              : position === "top"
                ? "8px"
                : `${innerHeight / 2}px`,
        left: ["left-edge", "side-right", "cramped"].includes(position)
          ? "8px"
          : ["right-edge", "side-left"].includes(position)
            ? `${innerWidth - 40}px`
            : `${innerWidth / 2}px`,
        width: position === "cramped" ? `${innerWidth - 16}px` : "32px",
        height: tall ? `${innerHeight - 16}px` : "32px",
      });
    }, position);
    await control.focus();
    const tooltip = page.getByRole("tooltip", { name: "Toggle light/dark", exact: true });
    await tooltip.waitFor();
    const box = await tooltip.boundingBox();
    const anchor = await control.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(
      box.x >= 7 &&
        box.y >= 7 &&
        box.x + box.width <= viewport.width - 7 &&
        box.y + box.height <= viewport.height - 7,
      position,
    );
    if (position === "top") assert.ok(box.y >= anchor.y + anchor.height + 7, position);
    if (["bottom", "left-edge", "right-edge"].includes(position))
      assert.ok(box.y + box.height <= anchor.y - 7, position);
    if (position === "side-right") assert.ok(box.x >= anchor.x + anchor.width + 7, position);
    if (position === "side-left") assert.ok(box.x + box.width <= anchor.x - 7, position);
    await page.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await control.blur();
  }
  await control.evaluate((el, style) => {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }, originalStyle);
  await page.locator(".tree").evaluate((el) => (el.scrollTop = el.scrollHeight));
  const end = await page
    .locator(".tree")
    .evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  assert.equal(end.left, 0);
  assert.ok(end.top > 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: sidebar scrolling and accessible tooltips; vertical preference, top/bottom/edge placement, horizontal fallback and cramped viewport bounds. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
