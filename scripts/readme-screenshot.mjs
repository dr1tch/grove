// Captures docs/screenshot-light.png and docs/screenshot-dark.png for the README from a demo vault.
// Usage: xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/readme-screenshot.mjs
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = await mkdtemp(join(tmpdir(), "grove-readme-")),
  vault = join(temp, "Garden"),
  profile = join(temp, "profile");
for (const dir of ["Projects", "Research", "Daily", "Drawings"])
  await mkdir(join(vault, dir), { recursive: true });
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
const note = "Projects/Launch plan.md";
await writeFile(
  join(vault, note),
  `# Launch plan

A short plan for the spring release. See also [[Ideas]].

\`\`\`mermaid
flowchart LR
  Draft --> Review --> Publish
\`\`\`

| Milestone | Owner | Due |
|---|---|---|
| Beta build | Sam | Mar 4 |
| Public release | Team | Mar 18 |

- [x] Freeze features
- [x] Write release notes
- [ ] Record the demo video
`,
);
await writeFile(
  join(vault, "Projects", "api.ts"),
  `export interface Note {
  path: string;
  title: string;
  tags: string[];
}

export async function loadNotes(root: string): Promise<Note[]> {
  const files = await listMarkdown(root);
  return files.map((path) => toNote(path));
}

function titleOf(path: string) {
  return path.split("/").pop()!.replace(/\\.md$/, "");
}
`,
);
await writeFile(join(vault, "Research", "Reading list.md"), "# Reading list\n");
await writeFile(join(vault, "Research", "Interviews.csv"), "name,role\nAna,Designer\n");
await writeFile(join(vault, "Daily", "2026-11-11.md"), "# 2026-11-11\n");
await writeFile(join(vault, "Ideas.md"), "# Ideas\n");
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
await app.evaluate(({ BrowserWindow }) => {
  const b = BrowserWindow.getAllWindows()[0];
  b.unmaximize();
  b.setSize(1440, 900);
});
await page.locator('.file-tree .file-row[data-path="Projects/api.ts"]').dblclick();
await page.locator(`.file-tree .file-row[data-path="${note}"]`).dblclick();
await page.locator(".tab.active").waitFor();
await page.getByRole("button", { name: "Open beside", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll(".document-pane").length === 2);
await page
  .locator('.document-pane[data-pane="secondary"] .pane-tabs button')
  .first()
  .click()
  .catch(() => {});
await page
  .locator('.document-pane[data-pane="secondary"]')
  .click({ position: { x: 30, y: 60 }, force: true });
await page.locator('.file-tree .file-row[data-path="Projects/api.ts"]').dblclick();
await page.mouse.move(5, 895);
for (const theme of ["light", "dark"]) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshot-${theme}.png` });
  await page.getByRole("button", { name: "Toggle light/dark" }).click();
  await page.mouse.move(5, 895);
}
await app.close();
