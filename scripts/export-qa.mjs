import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const temp = await mkdtemp(join(tmpdir(), "grove-panes-")),
  vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(join(vault, "Note.md"), "# Notes\n\n" + "A paragraph for reading.\n\n".repeat(100));
await writeFile(join(vault, "Other.md"), "# Other\n");
await copyFile("/home/dr1tch/Documents/261032848.pdf", join(vault, "Receipt.pdf"));
await writeFile(
  join(vault, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#218c66"/></svg>',
);
await writeFile(join(vault, "attachment.bin"), Buffer.from([1, 2, 3, 4]));
await writeFile(
  join(vault, "scene.excalidraw"),
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "Grove",
    elements: [
      {
        id: "box",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        angle: 0,
        strokeColor: "#111111",
        backgroundColor: "#d6efd6",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: "a0",
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      },
    ],
    appState: {},
    files: {},
  }),
);
const note =
  "# Export proof\n\n| Item | Value |\n|---|---|\n| Example | Visible |\n\n```js\nconst value = 42;\n```\n\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n\n![Local image](image.svg)\n\n![[scene.excalidraw]]\n\n[Download attachment](attachment.bin)\n";
await writeFile(join(vault, "Note.md"), note);
const executable = process.env.FOLIO_SMOKE_EXECUTABLE;
let app;
try {
  app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: ["--ozone-platform=x11", ...(executable ? [] : ["."]), `--user-data-dir=${profile}`],
  });
  app.on("window", (child) => {
    child.on("pageerror", (error) => console.log("Export pageerror:", String(error)));
    child.on("console", (message) => {
      if (message.type() === "error") console.log("Export console:", message.text());
    });
  });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  if (executable) await page.locator(".tabs").waitFor();
  else await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) =>
      app.emit("second-instance", {}, app.isPackaged ? ["folio", root] : ["electron", "app", root]),
    vault,
  );
  await page.locator('.file-tree .file-row[data-path="Note.md"]').dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();
  const htmlPath = join(temp, "Export.html"),
    pdfPath = join(temp, "Export.pdf");
  const prepare = async (format, target) => {
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, target);
    await page.getByRole("button", { name: "Document menu", exact: true }).click();
    await page.getByRole("button", { name: "Export note…", exact: true }).click();
    await page.getByRole("combobox", { name: "Export format" }).selectOption(format);
    await page.getByRole("button", { name: "Prepare export", exact: true }).click();

    await page
      .locator(".export-summary")
      .waitFor({ timeout: 45000 })
      .catch(async (error) => {
        console.log("Export UI:", await page.locator("body").innerText());
        for (const child of app.windows())
          if (child !== page && !child.isClosed())
            console.log("Export child:", await child.locator("body").innerText());
        throw error;
      });
    assert.equal(
      await page.locator(".export-summary li").count(),
      0,
      await page.locator(".export-summary").innerText(),
    );
    await page.getByRole("button", { name: "Save export…", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Export note", exact: true })
      .waitFor({ state: "hidden" });
  };
  await prepare("html", htmlPath);
  const html = await readFile(htmlPath, "utf8");
  assert.ok(html.includes("data:image/svg+xml;base64,"));
  assert.ok(html.includes("data:application/octet-stream;base64,AQIDBA=="));
  assert.ok(!html.includes("folio://"));
  assert.ok(!html.includes("file://"));
  assert.ok(html.includes("<svg"));
  assert.ok(!html.includes("<script"));
  await prepare("pdf", pdfPath);
  const extracted = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  assert.ok(
    extracted.includes("Start") && extracted.includes("Finish"),
    "PDF preserves visible flowchart labels",
  );
  const opened = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }) => {
    const window = new BrowserWindow({
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "export-offline-proof",
      },
    });
    void window.loadURL("about:blank");
  });
  const offline = await opened;
  const protocol = await offline.context().newCDPSession(offline);
  await protocol.send("Network.enable");
  await protocol.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  const network = [];
  offline.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.getByText("Start", { exact: true }).waitFor();
  await offline.getByText("Finish", { exact: true }).waitFor();
  assert.ok(
    await offline
      .locator("img")
      .evaluateAll(
        (images) =>
          images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0),
      ),
  );
  assert.equal(await offline.evaluate(() => typeof window.folio), "undefined");
  assert.deepEqual(network, []);
  await offline.screenshot({ path: join(temp, "offline-export.png"), fullPage: true });
  await offline.close();
  assert.ok((await readFile(pdfPath)).subarray(0, 5).toString() === "%PDF-");
  assert.equal(await readFile(join(vault, "Note.md"), "utf8"), note);
  console.log(
    "PASS: immutable note snapshot, standalone HTML assets/fonts/diagrams/drawing/download, PDF print and unchanged source. Outputs:",
    htmlPath,
    pdfPath,
  );
} finally {
  await app?.close();
}
