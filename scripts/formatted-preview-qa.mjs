// Formatted typing in real isolated desktop/browser editors. No private notes or repositories.
import { _electron as electron, chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";
const target = process.env.GROVE_DOCUMENT_WEB_URL;
const properties = "---\ntitle: Preserved properties\n---\n\n";
const duplicate = "```markdown meta\n# Embedded title\n\nEmbedded **bold** text.\n```";
const tail =
  "\n\n<!-- untouched comment -->\n\n- [ ] Task\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```javascript\nconst untouched = 1;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n[id]: Other.md\n\n## More\n\nOutline section.\n\n## Last\n\nLast section.\n";
const original =
  properties +
  "# Rich title\n\nA **bold** and _italic_ paragraph with [[Other|Wiki]] and [note][id].\n\n" +
  duplicate +
  "\n\n" +
  duplicate +
  tail;
const output = resolve(`qa-artifacts/formatted-preview-${target ? "web" : "desktop"}`);
await mkdir(output, { recursive: true });
let app, browser, page, fake, file;
try {
  if (target) {
    fake = createFakeGitHub({ "Rich.md": original, "Other.md": "# Other\n" });
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("https://api.github.com/**", async (route) => {
      const request = route.request();
      const headers = {
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
    const temp = await mkdtemp(join(tmpdir(), "grove-rich-")),
      vault = join(temp, "vault"),
      profile = join(temp, "profile");
    await mkdir(vault);
    await mkdir(profile);
    file = join(vault, "Rich.md");
    await writeFile(file, original);
    await writeFile(join(vault, "Other.md"), "# Other\n");
    await writeFile(join(profile, "state.json"), JSON.stringify({ vault, tabs: [] }));
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
  const source = async () => (file ? readFile(file, "utf8") : fake.text("Rich.md"));
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await page.locator('.file-row[data-path="Rich.md"]').first().dblclick();
  const note = page.getByRole("textbox", { name: "Editable note preview", exact: true });
  await note.waitFor();
  await note.getByRole("heading", { name: "Rich title", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await source(), original, "Opening Preview must not rewrite any source");
  const outline = page.getByRole("navigation", { name: "Document outline" });
  await outline.getByRole("button", { name: "Last", exact: true }).click();
  assert.ok(
    await note.evaluate(
      (element) => element.editor.state.selection.$from.parent.textContent === "Last",
    ),
  );

  await note.evaluate((element) => {
    element.dataset.qaIdentity = "same";
  });
  const paragraph = note.locator(":scope > p").filter({ hasText: "A bold" });
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added text.");
  await until(
    async () => (await paragraph.innerText()).includes("Added text."),
    "formatted paragraph typing",
  );
  assert.equal(await note.getAttribute("data-qa-identity"), "same");
  assert.equal(await paragraph.locator("strong").first().innerText(), "bold");
  assert.equal(await paragraph.locator("em").innerText(), "italic");
  await page.keyboard.down("Shift");
  for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page
    .getByRole("toolbar", { name: "Markdown formatting" })
    .first()
    .getByRole("button", { name: "Bold", exact: true })
    .click();
  await until(
    async () => (await paragraph.locator("strong").allTextContents()).join(" ").includes("text"),
    "formatting selected text",
  );
  await page.keyboard.press("Control+z");
  await until(
    async () => !(await paragraph.locator("strong").allTextContents()).join(" ").includes("text"),
    "undo formatting",
  );
  await page.keyboard.press("Control+Shift+z");
  await until(
    async () => (await paragraph.locator("strong").allTextContents()).join(" ").includes("text"),
    "redo formatting",
  );
  await page.keyboard.press("Control+s");
  await until(async () => (await source()).includes("Added"), "note save");
  assert.ok((await source()).startsWith(properties + "# Rich title\n\n"));
  assert.ok((await source()).endsWith(tail));
  assert.ok((await source()).includes("[[Other|Wiki]]"));
  assert.equal((await source()).split(duplicate).length - 1, 2);
  console.log(
    "PASS: formatted note typing, selection/format/undo, source preservation and normal saving.",
  );

  await paragraph.click();
  await page.keyboard.press("End");
  await paragraph.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      "<strong> pasted</strong><script>window.richPasteUnsafe=true</script>",
    );
    clipboardData.setData("text/plain", " pasted");
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  });
  await until(async () => (await paragraph.innerText()).includes("pasted"), "formatted HTML paste");
  assert.equal(await page.evaluate(() => window.richPasteUnsafe), undefined);
  assert.equal(await note.locator("script").count(), 0);
  await page.keyboard.insertText(" café 日本語");
  await until(async () => (await paragraph.innerText()).includes("日本語"), "Unicode input");
  assert.equal(await paragraph.locator("strong").first().innerText(), "bold");
  console.log("PASS: formatted paste, safe HTML handling and Unicode text input.");

  const blocks = note.locator(".rich-code");
  await blocks.nth(1).getByRole("button", { name: "Preview", exact: true }).click();
  const embed = blocks
    .nth(1)
    .getByRole("textbox", { name: "Editable embedded preview", exact: true });
  await embed.getByRole("heading", { name: "Embedded title", exact: true }).click();
  await page.keyboard.press("End");
  await embed.evaluate((element) => {
    element.dataset.identity = "child";
  });
  const typedInline = " changed inline" + " and keep typing".repeat(36);
  await page.keyboard.type(typedInline);
  await embed.getByRole("heading", { name: "Embedded title" + typedInline, exact: true }).waitFor();
  assert.equal(
    await embed.getAttribute("data-identity"),
    "child",
    "Typing keeps the nested editor mounted",
  );
  assert.equal(await page.getByRole("dialog", { name: "Edit embedded block" }).count(), 0);
  await until(
    async () => (await source()).includes("# Embedded title changed inline"),
    "inline embed save",
  );
  assert.equal(
    (await source()).split(duplicate).length - 1,
    1,
    "Other identical embed stays untouched",
  );
  assert.ok((await source()).endsWith(tail));
  await blocks.nth(1).getByRole("button", { name: "Edit", exact: true }).click();
  const code = blocks.nth(1).locator(".cm-content");
  await code.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# Inline source\n\nStill **formatted**.");
  await blocks.nth(1).getByRole("button", { name: "Done", exact: true }).click();
  await blocks.nth(1).getByRole("heading", { name: "Inline source", exact: true }).waitFor();
  await until(async () => (await source()).includes("# Inline source"), "inline source save");
  console.log(
    "PASS: fully formatted inline embed typing, source Edit/Preview, duplicate isolation and no popup.",
  );
  await page.screenshot({ path: join(output, "editing.png") });
  await page.reload();
  await page.getByRole("textbox", { name: "Editable note preview", exact: true }).waitFor();
  await until(async () => (await source()).includes("# Inline source"), "reload source preserved");
  assert.ok((await source()).startsWith(properties));
  assert.ok((await source()).endsWith(tail));
  await page.getByRole("radio", { name: "Split", exact: true }).first().click();
  await note.evaluate((element) => {
    element.dataset.sourceIdentity = "stable";
  });
  const sourceEditor = page.locator(".writing > .editor-wrap .cm-content");
  await note.getByRole("heading", { name: "Rich title", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" temporary rich change");
  await sourceEditor.click();
  await page.keyboard.press("Control+z");
  await note.getByRole("heading", { name: "Rich title", exact: true }).waitFor();
  console.log("PASS: source undo to an earlier identical snapshot refreshes Preview.");
  const scroll = page.locator(".writing > .rich-preview-shell > .preview");
  await until(
    async () => scroll.evaluate((element) => element.scrollHeight - element.clientHeight > 500),
    "long Split content mounted",
  );
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 40;
  });
  await page.waitForTimeout(200);
  const beforeScroll = await scroll.evaluate((element) => element.scrollTop);
  assert.ok(beforeScroll > 180, "Exercise a saved offset beyond the initial text-only viewport");
  await note.evaluate((element) => {
    window.qaBlockedPreview = false;
    const observer = new MutationObserver(() => {
      if (element.editor.isEditable) return;
      observer.disconnect();
      window.qaBlockedPreview = true;
      element.editor.commands.insertContent("STALE_PREVIEW_WRITE");
    });
    observer.observe(element, { attributes: true, attributeFilter: ["contenteditable"] });
  });
  await sourceEditor.click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 4; line++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" source update");
  await page
    .getByRole("textbox", { name: "Editable note preview", exact: true })
    .getByRole("heading", { name: "Rich title source update", exact: true })
    .waitFor();
  const afterScroll = await scroll.evaluate((element) => element.scrollTop);
  assert.equal(
    await page.evaluate(() => window.qaBlockedPreview),
    true,
    "Stale Preview was blocked during refresh",
  );
  assert.equal(await note.isEditable(), true);
  assert.ok(!(await source()).includes("STALE_PREVIEW_WRITE"));
  assert.equal(
    await note.getAttribute("data-source-identity"),
    "stable",
    "Source updates keep the rich editor mounted",
  );
  assert.ok(
    Math.abs(afterScroll - beforeScroll) < 5,
    `Split scroll: ${beforeScroll} -> ${afterScroll}`,
  );
  console.log("PASS: source edits refresh Split Preview without losing its scroll position.");
  const inlineBlock = note.locator(".rich-code").first();
  await inlineBlock.getByRole("button", { name: "Edit", exact: true }).click();
  const inlineSource = inlineBlock.locator(".cm-content");
  await inlineSource.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Local source history.");
  await until(
    async () => (await source()).includes("Local source history."),
    "inline history saved",
  );
  const externalSource = (await source()).replace("# Embedded title", "# External block");
  await sourceEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(externalSource);
  await until(
    async () => (await inlineSource.innerText()).includes("External block"),
    "external block refresh",
  );
  assert.equal(
    await inlineBlock.getByRole("button", { name: "Undo", exact: true }).isDisabled(),
    true,
    "External refresh clears inline source undo",
  );
  await inlineSource.click();
  await page.keyboard.press("Control+z");
  assert.ok((await inlineSource.innerText()).includes("External block"));
  console.log("PASS: external source updates reset embedded editing history.");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Redo candidate.");
  await page.keyboard.press("Control+z");
  assert.equal(
    await inlineBlock.getByRole("button", { name: "Redo", exact: true }).isDisabled(),
    false,
  );
  await until(async () => !(await source()).includes("Redo candidate."), "inline undo saved");
  const headingOnly = (await source()).replace("# Rich title source update", "# Another heading");
  await sourceEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(headingOnly);
  await note.getByRole("heading", { name: "Another heading", exact: true }).waitFor();
  assert.equal(
    await inlineBlock.getByRole("button", { name: "Redo", exact: true }).isDisabled(),
    true,
    "External revision resets even unchanged embedded editors",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reload keeps formatted edits, properties, comments, tables and untouched diagrams/code.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(0, 1800));
  }
  throw error;
} finally {
  await app?.close();
  await browser?.close();
}
