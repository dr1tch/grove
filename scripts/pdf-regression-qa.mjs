import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-pdf-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
const receipt = await readFile("/home/dr1tch/Documents/bills/Sonelgaz/recuPaiement.xhtml");
for (const name of ["Receipt.xhtml", "Receipt.bin", "Receipt.docx"])
  await writeFile(join(vault, name), receipt);
await writeFile(
  join(vault, "Actual.xhtml"),
  '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Real XHTML source</h1></body></html>',
);
for (const [name, width, height] of [
  ["Wide", 2400, 400],
  ["Tall", 400, 2400],
]) {
  await writeFile(
    join(vault, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#368478"/><circle cx="200" cy="200" r="100" fill="#eee"/></svg>`,
  );
}
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "Regression.pdf"));
await mkdir(join(vault, "PDF folder"));
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "PDF folder/Report # café.pdf"));
await writeFile(join(profile, "state.json"), JSON.stringify({ settings: { theme: "dark" } }));
await mkdir("qa-artifacts/pdf", { recursive: true });
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  let page = await app.firstWindow();
  const mainPage = page;
  const mainWindow = await app.browserWindow(mainPage);
  const openViewer = async () => {
    const before = await mainWindow.evaluate((win) => win.getBounds());
    const pending = app.waitForEvent("window");
    await mainPage.getByRole("button", { name: "Full window", exact: true }).click();
    page = await pending;
    page.setDefaultTimeout(15000);
    await page.getByRole("button", { name: "Close viewer", exact: true }).waitFor();
    assert.deepEqual(await mainWindow.evaluate((win) => win.getBounds()), before);
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.folio.list();
          return false;
        } catch {
          return true;
        }
      }),
      true,
      "Viewer cannot access main-window IPC",
    );
    const child = await app.browserWindow(page);
    assert.equal(
      await child.evaluate((win) => win.webContents.getLastWebPreferences().sandbox),
      true,
    );
  };
  const closeViewer = async (escape = true) => {
    const closed = page.waitForEvent("close");
    await (
      escape
        ? page.keyboard.press("Escape")
        : page.getByRole("button", { name: "Close viewer", exact: true }).click()
    ).catch((error) => {
      if (!page.isClosed()) throw error;
    });
    await closed;
    page = mainPage;
  };
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Regression.pdf"]').click();
  await page.waitForFunction(
    () =>
      !!document.querySelector(".pdf-view .danger") ||
      document.querySelector(".pdf-controls span")?.textContent?.match(/1\s*\/\s*\d+/),
  );
  const error = (await page.locator(".pdf-view .danger").count())
    ? await page.locator(".pdf-view .danger").textContent()
    : null;
  if (error) {
    console.error("PDF load failed:", error);
    console.error("Renderer diagnostics:", errors);
    console.error(
      "fetch diagnostic:",
      await page.evaluate(async () => {
        try {
          const r = await fetch("folio://app/_vault/Regression.pdf");
          return { status: r.status, length: (await r.arrayBuffer()).byteLength };
        } catch (e) {
          return String(e);
        }
      }),
    );
    await page.screenshot({ path: "qa-artifacts/pdf/failure.png" });
  }
  assert.equal(error, null);
  await page.waitForFunction(() => {
    const c = document.querySelector(".pdf-view canvas");
    if (!c) return false;
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) opaque++;
    return opaque > 1000;
  });
  await page.screenshot({ path: "qa-artifacts/pdf/rendered.png" });
  assert.equal(
    await page.locator(".pdf-view canvas").evaluate((canvas) => {
      const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
    "PDF wheel scrolling is preserved",
  );
  const assertToolbarTooltip = async () => {
    await page.getByRole("button", { name: "Fit to window", exact: true }).hover();
    const tooltip = page.getByRole("tooltip", { name: "Fit to window", exact: true });
    await tooltip.waitFor();
    assert.ok(
      await tooltip.evaluate((tip) => {
        const box = tip.getBoundingClientRect();
        const toolbar = document.querySelector(".pdf-controls").getBoundingClientRect();
        return box.bottom < toolbar.top && box.left >= 0 && box.right <= innerWidth;
      }),
      "Tooltip sits above the toolbar",
    );
    await page.mouse.move(5, 5);
    await tooltip.waitFor({ state: "hidden" });
  };
  await assertToolbarTooltip();
  const assertFits = async () => {
    await page.waitForFunction(() => {
      const c = document.querySelector(".pdf-view canvas");
      const view = document.querySelector(".pdf-view");
      if (!c || !view) return false;
      const box = c.getBoundingClientRect(),
        area = view.getBoundingClientRect();
      return (
        box.width > 100 &&
        box.height > 100 &&
        box.left >= area.left + 31 &&
        box.right <= area.right - 31 &&
        box.top >= area.top + 31 &&
        box.bottom <= area.bottom - 31 &&
        Math.abs((box.left + box.right) / 2 - (area.left + area.right) / 2) < 2 &&
        Math.abs((box.top + box.bottom) / 2 - (area.top + area.bottom) / 2) < 2
      );
    });
  };
  assert.equal(
    await page
      .getByRole("button", { name: "Fit to window", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await assertFits();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 720));
  await assertFits();
  await openViewer();
  await assertFits();
  await page.screenshot({ path: "qa-artifacts/pdf/full-window.png" });
  await assertToolbarTooltip();
  await closeViewer();
  await assertFits();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Fit to window", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await openViewer();
  await closeViewer(false);
  await page.locator('.file-tree .file-row[data-path="PDF folder/Report # café.pdf"]').click();
  await page.waitForFunction(() => {
    const c = document.querySelector(".pdf-view canvas");
    if (!c) return false;
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < pixels.length; i += 4)
      if (pixels[i])
        return /1\s*\/\s*\d+/.test(document.querySelector(".pdf-controls span")?.textContent || "");
    return false;
  });
  assert.equal(await page.locator(".pdf-view .danger").count(), 0);
  for (const name of ["Receipt.xhtml", "Receipt.bin", "Receipt.docx"]) {
    await page.locator(`.file-tree .file-row[data-path="${name}"]`).click();
    await page.locator(`.tab.active[data-path="${name}"]`).waitFor();
    await assertFits();
    assert.equal(
      await page.getByText("This file cannot be edited as text.", { exact: true }).count(),
      0,
    );
    const strip = await page.locator(".file-strip").textContent();
    assert.ok(
      strip.includes("PDF"),
      JSON.stringify({
        name,
        strip,
        inspected: await page.evaluate((path) => window.folio.inspect(path), name),
      }),
    );
    await page.keyboard.press("Control+s");
    await openViewer();
    await assertFits();
    await closeViewer();
    assert.deepEqual(
      await readFile(join(vault, name)),
      receipt,
      "Preview and Ctrl+S preserve original bytes",
    );
  }
  await page.locator('.file-tree .file-row[data-path="Actual.xhtml"]').click();
  await page.locator('.tab.active[data-path="Actual.xhtml"]').waitFor();
  await page
    .frameLocator(".html-preview iframe")
    .getByText("Real XHTML source", { exact: false })
    .first()
    .waitFor();
  assert.equal(await page.locator(".pdf-view").count(), 0, "Genuine XHTML uses the HTML preview");
  const assertImageFits = async () => {
    await page.waitForFunction(() => {
      const img = document.querySelector(".image-view img");
      const view = document.querySelector(".image-view");
      if (!img?.naturalWidth || !view) return false;
      const box = img.getBoundingClientRect(),
        area = view.getBoundingClientRect();
      return (
        box.width > 20 &&
        box.height > 20 &&
        box.left >= area.left &&
        box.right <= area.right &&
        box.top >= area.top &&
        box.bottom <= area.bottom &&
        Math.abs((box.left + box.right - area.left - area.right) / 2) < 2 &&
        Math.abs((box.top + box.bottom - area.top - area.bottom) / 2) < 2
      );
    });
  };
  for (const name of ["Wide", "Tall"]) {
    await page.locator(`.file-tree .file-row[data-path="${name}.svg"]`).click();
    await assertImageFits();
    assert.equal(
      await page
        .getByRole("button", { name: "Fit to window", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await openViewer();
    await assertImageFits();
    await page.screenshot({ path: `qa-artifacts/pdf/image-${name}.png` });
    await assertToolbarTooltip();
    await closeViewer();
    await mainWindow.evaluate((win) => win.setSize(1150, 800));
    await assertImageFits();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Fit to window", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    await page.getByRole("button", { name: "Fit to window", exact: true }).click();
    await assertImageFits();
  }

  await openViewer();
  const previewURL = await page.evaluate(async () => (await window.folio.previewInfo()).url);
  const otherVault = join(temp, "other-vault");
  await mkdir(otherVault);
  await writeFile(join(otherVault, "Other.md"), "# Other vault");
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    otherVault,
  );
  await mainPage.locator('.file-tree .file-row[data-path="Other.md"]').waitFor();
  await page.reload();
  await assertImageFits();
  await closeViewer();
  assert.equal(
    await mainPage.evaluate(async (url) => (await fetch(url)).status, previewURL),
    404,
    "Closed preview token is revoked",
  );
  console.log(
    "PASS: PDF/images fit and centered; separate windows, toolbar tooltips, Escape/close, sandbox, IPC isolation, vault binding and token cleanup. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
