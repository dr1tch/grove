import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile, readFile, cp, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = resolve(import.meta.dirname, "..");
const output = process.env.FOLIO_PARITY_OUTPUT || join(homedir(), "parity/folio-2026-11-11");
const reference = "/tmp/folio-latest-c3ym01m0";
await mkdir(output, { recursive: true });
const temp = process.env.FOLIO_PARITY_FIXTURE || (await mkdtemp(join(tmpdir(), "folio-parity-")));
const vault = join(temp, "vault"),
  profile = join(temp, "profile"),
  appDir = join(temp, "app");
for (const dir of [vault, profile, appDir]) await mkdir(dir, { recursive: true });
// Freeze current output before the parent rebuilds. Never launch the real profile.
if (!process.env.FOLIO_PARITY_FIXTURE)
  await cp(join(repo, "out"), join(appDir, "out"), { recursive: true });
if (!process.env.FOLIO_PARITY_FIXTURE)
  await cp(join(repo, "build"), join(appDir, "build"), { recursive: true });
await cp(join(repo, "resources"), join(appDir, "resources"), { recursive: true });
execFileSync("ln", ["-sfn", join(repo, "node_modules"), join(appDir, "node_modules")]);
await writeFile(
  join(appDir, "package.json"),
  JSON.stringify({ name: "folio-parity", version: "0.1.0", main: "out/main/index.js" }),
);
const fingerprints = {};
async function hashTree(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await hashTree(path);
    else
      fingerprints[path.slice(appDir.length + 1)] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
}
await hashTree(join(appDir, "out"));
await hashTree(join(appDir, "resources"));
const note =
  "# Local-first sync\n\nThis note tracks how the vault stays in sync across devices without a server owning the data. Files on disk remain the source of truth: every note is plain Markdown, every drawing is an `.excalidraw` JSON file, and any folder you already have opens as it is.\n\n## Goals\n\n- Open any folder without importing or converting it.\n- Never lose a keystroke, whether it came from a person or an agent.\n  - Edits land in a change log before they touch the file.\n  - External changes are detected and never silently overwritten.\n- Keep drawings editable: the source JSON and the rendered preview travel together.\n\n## Status\n\n- [x] Prototype the change log in SQLite\n- [x] Define merge rules for Markdown blocks\n- [ ] Benchmark sync on a 10,000-note vault\n  - [x] Cold start\n  - [ ] Incremental, 50 edits per second\n- [ ] Decide between a relay and direct peer discovery\n\n## Architecture\n\nFiles remain the source of truth.\n";
await writeFile(join(vault, "Local-first sync.md"), note);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({
    vault,
    tabs: [{ path: "Local-first sync.md", mode: "preview" }],
    active: "Local-first sync.md",
    settings: { theme: "light" },
    bounds: { width: 1400, height: 900 },
  }),
);
const manifest = {
  viewport: "1400x900",
  mode: "design",
  baseline: !process.env.FOLIO_PARITY_PREVIOUS_MANIFEST,
  previousManifest: process.env.FOLIO_PARITY_PREVIOUS_MANIFEST || null,
  previousReport: process.env.FOLIO_PARITY_PREVIOUS_REPORT || null,
  intentionalDifferences: [
    "Reading typography follows the specification: Source Serif 4 at 17px. Residual reference font metrics are intentional; do not force pixel matching.",
  ],
  originalTheme: "light",
  capturedAt: new Date().toISOString(),
  referenceFolder: reference,
  temporaryFixture: temp,
  buildFingerprints: fingerprints,
  pairs: [],
  limitations: [
    "Capture of a frozen copy of the stable production output; later rebuilds are excluded.",
    "Temporary vault approximates the reference note. Sidebar data, tabs, timestamps and document metadata differ.",
    "No settings references exist in the supplied folder.",
    "Reference export clips the right window edge. Crop removes the outer backdrop, then fits without stretching; a narrow horizontal padding remains.",
    "Static reference images cannot supply reaction probes. Only requested main/settings states captured.",
  ],
};
execFileSync("/usr/bin/python3", [
  "-I",
  "-c",
  `from PIL import Image, ImageOps\nfrom pathlib import Path\nroot=Path(${JSON.stringify(reference)})\nout=Path(${JSON.stringify(output)})\nfor n,theme in [('01','Light'),('03','Dark')]:\n im=Image.open(root/('Main window · '+theme+'.png')).convert('RGB')\n im=im.crop((64,56,2880,1896))\n fitted=ImageOps.contain(im,(1400,900),Image.Resampling.LANCZOS)\n canvas=Image.new('RGB',(1400,900),im.getpixel((im.width-1,im.height//2)))\n canvas.paste(fitted,((1400-fitted.width)//2,0))\n canvas.save(out/(n+'-main-'+theme.lower()+'-proto.png'))\n`,
]);
let app;
try {
  app = await electron.launch({
    executablePath: join(repo, "node_modules/electron/dist/electron"),
    args: ["--ozone-platform=x11", appDir, `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);
  await app.evaluate(
    ({ app }, vaultPath) => app.emit("second-instance", {}, ["electron", "app", vaultPath]),
    vault,
  );
  await page.getByText("Local-first sync", { exact: true }).first().dblclick();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1400, 900),
  );
  await page.getByRole("heading", { name: "Local-first sync", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const [theme, base] of [
    ["light", 1],
    ["dark", 3],
  ]) {
    if (theme === "dark") await page.getByRole("button", { name: "Toggle light/dark" }).click();
    for (const [state, offset] of [
      ["main", 0],
      ["settings", 1],
    ]) {
      if (state === "settings")
        await page.getByRole("button", { name: "Settings (Ctrl+,)" }).click();
      await page.mouse.move(1390, 890);
      await page.waitForTimeout(2500);
      const id = String(base + offset).padStart(2, "0"),
        slug = `${state}-${theme}`;
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        theme: document.documentElement.dataset.theme,
      }));
      if (dimensions.width !== 1400 || dimensions.height !== 900)
        throw Error(JSON.stringify(dimensions));
      await page.screenshot({ path: join(output, `${id}-${slug}-impl.png`) });
      manifest.pairs.push({
        id,
        slug,
        page: state,
        state: theme,
        screen: `Folio ${state} (${theme})`,
        proto: state === "main" ? `${id}-${slug}-proto.png` : null,
        impl: `${id}-${slug}-impl.png`,
        status: state === "main" ? "ok" : "missing-proto",
        url: page.url(),
        dimensions,
        contentDiffers: true,
        referenceSource:
          state === "main"
            ? join(reference, `Main window · ${theme === "light" ? "Light" : "Dark"}.png`)
            : null,
        referenceTransform:
          state === "main"
            ? {
                sourceSize: [2880, 1960],
                crop: [64, 56, 2880, 1896],
                method: "contain, centered horizontally, no stretching",
                targetSize: [1400, 900],
              }
            : null,
        notes:
          state === "main"
            ? "Temporary Local-first sync.md, pinned by double-click in the sidebar, displayed in Preview mode. Source Serif 4 at 17px follows the specification; residual reference font metrics are intentional. Reference right edge is clipped in source. Content and sidebar differ."
            : "Opened Settings (Ctrl+,). No matching supplied reference.",
      });
      if (state === "settings") await page.getByRole("button", { name: "Close dialog" }).click();
    }
  }
  await page.getByRole("button", { name: "Toggle light/dark" }).click();
  manifest.rendererErrors = errors;
} finally {
  if (app) await app.close();
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(join(output, "manifest.json"));
