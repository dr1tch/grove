// Real editors with synthetic vaults only. Supports the isolated web preview too.
import { _electron as electron, chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";

const target = process.env.GROVE_DOCUMENT_WEB_URL;
const original =
  "---\ntitle: Exact properties\n---\n\n# Live title\n\nFirst **bold** and _italic_ with [[Other|Wiki]] and [link](Other.md).\n\n- [ ] Same task\n- [ ] Same task\n\n```javascript\nconst literal = '**bold**';\n```\n\n```javascript\nconst literal = '**bold**';\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Image](image.svg)\n\n<script>window.liveUnsafe=true</script>\n\nLast paragraph.\n";
const notes = {
  "Live.md": original,
  "Other.md": "# Other\n",
  "Items.md":
    "First paragraph.\n\nSecond paragraph.\n\n- [ ] First task\n- [ ] Second task\n- [ ] Parent task\n  - [ ] Nested task\n\nLast paragraph.\n",
  "Stale.md": "```js\nconst same = 1;\n```\n\n```js\nconst same = 1;\n```\n\nEnd\n",
  "Windows.md": "# Windows\r\n\r\nCRLF **bold**.\r\n\r\nEnd\r\n",
  "image.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="green"/></svg>',
};
const output = resolve(`qa-artifacts/live-preview-${target ? "web" : "desktop"}`);
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
    const temp = await mkdtemp(join(tmpdir(), "grove-live-")),
      profile = join(temp, "profile");
    vault = join(temp, "vault");
    await mkdir(vault);
    await mkdir(profile);
    await Promise.all(
      Object.entries(notes).map(([path, text]) => writeFile(join(vault, path), text)),
    );
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
  const source = async (path = "Live.md") =>
    vault ? readFile(join(vault, path), "utf8") : fake.text(path);
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw Error(`Timed out: ${label}`);
  };
  await page.locator('.file-row[data-path="Live.md"]').first().dblclick();
  await choosePreview("live");
  const live = page.getByRole("textbox", { name: "Editable live preview", exact: true });
  await live.waitFor();
  await page.waitForTimeout(500);
  assert.equal(await source(), original);
  assert.equal(await live.locator(".cm-live-h1").innerText(), "Live title");
  const readingColors = await live.evaluate((element) => {
    const walker = document.createTreeWalker(
      element.querySelector(".cm-live-h1"),
      NodeFilter.SHOW_TEXT,
    );
    let node;
    let heading;
    while ((node = walker.nextNode()))
      if (node.textContent.includes("Live title")) {
        heading = node.parentElement;
        break;
      }
    const list = [...element.querySelectorAll(".cm-line")].find((line) =>
      line.textContent.includes("Same task"),
    );
    const text = list
      ? ([...list.querySelectorAll("span")].find((span) =>
          span.textContent.includes("Same task"),
        ) ?? list)
      : null;
    return {
      normal: getComputedStyle(element).color,
      heading: getComputedStyle(heading).color,
      list: getComputedStyle(text).color,
    };
  });
  assert.equal(
    readingColors.heading,
    readingColors.normal,
    "Live Preview headings use reading colors",
  );
  assert.equal(
    readingColors.list,
    readingColors.normal,
    "Live Preview list text uses reading colors",
  );
  assert.equal(await live.locator(".cm-live-strong").first().innerText(), "bold");
  const paragraph = () => live.locator(".cm-line").filter({ hasText: "First" });
  await paragraph().click();
  await until(
    async () => (await paragraph().innerText()).includes("**bold**"),
    "active syntax reveal",
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" Added.");
  await page.keyboard.press("Control+z");
  assert.ok(!(await paragraph().innerText()).includes("Added."));
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+s");
  await until(async () => (await source()).includes(" Added."), "live save");
  assert.equal(await source(), original.replace("(Other.md).", "(Other.md). Added."));
  await live.locator(".cm-line").filter({ hasText: "Last paragraph" }).click();
  await until(
    async () => !(await paragraph().innerText()).includes("**bold**"),
    "inactive syntax hidden",
  );
  await live.locator('input[type="checkbox"]').nth(1).click();
  await page.keyboard.press("Control+s");
  await until(
    async () => (await source()).includes("- [ ] Same task\n- [x] Same task"),
    "duplicate task targets second range",
  );
  assert.equal(await page.evaluate(() => window.liveUnsafe), undefined);
  await page.getByRole("button", { name: "Edit code source", exact: true }).nth(1).click();
  await until(async () => (await live.innerText()).includes("```javascript"), "code source reveal");
  assert.equal(await live.locator(".cm-activeLine").innerText(), "```javascript");
  await page.keyboard.press("End");
  await page.keyboard.type(" meta");
  await page.keyboard.press("Control+s");
  await until(async () => (await source()).includes("```javascript meta"), "code source edit");
  assert.equal((await source()).split("```javascript meta").length - 1, 1);
  await live.locator(".cm-line").filter({ hasText: "Last paragraph" }).click();
  await page.getByRole("button", { name: "Edit table source", exact: true }).first().click();
  await until(async () => (await live.innerText()).includes("| A | B |"), "table source reveal");
  await live.locator(".cm-line").filter({ hasText: "Last paragraph" }).click();
  await page.getByRole("button", { name: "Edit media source", exact: true }).click();
  await until(async () => (await live.innerText()).includes("![Image]"), "media source reveal");
  await live.locator(".cm-line").filter({ hasText: "Last paragraph" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page
    .getByRole("toolbar", { name: "Markdown formatting" })
    .first()
    .getByRole("button", { name: "Bold", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  await until(
    async () => (await source()).includes("**Last paragraph.**"),
    "live formatting toolbar",
  );
  await page.getByRole("radio", { name: "Split", exact: true }).click();
  const editor = page.locator(".editor-wrap:not(.live-preview) .cm-content");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Source sync.");
  await until(async () => (await live.innerText()).includes("Source sync."), "source to live sync");
  await live.locator(".cm-line").filter({ hasText: "Source sync." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Live sync.");
  await until(async () => (await editor.innerText()).includes("Live sync."), "live to source sync");
  await page.keyboard.press("Control+s");
  await until(async () => (await source()).includes("Source sync. Live sync."), "split save");
  await choosePreview("formatted");
  await page.getByRole("textbox", { name: "Editable note preview", exact: true }).waitFor();
  await choosePreview("live");
  await live.waitFor();
  await page.getByRole("radio", { name: "Preview", exact: true }).click();
  await live.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["synthetic attachment"], "drop.txt", { type: "text/plain" }));
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: 400,
        clientY: 300,
      }),
    );
  });
  await page.waitForTimeout(200);
  assert.ok(await live.isVisible(), "The live editor owns file drops without switching to Edit");
  await page.locator('.file-row[data-path="Windows.md"]').first().dblclick();
  await live.locator(".cm-line").filter({ hasText: "CRLF" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added.");
  await page.keyboard.press("Control+s");
  await until(async () => (await source("Windows.md")).includes(" Added."), "CRLF save");
  assert.equal(
    await source("Windows.md"),
    notes["Windows.md"].replace("**bold**.", "**bold**. Added."),
  );
  await page.reload();
  await live.waitFor();
  assert.match(await page.getByLabel("Preview editing style").innerText(), /Live Preview/);
  await page.screenshot({ path: join(output, "live-preview.png") });
  await page.locator('.file-row[data-path="Items.md"]').first().dblclick();
  await page.locator('.tabs [data-path="Items.md"].active').waitFor();
  for (const style of ["formatted", "live"]) {
    await choosePreview(style);
    const content =
      style === "live"
        ? live
        : page.getByRole("textbox", { name: "Editable note preview", exact: true });
    await content.waitFor();
    await until(
      async () => (await content.innerText()).includes("First task"),
      "item fixture ready",
    );
    await until(
      async () => (await content.getAttribute("contenteditable")) === "true",
      "item editor ready",
    );
    const spacing = await content.evaluate((element, style) => {
      const find = (text) =>
        [...element.querySelectorAll(style === "live" ? ".cm-line" : "p")]
          .find((e) => e.textContent.includes(text))
          .getBoundingClientRect();
      const first = find("First task"),
        second = find("Second task"),
        p = find("First paragraph"),
        next = find("Second paragraph");
      return { taskPitch: second.top - first.top, paragraphGap: next.top - p.bottom };
    }, style);
    console.log("Item spacing", style, spacing);
    await page.screenshot({ path: join(output, `items-${style}.png`) });
    assert.ok(
      spacing.taskPitch <= 35,
      `${style} task rows must stay compact: ${spacing.taskPitch}px`,
    );
    assert.ok(
      spacing.paragraphGap <= 28,
      `${style} paragraph gap must stay compact: ${spacing.paragraphGap}px`,
    );
    assert.equal(await source("Items.md"), notes["Items.md"], "Spacing must not rewrite Markdown");
    const task = content
      .locator(style === "live" ? ".cm-line" : "li[data-checked] > div > p")
      .filter({ hasText: "First task" })
      .first();
    await task.click({ position: { x: style === "live" ? 60 : 12, y: 8 } });
    if (style === "formatted")
      await until(
        async () =>
          content.evaluate(
            (element) => element.editor.state.selection.$from.parent.textContent === "First task",
          ),
        "caret enters task text",
      );
    assert.ok(
      await task.evaluate(
        (element) =>
          !!(element.closest(".cm-line") ?? element.closest("li"))?.querySelector(
            'input[type="checkbox"]',
          ),
      ),
      "Editing a task keeps its checkbox visible",
    );
    await page.keyboard.press("End");
    if (style === "formatted")
      await until(
        async () =>
          content.evaluate((element) => {
            const selection = element.editor.state.selection;
            return (
              selection.empty &&
              selection.$from.parentOffset === selection.$from.parent.content.size
            );
          }),
        "native End reaches the end of the task",
      );
    await page.keyboard.press("Enter");
    await page.keyboard.type("New task");
    await page.keyboard.press("Control+s");
    await until(
      async () => (await source("Items.md")).includes("- [ ] First task\n- [ ] New task"),
      "Enter continues checklist",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+s");
    await until(
      async () => /\n[\t ]+- \[ \] New task/.test(await source("Items.md")),
      "Tab nests task",
    );
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Control+s");
    await until(
      async () => (await source("Items.md")).includes("- [ ] First task\n- [ ] New task"),
      "Shift Tab unnests task",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("After list");
    await page.keyboard.press("Control+s");
    await until(
      async () => /\n(?:\n)?After list/.test(await source("Items.md")),
      "Enter exits an empty task",
    );
    // Restore through the existing source editor before checking the other style.
    await page.getByRole("radio", { name: "Edit", exact: true }).click();
    const sourceEditor = page.locator(".editor-wrap:not(.live-preview) .cm-content");
    await sourceEditor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(notes["Items.md"]);
    await page.keyboard.press("Control+s");
    await until(async () => (await source("Items.md")) === notes["Items.md"], "reset item fixture");
    await page.getByRole("radio", { name: "Preview", exact: true }).click();
  }
  await page.locator('.file-row[data-path="Stale.md"]').first().dblclick();
  await until(
    async () => (await live.locator(".cm-live-widget.block").count()) === 2,
    "duplicate stale fixture",
  );
  const stale = await live.evaluate((element) => {
    const view = element.cmTile.root.view;
    const dom = element.querySelectorAll(".cm-live-widget.block")[1];
    const widget = dom.cmTile.widget;
    const from = view.posAtDOM(dom);
    view.dispatch({ changes: { from, to: from + widget.source.length, insert: "Removed" } });
    // A removed widget must remain invalid even if it later sits before the editor.
    document.body.prepend(dom);
    const position = widget.position(dom, view);
    dom.remove();
    return position;
  });
  assert.equal(stale, null, "Foreign widget callbacks cannot target an identical boundary block");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: live editing, source preservation, Split sync, compact rows/paragraphs, visible task checkboxes, Enter/Tab/Shift+Tab list editing, style switching and persistence.",
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
