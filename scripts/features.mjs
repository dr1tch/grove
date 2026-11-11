import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "folio-features-"));
const vault = join(temp, "vault");
const profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
const drawing = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "folio",
  elements: [],
  appState: {},
  files: {},
});
await writeFile(join(vault, "Sketch.excalidraw"), drawing);
await writeFile(join(vault, "Note.md"), "# Note\n\nOriginal content.\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Length 45 >>\nstream\nBT /F1 18 Tf 80 740 Td (Folio PDF test) Tj ET\nendstream",
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => String(n).padStart(10, "0") + " 00000 n ")
  .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await writeFile(join(vault, "Paper.pdf"), pdf);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({
    vault,
    tabs: [{ path: "Note.md", mode: "edit" }],
    active: "Note.md",
    settings: { theme: "light" },
  }),
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
  await page.waitForTimeout(1200);
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-row[data-path="Note.md"]').last().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nMy unsaved edit");
  await writeFile(join(vault, "Note.md"), "# Note\n\nExternal changed content.\n");
  await page.getByText("This file changed on disk while you had unsaved edits.").waitFor();
  assert.match(await readFile(join(vault, "Note.md"), "utf8"), /External changed/);
  await page.getByRole("button", { name: "Keep both", exact: true }).click();
  await page.waitForTimeout(600);
  assert.match(await readFile(join(vault, "Note.md"), "utf8"), /External changed/);
  await page.locator('.file-row[data-path="Sketch.excalidraw"]').last().click();
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.waitForTimeout(1800);
  assert.equal(
    await readFile(join(vault, "Sketch.excalidraw"), "utf8"),
    drawing,
    "Opening a drawing must not rewrite it",
  );
  const box = await page.locator(".document-panel").boundingBox();
  await page.mouse.click(box.x + 300, box.y + 240);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 350, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  assert.ok(
    JSON.parse(await readFile(join(vault, "Sketch.excalidraw"), "utf8")).elements.length > 0,
  );
  await page.locator('.file-row[data-path="Paper.pdf"]').last().click();
  await page.locator(".pdf-view canvas").waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(".pdf-view canvas");
    if (!c) return false;
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
    return false;
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: conflict keep-both, drawing opens unchanged, real drawing saves, PDF renders. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
