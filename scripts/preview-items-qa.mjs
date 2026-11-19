// Synthetic notes only. Native Electron and fake-GitHub browser coverage.
import { _electron as electron, chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";
const target = process.env.GROVE_DOCUMENT_WEB_URL;
const table = "| A | B |\n| --- | --- |\n| One | Two |";
const original =
  '---\ntitle: Keep properties\n---\n\n# Control title\n\nA [Docs](Old.md "old title") and [[Other|Alias]].\n\n' +
  table +
  "\n\n" +
  table +
  '\n\n![Original alt](image.svg "old image title")\n\n```javascript\nconst value = 1;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n<!-- keep comment -->\n\nLast unchanged paragraph.\n';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="green"/></svg>';
const notes = {
  "Controls-formatted.md": original,
  "Controls-live.md": original,
  "image.svg": image,
  "image2.svg": image,
  "Other.md": "# Other\n",
};
const output = resolve(`qa-artifacts/preview-items-${target ? "web" : "desktop"}`);
await mkdir(output, { recursive: true });
let app, browser, page, fake, vault;
async function choosePreview(style) {
  await page.getByLabel("Preview editing style").first().click();
  await page
    .getByRole("option", { name: style === "live" ? "Live Preview" : "Formatted", exact: true })
    .click();
}
try {
  if (target) {
    fake = createFakeGitHub(notes);
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("https://api.github.com/**", async (route) => {
      const request = route.request(),
        headers = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization,Content-Type,Accept,X-GitHub-Api-Version",
          "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
        };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const response = await fake.fetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        ...(request.postData() ? { body: request.postData() } : {}),
      });
      await route.fulfill({
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...headers },
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    page = await context.newPage();
    await page.goto(target);
    const fallback = page.getByRole("button", { name: "Use a GitHub token instead" });
    if (await fallback.isVisible()) await fallback.click();
    await page.getByLabel("GitHub owner", { exact: true }).fill("fixture");
    await page.getByLabel("Repository", { exact: true }).fill("vault");
    await page.getByLabel("Branch", { exact: true }).fill("main");
    await page.getByLabel("Fine-grained access token", { exact: true }).fill("fixture-token");
    await page.getByRole("button", { name: "Open vault", exact: true }).click();
  } else {
    const temp = await mkdtemp(join(tmpdir(), "grove-controls-")),
      profile = join(temp, "profile");
    vault = join(temp, "vault");
    await mkdir(vault);
    await mkdir(profile);
    await Promise.all(
      Object.entries(notes).map(([path, value]) => writeFile(join(vault, path), value)),
    );
    await writeFile(
      join(profile, "state.json"),
      JSON.stringify({
        vault,
        tabs: [],
        settings: { theme: "dark", font: "sans", readingWidth: 0 },
      }),
    );
    const executablePath = process.env.FOLIO_SMOKE_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["."]),
        "--ozone-platform=x11",
        `--user-data-dir=${profile}`,
      ],
    });
    if (process.env.GROVE_EXPECT_VERSION)
      assert.equal(
        await app.evaluate(({ app }) => app.getVersion()),
        process.env.GROVE_EXPECT_VERSION,
      );
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  }
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const source = (path) => (vault ? readFile(join(vault, path), "utf8") : fake.text(path));
  const until = async (check, label) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw Error(`Timed out: ${label}`);
  };
  for (const style of ["formatted", "live"]) {
    const path = `Controls-${style}.md`;
    await page.locator(`.file-row[data-path="${path}"]`).first().dblclick();
    await page.locator(`.tabs [data-path="${path}"].active`).waitFor();
    await choosePreview(style);
    const note = page
      .getByRole("textbox", {
        name: style === "live" ? "Editable live preview" : "Editable note preview",
        exact: true,
      })
      .first();
    await until(async () => (await note.innerText()).includes("Control title"), "note ready");
    await page.waitForTimeout(300);
    const toolbar = page.getByRole("toolbar", { name: "Markdown formatting", exact: true }).first();
    const itemAction = async (element, name) => {
      await element.click({ button: "right" });
      await page
        .getByRole("menu", { name: "Item actions", exact: true })
        .getByRole("menuitem", { name, exact: true })
        .click();
    };
    const first = note.locator("table").first();
    await first.locator("tr").nth(1).locator("td").first().click();
    await page.keyboard.type("X");
    if (style === "live") {
      await first
        .locator("td")
        .first()
        .evaluate((cell) => {
          const editor = cell.closest(".tiptap").editor;
          editor.commands.insertContent("A");
          editor.commands.insertContent("B");
          editor.commands.insertContent("C");
        });
      await until(
        async () => (await first.locator("td").first().innerText()).includes("ABC"),
        "rapid table edits remain rendered",
      );
      await page.keyboard.press("Control+s");
      await until(
        async () => (await source(path)).includes("ABC"),
        "rapid table edits remain saved",
      );
      await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
      await until(
        async () => !(await first.locator("td").first().innerText()).includes("ABC"),
        "global toolbar undoes the active live table",
      );
      await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
      await until(
        async () => (await first.locator("td").first().innerText()).includes("ABC"),
        "global toolbar redoes the active live table",
      );
    }
    assert.equal(
      await page.getByRole("toolbar", { name: "Item editing", exact: true }).count(),
      0,
      "Editing controls must not add a permanent bar",
    );
    const tableAction = async (
      name,
      section,
      cell = first.locator("tr").nth(1).locator("td").first(),
    ) => {
      await cell.click({ button: "right" });
      const menu = page.getByRole("menu", { name: "Table actions", exact: true });
      await menu.waitFor();
      if (section) await menu.getByRole("menuitem", { name: section, exact: true }).hover();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      for (const popup of await page.getByRole("menu").all()) {
        const box = await popup.boundingBox();
        assert.ok(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y + box.height <= viewport.height + 1,
          "Root and nested menus stay within the viewport",
        );
      }
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    // Keyboard menus must leave the rich editor's caret and source untouched.
    const tableCell = first.locator("tr").nth(1).locator("td").first();
    const selection = await tableCell.evaluate((cell) =>
      cell.closest(".tiptap").editor.state.selection.toJSON(),
    );
    await tableCell.click({ button: "right" });
    let contextMenu = page.getByRole("menu", { name: "Table actions", exact: true });
    await contextMenu.focus();
    await page.keyboard.press("Home");
    await until(
      async () =>
        page
          .getByRole("menuitem", { name: "Row", exact: true })
          .evaluate((element) => element === document.activeElement),
      "Home focuses first menu item",
    );
    await page.keyboard.press("ArrowRight");
    const submenu = page.getByRole("menu", { name: "Row", exact: true });
    await submenu.waitFor();
    await page.keyboard.press("End");
    await until(
      async () =>
        submenu
          .getByRole("menuitem", { name: "Delete row", exact: true })
          .evaluate((element) => element === document.activeElement),
      "End focuses last submenu item",
    );
    await page.keyboard.press("ArrowLeft");
    await until(async () => !(await submenu.isVisible()), "Left closes submenu");
    await page.keyboard.press("a");
    await until(
      async () =>
        page
          .getByRole("menuitem", { name: "Align column left", exact: true })
          .evaluate((element) => element === document.activeElement),
      "menu typeahead",
    );
    await page.keyboard.press("Escape");
    await until(async () => !(await contextMenu.isVisible()), "Escape dismisses root menu");
    assert.deepEqual(
      await tableCell.evaluate((cell) => cell.closest(".tiptap").editor.state.selection.toJSON()),
      selection,
      "Menu keyboard navigation preserves editor selection",
    );
    await tableCell.click({ button: "right" });
    await contextMenu.waitFor();
    const codeBlock = note
      .locator(style === "live" ? ".cm-live-widget" : ".rich-code")
      .filter({ hasText: "const value = 1;" })
      .first();
    await codeBlock.click({ button: "right" });
    const replacementMenu = page.getByRole("menu", { name: "Item actions", exact: true });
    await replacementMenu.waitFor();
    await page.waitForTimeout(150);
    assert.ok(
      await replacementMenu.isVisible(),
      "Opening another item menu must not be dismissed by the old menu restoring focus",
    );
    await page.keyboard.press("Escape");
    await tableCell.click({ button: "right" });
    await (
      style === "live"
        ? note.locator(".cm-live-h1")
        : page.getByRole("heading", { name: "Control title", exact: true })
    ).click();
    await until(async () => !(await contextMenu.isVisible()), "outside click dismisses menu");
    await tableAction("Insert row below", "Row");
    assert.equal(await first.locator("tr").count(), 3);
    await tableAction("Insert column right", "Column");
    assert.equal(await first.locator("tr").first().locator("th,td").count(), 3);
    await first.locator("tr").nth(1).locator("td").first().click();
    await tableAction("Align column center");
    assert.equal(
      await first
        .locator("th")
        .first()
        .evaluate((el) => el.style.textAlign),
      "center",
    );
    await page.keyboard.press("Control+s");
    await until(
      async () => (await source(path)).includes(":---:") || /:\s*-{2,}:/.test(await source(path)),
      "table save",
    );
    assert.equal(
      (await source(path)).split(table).length - 1,
      1,
      "The duplicate table stays exact",
    );
    assert.ok(
      (await source(path)).startsWith("---\ntitle: Keep properties\n---\n\n# Control title\n\n"),
    );
    assert.ok(
      (await source(path)).endsWith("<!-- keep comment -->\n\nLast unchanged paragraph.\n"),
    );
    const itemToolbar = toolbar;
    await first.locator("tr").nth(2).locator("td").first().click();
    await tableAction("Delete row", "Row", first.locator("tr").nth(2).locator("td").first());
    assert.equal(await first.locator("tr").count(), 2);
    await itemToolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await until(async () => (await first.locator("tr").count()) === 3, "row deletion undo");
    await first.locator("tr").nth(1).locator("td").nth(1).click();
    await tableAction("Delete column", "Column", first.locator("tr").nth(1).locator("td").nth(1));
    assert.equal(await first.locator("tr").first().locator("th,td").count(), 2);
    await itemToolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await until(
      async () => (await first.locator("tr").first().locator("th,td").count()) === 3,
      "column deletion undo",
    );
    await first.locator("th").first().click();
    await tableAction("Delete row", "Row", first.locator("th").first());
    assert.equal(
      await first.locator("tr").first().locator("th").count(),
      3,
      "Deleting a header promotes the next Markdown row",
    );
    await itemToolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await until(async () => (await first.locator("tr").count()) === 3, "header deletion undo");
    await page.screenshot({ path: join(output, `${style}-table.png`) });
    console.log(
      "PASS",
      style,
      "editable cells, rows, columns, alignment and duplicate/source preservation",
    );
    // Edit an existing link through the shared toolbar, preserving its label and title fields.
    await note
      .locator(style === "live" ? '[data-live-target="Old.md"]' : 'a[href="Old.md"]')
      .first()
      .click();
    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Edit link", exact: true });
    await dialog.waitFor();
    await dialog.getByLabel("Link address", { exact: true }).fill("New note.md");
    await dialog.getByLabel("Link text", { exact: true }).fill("Updated docs");
    await dialog.getByLabel("Title", { exact: true }).fill("New title");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await page.keyboard.press("Control+s");
    await until(
      async () =>
        (await source(path)).includes("Updated docs") &&
        (await source(path)).includes("New note.md"),
      "link save",
    );
    // Unsafe addresses are rejected without closing the dialog or changing the note.
    if (style === "formatted") await note.locator('a[href="New note.md"]').first().click();
    else {
      await note.locator(".cm-line").filter({ hasText: "Updated docs" }).first().click();
      await page.keyboard.press("Home");
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    }
    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Edit link", exact: true });
    await dialog.getByLabel("Link address", { exact: true }).fill("javascript&colon;alert(1)");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    if (style === "formatted")
      await note.getByRole("button", { name: "Edit wiki link", exact: true }).first().click();
    else {
      await note.locator(".cm-line").filter({ hasText: "Updated docs" }).first().click();
      await page.keyboard.press("End");
      for (let index = 0; index < 3; index++) await page.keyboard.press("ArrowLeft");
      await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    }
    dialog = page.getByRole("dialog", { name: "Edit link", exact: true });
    await dialog.getByLabel("Link address", { exact: true }).fill("OtherPage");
    await dialog.getByLabel("Link text", { exact: true }).fill("Different alias");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await page.keyboard.press("Control+s");
    await until(
      async () => (await source(path)).includes("[[OtherPage|Different alias]]"),
      "wiki save",
    );
    await itemAction(note.locator('img[alt="Original alt"]').first(), "Edit media");
    dialog = page.getByRole("dialog", { name: "Edit media", exact: true });
    await dialog.getByLabel("File or image address", { exact: true }).fill("image2.svg");
    await dialog.getByLabel("Description or size", { exact: true }).fill("Changed alt");
    await dialog.getByLabel("Title", { exact: true }).fill("Caption");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await page.keyboard.press("Control+s");
    await until(
      async () => (await source(path)).includes('![Changed alt](<image2.svg> "Caption")'),
      "media properties save",
    );
    await itemAction(note.locator('img[alt="Changed alt"]').first(), "Edit media");
    dialog = page.getByRole("dialog", { name: "Edit media", exact: true });
    await dialog.getByRole("button", { name: "Remove embed", exact: true }).click();
    await page.keyboard.press("Control+s");
    await until(async () => !(await source(path)).includes("Changed alt"), "embed removal");
    assert.equal(await source("image.svg"), image, "Removing an embed must not delete its file");
    assert.equal(await source("image2.svg"), image, "Replacing an embed must not mutate its file");
    const replaceText = async (editor, text) => {
      await editor.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.insertText(text);
      await page.keyboard.press("Control+s");
    };
    if (style === "formatted") {
      const properties = note
        .locator(".rich-preserved-block")
        .filter({ hasText: "Properties" })
        .first();
      await itemAction(properties, "Edit source");
      await replaceText(properties.locator(".cm-content"), "---\ntitle: Updated properties\n---");
      await until(
        async () => (await source(path)).includes("title: Updated properties"),
        "properties source save",
      );
      await properties.getByRole("button", { name: "Done", exact: true }).click();
      const code = note.locator(".rich-code").first();
      await code.getByRole("button", { name: "Edit", exact: true }).click();
      await replaceText(code.locator(".cm-content"), "const value = 2;");
      await code.getByLabel("Code language", { exact: true }).fill("typescript");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Control+s");
    } else {
      await note
        .locator(".live-protected")
        .filter({ hasText: "Properties" })
        .getByRole("button", { name: "Edit source", exact: true })
        .click();
      await note.locator(".cm-line").filter({ hasText: "title: Keep properties" }).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.insertText("title: Updated properties");
      await note.getByRole("button", { name: "Edit code source", exact: true }).first().click();
      await note.locator(".cm-line").filter({ hasText: "const value = 1;" }).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.insertText("const value = 2;");
      await note.locator(".cm-line").filter({ hasText: "```javascript" }).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.insertText("```typescript");
      await page.keyboard.press("Control+s");
    }
    await until(
      async () => (await source(path)).includes("```typescript\nconst value = 2;"),
      "code body and language save",
    );
    await note.getByRole("button", { name: "Edit diagram source", exact: true }).click();
    if (style === "formatted") {
      const diagram = note.locator(".rich-code").filter({ hasText: "Done" }).last();
      await replaceText(diagram.locator(".cm-content"), "flowchart LR\n A --> C");
      await diagram.getByRole("button", { name: "Done", exact: true }).click();
    } else {
      await note.locator(".cm-line").filter({ hasText: "A --> B" }).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.insertText(" A --> C");
      await page.keyboard.press("Control+s");
      await note.locator(".cm-line").filter({ hasText: "Last unchanged paragraph" }).click();
    }
    await until(async () => (await source(path)).includes("A --> C"), "diagram source save");
    await itemAction(note.locator(".diagram-block").first(), "Remove diagram");
    await page.keyboard.press("Control+s");
    await until(async () => !(await source(path)).includes("```mermaid"), "diagram removal");
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await page.keyboard.press("Control+s");
    await until(async () => (await source(path)).includes("```mermaid"), "diagram undo");
    console.log(
      "PASS",
      style,
      "links, wiki aliases, media, properties, code languages and diagrams with undo",
    );
    // Remove only the first table, then restore it with the owning editor history.
    await first.locator("tr").nth(1).locator("td").first().click();
    await tableAction("Delete table");
    await until(async () => (await note.locator("table").count()) === 1, "table deletion");
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await until(async () => (await note.locator("table").count()) === 2, "table undo");
    await page.keyboard.press("Control+s");
    await page.screenshot({ path: join(output, `${style}-items.png`) });
    const controls = page.getByRole("toolbar", { name: "Document view", exact: true });
    await controls.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await tableCell.click({ button: "right" });
    contextMenu = page.getByRole("menu", { name: "Table actions", exact: true });
    await contextMenu.waitFor();
    assert.ok(
      await contextMenu.evaluate((element) => document.fullscreenElement.contains(element)),
      "Menu portal belongs to fullscreen content",
    );
    await contextMenu.getByRole("menuitem", { name: "Column", exact: true }).hover();
    const columnMenu = page.getByRole("menu", { name: "Column", exact: true });
    await columnMenu.waitFor();
    assert.ok(
      await columnMenu.evaluate((element) => document.fullscreenElement.contains(element)),
      "Submenu portal belongs to fullscreen content",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await controls.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
  }
  await choosePreview("formatted");
  await page.getByRole("radio", { name: "Split", exact: true }).click();
  const rich = page.getByRole("textbox", { name: "Editable note preview", exact: true }).first();
  await rich.locator("td").first().click({ button: "right" });
  const staleMenu = page.getByRole("menu", { name: "Table actions", exact: true });
  await staleMenu.waitFor();
  const replacement = "| Replacement | Value |\n| --- | --- |\n| New | Safe |\n";
  await page
    .locator(".editor-wrap:not(.live-preview) .cm-content")
    .first()
    .evaluate((element, text) => {
      const view = element.cmTile.root.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }, replacement);
  await rich.getByRole("columnheader", { name: "Replacement", exact: true }).waitFor();
  await until(
    async () => !(await staleMenu.isVisible()),
    "source replacement closes a stale table menu",
  );
  assert.equal(await rich.locator("table").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Radix menu hover, keyboard, typeahead, dismissal, editor selection, viewport placement, fullscreen and direct item controls.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    await writeFile(
      join(output, "failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await app?.close();
  await browser?.close();
}
