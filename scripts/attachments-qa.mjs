import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile, readFile, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-attach-ui-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "Note.md"), "# Note\n\nStart\n");
const image = join(temp, "Picture space.svg");
await writeFile(
  image,
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="green"/></svg>',
);
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(temp, "Receipt.pdf"));
await writeFile(join(temp, "data.bin"), Buffer.from([0, 1, 2, 3]));
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  const session = await page.context().newCDPSession(page);
  const drop = async (files) => {
    const box = await page.locator(".preview, .cm-content").first().boundingBox();
    const data = { items: [], files, dragOperationsMask: 1 };
    await session.send("Input.dispatchDragEvent", {
      type: "dragEnter",
      x: box.x + 100,
      y: box.y + 80,
      data,
    });
    await session.send("Input.dispatchDragEvent", {
      type: "dragOver",
      x: box.x + 100,
      y: box.y + 80,
      data,
    });
    await session.send("Input.dispatchDragEvent", {
      type: "drop",
      x: box.x + 100,
      y: box.y + 80,
      data,
    });
  };
  await drop([image, join(temp, "Receipt.pdf"), join(temp, "data.bin")]);
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent.includes("data.bin"),
  );
  const first = await page.locator(".cm-content").textContent();
  assert.ok(first.includes("Picture%20space.svg"));
  assert.ok(first.includes("Receipt.pdf"));
  assert.deepEqual(
    await readFile(join(vault, "attachments", "Picture space.svg")),
    await readFile(image),
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => !document.querySelector(".cm-content").textContent.includes("Receipt.pdf"),
  );
  assert.ok(
    (await readdir(join(vault, "attachments"))).includes("Receipt.pdf"),
    "Undo keeps copied assets",
  );
  await page.keyboard.press("Control+Shift+z");
  await drop([join(vault, "attachments", "Picture space.svg")]);
  await page.waitForTimeout(250);
  assert.equal(
    (await readdir(join(vault, "attachments"))).filter((p) => p.endsWith(".svg")).length,
    1,
    "Existing vault file is not duplicated",
  );
  const png = (await page.screenshot()).toString("base64");
  await app.evaluate(async ({ clipboard, ClipboardItem }, png) => {
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([Buffer.from(png, "base64")], { type: "image/png" }),
      }),
    ]);
  }, png);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+v");
  await page
    .waitForFunction(() =>
      document.querySelector(".cm-content").textContent.includes("Screenshot%20"),
    )
    .catch(async (error) => {
      console.log("Paste diagnostic:", await page.locator("body").innerText());
      throw error;
    });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator(".attachment-view canvas").waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".preview img")].some((img) => img.naturalWidth > 0),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: trusted native file drop, preview-to-editor insertion, mixed attachments, encoded links, undo/redo, existing vault reuse, clipboard image, inline image/PDF:",
    temp,
  );
} finally {
  await app?.close();
}
