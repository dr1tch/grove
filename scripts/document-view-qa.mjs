// Real editor interaction in an isolated desktop profile, or a browser with a fake repository.
import { _electron as electron, chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";

const target = process.env.GROVE_DOCUMENT_WEB_URL;
const original =
  "# View controls\n\nOriginal text.\n\n" +
  "A paragraph for zoom and fit checks.\n\n".repeat(12) +
  "\n[[a\nb\nc\nd\ne|Alias]]\n\n```markdown\n# Embedded title\n\nOriginal embedded.\n```\n\nAfter embed.\n\n```markdown\n# Embedded title\n\nOriginal embedded.\n```\n";
const output = resolve(`qa-artifacts/document-view-${target ? "web" : "desktop"}`);
await mkdir(output, { recursive: true });
let app, browser, page, file, fake;
try {
  if (target) {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    fake = createFakeGitHub({
      "Controls.md": original,
      "Other.md": "# Other",
      "Short.md": "# Short\n\nSmall note.\n",
    });
    await context.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization,Content-Type,Accept,X-GitHub-Api-Version",
        "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
      };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const response = await fake.fetch(req.url(), {
        method: req.method(),
        headers: req.headers(),
        ...(req.postData() ? { body: req.postData() } : {}),
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
    const temp = await mkdtemp(join(tmpdir(), "grove-document-view-"));
    const vault = join(temp, "vault"),
      profile = join(temp, "profile");
    await mkdir(vault);
    await mkdir(profile);
    file = join(vault, "Controls.md");
    await writeFile(file, original);
    await writeFile(join(vault, "Other.md"), "# Other");
    await writeFile(join(vault, "Short.md"), "# Short\n\nSmall note.\n");
    await writeFile(join(profile, "state.json"), JSON.stringify({ vault, tabs: [] }));
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
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
  }
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.locator('.file-row[data-path="Short.md"]').first().dblclick();
  const pane = page.locator(".document-pane").first();
  const controls = pane.getByRole("toolbar", { name: "Document view" });
  await controls.waitFor();
  const mode = async (name) => {
    const button = page.locator(".title-actions .seg").getByRole("radio", { name, exact: true });
    await button.click();
    await button.and(page.locator(".active")).waitFor();
  };
  const resize = async (width, height) => {
    if (app)
      await app.evaluate(
        ({ BrowserWindow }, { width, height }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(width, height),
        { width, height },
      );
    else await page.setViewportSize({ width, height });
    await page.waitForFunction(
      ({ width, height }) => innerWidth === width && innerHeight === height,
      { width, height },
    );
  };
  const zoom = () =>
    pane.locator(".writing").evaluate((element) => Number(getComputedStyle(element).zoom));
  for (const [width, height] of [
    [1500, 1000],
    [1100, 740],
  ]) {
    await resize(width, height);
    for (const name of ["Edit", "Preview", "Split"]) {
      await mode(name);
      for (const selector of name === "Split"
        ? [".cm-content", ".rich-md"]
        : [name === "Edit" ? ".cm-content" : ".rich-md"]) {
        const dimensions = await pane.locator(selector).evaluate((element) => {
          const viewport = element.closest(".cm-scroller, .rich-preview");
          return {
            width: element.getBoundingClientRect().width,
            availableWidth: viewport.clientWidth,
            height: element.getBoundingClientRect().height,
            availableHeight: viewport.clientHeight,
          };
        });
        assert.ok(
          dimensions.width >= dimensions.availableWidth - 65,
          `${name} uses available width: ${JSON.stringify(dimensions)}`,
        );
        assert.ok(
          dimensions.height >= dimensions.availableHeight - 2,
          `${name} fills available height: ${JSON.stringify(dimensions)}`,
        );
      }
    }
  }
  await page.screenshot({ path: join(output, "full-space.png") });
  await resize(1500, 1000);
  console.log("PASS: default Edit/Preview/Split surfaces fill their available width and height.");
  await page.getByRole("button", { name: "Settings (Ctrl+,)", exact: true }).click();
  await page.getByLabel("Reading width", { exact: true }).click();
  await page.getByRole("option", { name: "Comfortable · 680", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await mode("Preview");
  const fixedWidth = await pane.locator(".rich-md").evaluate((element) => ({
    actual: element.getBoundingClientRect().width,
    expected: Math.min(760, element.closest(".preview").clientWidth),
  }));
  assert.ok(
    Math.abs(fixedWidth.actual - fixedWidth.expected) < 3,
    `Short notes retain the chosen reading width: ${JSON.stringify(fixedWidth)}`,
  );
  await page.locator('.file-row[data-path="Controls.md"]').first().dblclick();
  await pane.getByRole("heading", { name: "View controls", exact: true }).waitFor();
  for (const name of ["Edit", "Preview", "Split"]) {
    await mode(name);
    await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
    await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.equal(await zoom(), 1.2);
    await controls.getByRole("button", { name: "Zoom out", exact: true }).click();
    assert.equal(await zoom(), 1.1);
    await controls.getByRole("button", { name: "Reset document zoom" }).click();
    assert.equal(await zoom(), 1);
    const editorWidth =
      name === "Edit"
        ? await pane
            .locator(".cm-content")
            .evaluate((element) => element.getBoundingClientRect().width)
        : 0;
    await controls.getByRole("button", { name: "Fit width" }).click();
    if (name === "Edit")
      assert.ok(
        (await pane
          .locator(".cm-content")
          .evaluate((element) => element.getBoundingClientRect().width)) >
          editorWidth - 1,
      );
    assert.equal(
      await controls.getByRole("button", { name: "Fit width" }).getAttribute("aria-pressed"),
      "true",
    );
    await page.screenshot({ path: join(output, `${name.toLowerCase()}.png`) });
    await controls.getByRole("button", { name: "Reset document zoom" }).click();
  }
  console.log("PASS: zoom in/out, reset and fit in Edit, Preview and Split.");

  await mode("Preview");
  const width = await pane
    .locator(".md")
    .evaluate((element) => element.getBoundingClientRect().width);
  await controls.getByRole("button", { name: "Fit width" }).click();
  assert.ok(
    (await pane.locator(".md").evaluate((element) => element.getBoundingClientRect().width)) >
      width + 20,
  );
  await controls.getByRole("button", { name: "Reset document zoom" }).click();
  for (let step = 0; step < 20; step++)
    await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(await zoom(), 3);
  assert.equal(
    await controls.getByRole("button", { name: "Zoom in", exact: true }).isDisabled(),
    true,
  );
  await controls.getByRole("button", { name: "Reset document zoom" }).click();
  for (let step = 0; step < 5; step++)
    await controls.getByRole("button", { name: "Zoom out", exact: true }).click();
  assert.equal(await zoom(), 0.5);
  assert.equal(
    await controls.getByRole("button", { name: "Zoom out", exact: true }).isDisabled(),
    true,
  );
  await controls.getByRole("button", { name: "Reset document zoom" }).click();
  console.log("PASS: fit expands the reading column; zoom is bounded at50–300%.");

  await mode("Edit");
  const editor = pane.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Undo survives zoom.");
  await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+z");
  assert.ok(!(await editor.innerText()).includes("Undo survives zoom."));
  await controls.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() =>
    document.fullscreenElement?.matches(".app[data-document-fullscreen]"),
  );
  assert.notEqual(
    await page.evaluate(() => getComputedStyle(document.fullscreenElement).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  for (const name of ["Preview", "Split", "Edit"]) {
    await pane.locator(".pane-mode").getByRole("radio", { name, exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        document.fullscreenElement?.matches(".app[data-document-fullscreen]"),
      ),
      true,
    );
    assert.equal(await pane.locator(".editor").count(), name === "Preview" ? 0 : 1);
    assert.equal(
      await pane.locator(".writing > .rich-preview-shell > .preview").count(),
      name === "Edit" ? 0 : 1,
    );
  }
  await page.screenshot({ path: join(output, "fullscreen.png") });
  await page.keyboard.press("Control+f");
  const search = page.getByRole("region", { name: "Find in file" });
  await search.waitFor();
  assert.equal(
    await search.evaluate((element) => document.fullscreenElement.contains(element)),
    true,
  );
  await search.getByRole("button", { name: "Close search" }).click();
  await controls.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await zoom(), 1.1);
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole("toolbar", { name: "Document view" }).waitFor();
  assert.equal(await zoom(), 1.1);
  if (file) assert.equal(await readFile(file, "utf8"), original);
  await page.keyboard.press("Control+n");
  await pane.locator(".cm-content").click();
  await page.keyboard.type("# Fullscreen draft\n\nSave from fullscreen.");
  await controls.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.keyboard.press("Control+s");
  const save = page.getByRole("dialog", { name: "Save note", exact: true });
  await save.waitFor();
  assert.equal(
    await save.evaluate((element) => document.fullscreenElement.contains(element)),
    true,
  );
  await save.getByLabel("Name", { exact: true }).fill("Fullscreen draft");
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await save.waitFor({ state: "detached" });
  await page
    .locator('.file-row[data-path="Fullscreen draft.md"]')
    .first()
    .waitFor({ state: "attached" });
  // Saving reopens the new path after refreshing the tree; wait for that operation to finish.
  await page
    .locator('.tabs [data-path="Fullscreen draft.md"].active')
    .waitFor({ state: "attached" });
  await pane.locator(".cm-content").filter({ hasText: "Fullscreen draft" }).waitFor();
  await controls.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.locator('.tabs [data-path="Controls.md"]').click();
  await page.locator('.tabs [data-path="Controls.md"].active').waitFor();
  await mode("Preview");
  await pane.getByRole("heading", { name: "View controls", exact: true }).waitFor();
  const block = pane.locator(".code-block").first();
  await block.getByRole("button", { name: "Preview", exact: true }).click();
  await block.getByRole("heading", { name: "Embedded title", exact: true }).waitFor();
  await block.getByRole("button", { name: "Source", exact: true }).click();
  const blockControls = block.getByRole("toolbar", { name: "Embedded block view" });
  await blockControls.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(
    await block.locator(".code-content").evaluate((element) => getComputedStyle(element).zoom),
    "1.1",
  );
  await blockControls.getByRole("button", { name: "Fit width" }).click();
  await blockControls.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains("code-block"));
  await blockControls.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await controls.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await block.getByRole("button", { name: "Edit", exact: true }).click();
  const content = block.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# Edited embed\n\nChanged only this block.");
  await block.getByRole("button", { name: "Done", exact: true }).click();
  await block.getByRole("button", { name: "Preview", exact: true }).click();
  await block.getByRole("heading", { name: "Edited embed", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Edit embedded block" }).count(), 0);
  await controls.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  const expected = original.replace(
    "# Embedded title\n\nOriginal embedded.",
    "# Edited embed\n\nChanged only this block.",
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((file ? await readFile(file, "utf8") : fake.text("Controls.md")) === expected) break;
    await page.waitForTimeout(100);
  }
  assert.equal(file ? await readFile(file, "utf8") : fake.text("Controls.md"), expected);
  console.log(
    "PASS: embedded inline editing, preview, zoom/fit/fullscreen and duplicate isolation.",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: editing/undo, fullscreen modes/search/first-save, exit, persisted zoom and unchanged source.",
  );
} catch (error) {
  if (page) await page.screenshot({ path: join(output, "failure.png") });
  throw error;
} finally {
  await app?.close();
  await browser?.close();
}
