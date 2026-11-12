// Exercises the actual toolbar, selection, history, vault picker and draft-safe embeds.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const temp = await mkdtemp(join(tmpdir(), "grove-toolbar-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
const screenshots = resolve("qa-artifacts/markdown-toolbar");
await Promise.all([
  mkdir(join(vault, "notes"), { recursive: true }),
  mkdir(join(vault, "assets"), { recursive: true }),
  mkdir(profile),
  mkdir(screenshots, { recursive: true }),
]);
await writeFile(join(profile, "state.json"), JSON.stringify({ vault, tabs: [] }));
await writeFile(join(vault, "notes", "Existing.md"), "# Existing\n");
await writeFile(join(vault, "api.ts"), "export const value = 1;\n");
const chartPath = join(vault, "notes", "Charts.md");
await writeFile(chartPath, '# Charts\n\n## Progress\n\n```mermaid\npie\n  "Done" : 4\n```\n');
const image = "assets/Café #[1] 🌱.png";
await copyFile("build/icon.png", join(vault, image));
await writeFile(
  join(vault, "assets", "Sketch.excalidraw"),
  JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }),
);
let app;
try {
  const executable = process.env.FOLIO_SMOKE_EXECUTABLE;
  app = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [...(executable ? [] : ["."]), "--ozone-platform=x11", `--user-data-dir=${profile}`],
  });
  if (process.env.GROVE_EXPECT_VERSION)
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      process.env.GROVE_EXPECT_VERSION,
    );
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.locator('.file-row[data-path="notes/Existing.md"]').waitFor();
  await page.keyboard.press("Control+n");
  let editor = page.locator(".cm-content").first();
  const toolbar = page.getByRole("toolbar", { name: "Markdown formatting" }).first();
  await toolbar.waitFor();
  const text = async () => (await editor.locator(".cm-line").allTextContents()).join("\n");
  const reset = async (value) => {
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(value);
    await page.keyboard.press("Control+a");
  };
  const tool = (name) => toolbar.getByRole("button", { name, exact: true });
  await reset("hello");
  await tool("Bold").click();
  assert.equal(await text(), "**hello**");
  await tool("Undo").click();
  assert.equal(await text(), "hello");
  await tool("Redo").click();
  assert.equal(await text(), "**hello**");
  await tool("Italic").click();
  assert.equal(await text(), "***hello***");
  await page.keyboard.press("Control+i");
  assert.equal(await text(), "**hello**");
  assert.equal(await page.locator(".cm-focused").count(), 1, "toolbar returns focus to editor");
  await reset("Title");
  await toolbar.getByLabel("Heading").selectOption("h2");
  assert.equal(await text(), "## Title");
  await reset("one\ntwo");
  await tool("Bulleted list").click();
  assert.equal(await text(), "- one\n- two");
  await tool("Numbered list").click();
  assert.equal(await text(), "1. one\n2. two");
  await tool("Task list").click();
  assert.equal(await text(), "- [ ] one\n- [ ] two");
  await reset("one\ntwo");
  await tool("Quote").click();
  assert.equal(await text(), "> one\n> two");
  await reset("a`b");
  await tool("Code").click();
  assert.equal(await text(), "``a`b``");
  await reset("words");
  await tool("Link").click();
  await page.keyboard.insertText("https://example.com");
  assert.equal(await text(), "[words](https://example.com)", "link destination is selected");

  // Inserting into a new draft must not assume where its first Save will put it.
  await reset("# Insert test\n\n");
  await page.keyboard.press("Control+End");
  await tool("Insert from vault").click();
  let dialog = page.getByRole("dialog", { name: "Insert from vault", exact: true });
  await dialog.getByLabel("Search vault files").fill("Café");
  await dialog.getByText(image, { exact: true }).click();
  await dialog.getByLabel("Insert as").selectOption("embed");
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.ok(
    (await text()).includes("</assets/Caf%C3%A9%20%23%5B1%5D%20%F0%9F%8C%B1.png>"),
    await text(),
  );
  await page.keyboard.press("Control+s");
  const save = page.getByRole("dialog", { name: "Save note", exact: true });
  await save.getByLabel("Folder").selectOption("notes");
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('.tab.active[data-path="notes/Insert test.md"]').waitFor();
  assert.ok((await readFile(join(vault, "notes", "Insert test.md"), "utf8")).includes("</assets/"));
  await page
    .locator(".title-actions")
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  assert.equal(await page.getByRole("toolbar", { name: "Markdown formatting" }).count(), 0);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".md img")].some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.locator(".title-actions").getByRole("button", { name: "Edit", exact: true }).click();
  editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("Control+End");
  await tool("Insert from vault").click();
  dialog = page.getByRole("dialog", { name: "Insert from vault", exact: true });
  await dialog.getByRole("button", { name: "Mermaid", exact: true }).click();
  await dialog.getByText("notes/Charts.md", { exact: true }).click();
  await dialog.getByLabel("Mermaid block").waitFor();
  await page.screenshot({ path: join(screenshots, "insert-mermaid.png") });
  await writeFile(chartPath, '# Charts\n\n## Updated\n\n```mermaid\npie\n  "Done" : 7\n```\n');
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "source note changed" }).waitFor();
  assert.equal((await text()).includes('"Done" : 7'), false, "changed source requires review");
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.ok((await text()).includes('"Done" : 7'));
  assert.ok((await readFile(chartPath, "utf8")).includes('"Done" : 7'), "original note unchanged");

  // Embed the existing drawing, not a copied attachment or a broken image.
  await tool("Insert from vault").click();
  dialog = page.getByRole("dialog", { name: "Insert from vault", exact: true });
  await dialog.getByText("assets/Sketch.excalidraw", { exact: true }).click();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".title-actions").getByRole("button", { name: "Split", exact: true }).click();
  assert.equal(await page.getByRole("toolbar", { name: "Markdown formatting" }).count(), 1);
  await page.locator('.drawing-embed[data-export-ready="true"]').waitFor();
  assert.ok(!(await page.locator(".drawing-caption").innerText()).includes("unavailable"));
  await page.screenshot({ path: join(screenshots, "split-light.png") });
  await page.getByRole("button", { name: "Toggle light/dark", exact: true }).click();
  await page.screenshot({ path: join(screenshots, "split-dark.png") });

  // Code editing must not receive Markdown commands or a Markdown toolbar.
  await page.locator('.file-tree .file-row[data-path="api.ts"]').dblclick();
  await page.locator('.tab.active[data-path="api.ts"]').waitFor();
  await page.locator(".title-actions").getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByRole("toolbar", { name: "Markdown formatting" }).count(), 0);
  await page.locator('.file-tree .file-row[data-path="notes/Insert test.md"]').dblclick();
  await page.locator('.tab.active[data-path="notes/Insert test.md"]').waitFor();
  await page.locator(".title-actions").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Open beside", exact: true }).click();
  const left = page.locator('.document-pane[data-pane="primary"]');
  const right = page.locator('.document-pane[data-pane="secondary"]');
  await right.getByRole("button", { name: "Edit", exact: true }).click();
  await left.getByRole("button", { name: "Edit", exact: true }).click();
  editor = left.locator(".cm-content");
  await reset("shared");
  await left.getByRole("button", { name: "Bold", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cm-content")].every(
      (editor) => editor.textContent === "**shared**",
    ),
  );
  await left.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cm-content")].every(
      (editor) => editor.textContent === "shared",
    ),
  );
  const size = await left.locator(".markdown-toolbar").evaluate((toolbar) => ({
    width: toolbar.clientWidth,
    content: toolbar.scrollWidth,
    pane: toolbar.closest(".document-pane").clientWidth,
  }));
  assert.ok(size.width <= size.pane, "toolbar scrolls within its pane");
  assert.deepEqual(errors, [], "no renderer exceptions");
  console.log(
    `PASS: formatting, selection, undo/redo, draft save, Unicode embed, stale Mermaid source, drawing, split, themes, code exclusion and shared panes. Screenshots: ${screenshots}. Fixture: ${temp}`,
  );
} finally {
  await app?.close();
}
