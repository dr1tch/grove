import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), "folio-office-"));
const vault = join(temp, "vault");
const profile = join(temp, "app-profile");
await mkdir(vault);
await mkdir(profile);
const ns =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const samples = [
  {
    file: "Word.fodt",
    ext: "docx",
    mime: "text",
    body: "<office:text><text:p>Folio Word preview</text:p></office:text>",
  },
  {
    file: "Sheet.fods",
    ext: "xlsx",
    mime: "spreadsheet",
    body: '<office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>Folio spreadsheet</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
  },
  {
    file: "Slides.fodp",
    ext: "pptx",
    mime: "presentation",
    body: '<office:presentation><draw:page draw:name="Slide1"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="15cm" svg:height="4cm"><draw:text-box><text:p>Folio presentation</text:p></draw:text-box></draw:frame></draw:page></office:presentation>',
  },
];
for (const sample of samples) {
  await writeFile(
    join(temp, sample.file),
    `<?xml version="1.0" encoding="UTF-8"?><office:document ${ns} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.${sample.mime}"><office:body>${sample.body}</office:body></office:document>`,
  );
  await exec(
    "libreoffice",
    [
      `-env:UserInstallation=file://${join(temp, "converter")}`,
      "--headless",
      "--convert-to",
      sample.ext,
      "--outdir",
      vault,
      join(temp, sample.file),
    ],
    { timeout: 60000 },
  );
}
await writeFile(join(profile, "state.json"), JSON.stringify({ settings: { theme: "light" } }));
let app;
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  for (const sample of samples) {
    const file = sample.file.replace(/\.[^.]+$/, "." + sample.ext);
    await page.locator(`.file-row[data-path="${file}"]`).click();
    await page
      .waitForFunction(
        () => {
          const c = document.querySelector(".pdf-view canvas");
          if (!c) return false;
          const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
          return false;
        },
        null,
        {
          timeout: 15000,
        },
      )
      .catch(async (e) => {
        console.error((await page.locator("body").innerText()).slice(-3000));
        await page.screenshot({ path: "qa-artifacts/office-error.png" });
        throw e;
      });
    assert.equal(await page.locator(".banner.danger").count(), 0);
    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Full window", exact: true }).click();
    const viewer = await opened;
    await viewer.waitForFunction(() => {
      const canvas = document.querySelector(".pdf-view canvas");
      if (!canvas) return false;
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    });
    await viewer.close();
  }
  console.log("PASS: Word DOCX, Excel XLSX and PowerPoint PPTX rendered in Folio. Fixture:", temp);
} finally {
  await app?.close();
}
