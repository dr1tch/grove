import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-panes-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "Note.md"), "# Notes\n\n" + "A paragraph for reading.\n\n".repeat(100));
await writeFile(join(vault, "Other.md"), "# Other\n");
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "Receipt.pdf"));
await writeFile(join(vault, "style.css"), "h1{color:rgb(12,34,56)}");
await writeFile(
  join(vault, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>',
);
await writeFile(
  join(vault, "index.html"),
  '<link rel="stylesheet" href="style.css"><h1>Offline page</h1><img src="image.svg"><script>window.pwned=1;fetch("https://evil.test/script")</script><img src="https://evil.test/image"><a href="https://evil.test/link">Link</a><form action="https://evil.test/form"><input></form><iframe src="https://evil.test/frame"></iframe>',
);
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  const external = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await page.locator('.file-tree .file-row[data-path="index.html"]').dblclick();
  const frame = page.frameLocator(".html-preview iframe");
  await frame.getByRole("heading", { name: "Offline page" }).waitFor();
  assert.equal(
    await frame.locator("h1").evaluate((el) => getComputedStyle(el).color),
    "rgb(12, 34, 56)",
  );
  assert.equal(
    await frame
      .locator("img")
      .first()
      .evaluate((img) => img.naturalWidth),
    40,
  );
  const isolation = await frame.locator("body").evaluate(() => ({
    bridge: typeof window.folio,
    pwned: window.pwned,
    parent: (() => {
      try {
        return !!parent.document;
      } catch {
        return false;
      }
    })(),
  }));
  assert.deepEqual(isolation, { bridge: "undefined", pwned: undefined, parent: false });
  assert.equal(await frame.locator("a").getAttribute("href"), null);
  assert.equal(await frame.locator("iframe").count(), 0);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("<p>Live unsaved markup</p>");
  await page
    .frameLocator(".html-preview iframe")
    .getByText("Live unsaved markup", { exact: true })
    .waitFor();
  assert.deepEqual(external, []);
  console.log(
    "PASS: local HTML/CSS/image, source split, live changes, opaque sandbox, no bridge/scripts/navigation/network:",
    temp,
  );
} finally {
  await app?.close();
}
