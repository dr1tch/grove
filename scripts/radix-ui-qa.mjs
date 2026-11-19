// Run with xvfb-run -a node scripts/radix-ui-qa.mjs after building.
// Every write stays inside a new temporary synthetic vault and profile.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "grove-radix-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
const output = resolve("qa-artifacts/radix-ui-desktop");
await Promise.all([
  mkdir(join(vault, "Folder"), { recursive: true }),
  mkdir(profile),
  mkdir(output, { recursive: true }),
]);
await Promise.all([
  writeFile(
    join(vault, "Note.md"),
    "# Radix fixture\n\nA synthetic [[Other|Alias]].\n\n```markdown\n# Embedded\n\n[[Other|Embedded alias]]\n```\n",
  ),
  writeFile(join(vault, "Other.md"), "# Other\n"),
  writeFile(join(vault, "Folder", "Child.md"), "# Child\n"),
  writeFile(
    join(profile, "state.json"),
    JSON.stringify({
      vault,
      tabs: [],
      settings: { theme: "dark", font: "sans", readingWidth: 0 },
    }),
  ),
]);
let app, page;
const errors = [],
  warnings = [];
const passed = [];
try {
  const executablePath = process.env.FOLIO_SMOKE_EXECUTABLE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), "--ozone-platform=x11", `--user-data-dir=${profile}`],
  });
  page = await app.firstWindow();
  if (process.env.GROVE_EXPECT_VERSION)
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      process.env.GROVE_EXPECT_VERSION,
    );
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (
      ["warning", "error"].includes(message.type()) &&
      /DialogContent|DialogTitle|Description|accessib|Maximum update depth/i.test(message.text())
    )
      warnings.push(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  const file = (path) => page.locator(`.file-tree .file-row[data-path="${path}"]`);
  await file("Note.md").dblclick();
  await page.locator('.tab.active[data-path="Note.md"]').waitFor();

  // Inline live announcements must not make Radix mutate editable NodeView siblings.
  const wiki = page.getByRole("button", { name: "Edit wiki link", exact: true }).first();
  await wiki.click();
  const reference = page.getByRole("dialog", {
    name: "Edit link",
    exact: true,
  });
  await reference.getByLabel("Link address", { exact: true }).fill("javascript:alert(1)");
  await reference.getByRole("button", { name: "Apply", exact: true }).click();
  await reference.getByRole("alert").waitFor();
  await reference.getByRole("button", { name: "Cancel", exact: true }).click();
  await reference.waitFor({ state: "detached" });
  await wiki.click();
  await reference.getByLabel("Link address", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".tiptap [data-aria-hidden]").count(),
    0,
    "modal hides the editor outside its editable DOM",
  );
  await page.keyboard.press("Escape");
  await reference.waitFor({ state: "detached" });
  passed.push("NodeView reference dialog survives Radix aria hiding and reopen");

  const view = page.getByRole("toolbar", {
    name: "Document view",
    exact: true,
  });
  await view.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.locator(".code-block").getByRole("button", { name: "Copy", exact: true }).click();
  await page.locator(".code-block").getByRole("button", { name: "Copied", exact: true }).waitFor();
  await wiki.click();
  await reference.getByLabel("Link address", { exact: true }).waitFor();
  assert.equal(
    await reference.evaluate((node) => document.fullscreenElement.contains(node)),
    true,
    "Dialog portal stays visible in fullscreen",
  );
  assert.equal(await page.locator(".tiptap [data-aria-hidden]").count(), 0);
  await reference.getByRole("button", { name: "Cancel", exact: true }).click();
  await reference.waitFor({ state: "detached" });
  await view.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  passed.push("fullscreen copy announcement and reference Dialog portal");

  // A code block can fullscreen independently while its preview owns another editor.
  const code = page.locator(".code-block").first();
  await code.getByRole("button", { name: "Preview", exact: true }).click();
  const embeddedWiki = code.getByRole("button", {
    name: "Edit wiki link",
    exact: true,
  });
  await embeddedWiki.waitFor();
  const embeddedView = code.getByRole("toolbar", {
    name: "Embedded block view",
    exact: true,
  });
  await embeddedView.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains("code-block"));
  await code.getByRole("button", { name: "Copy", exact: true }).click();
  await embeddedWiki.click();
  await reference.getByLabel("Link address", { exact: true }).fill("Other");
  await reference.getByLabel("Link text", { exact: true }).fill("Fullscreen saved");
  await reference.getByRole("button", { name: "Apply", exact: true }).click();
  await reference.waitFor({ state: "detached" });
  assert.equal(
    await code.getByRole("button", { name: "Edit wiki link", exact: true }).isVisible(),
    true,
  );
  await embeddedView.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(async () =>
    (await window.folio.read("Note.md")).content.includes("[[Other|Fullscreen saved]]"),
  );
  const savedNote = await readFile(join(vault, "Note.md"), "utf8");
  assert.match(savedNote, /A synthetic \[\[Other\|Alias\]\]/, "outer reference remains unchanged");
  assert.equal(
    savedNote.includes("aria-hidden"),
    false,
    "accessibility attributes never enter saved source",
  );
  passed.push("nested code-block fullscreen wiki Dialog and apply");

  // Radix Collapsible: keyboard activation changes state and real child visibility.
  const folder = page.locator(".folder-trigger", { hasText: "Folder" });
  await folder.focus();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await page.keyboard.press("Enter");
  await file("Folder/Child.md").waitFor();
  await page.keyboard.press("Space");
  await file("Folder/Child.md").waitFor({ state: "hidden" });
  assert.equal(await folder.getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Enter");
  await file("Folder/Child.md").waitFor();
  passed.push("folder Collapsible keyboard and visibility");

  const settingsOpener = page.getByRole("button", {
    name: "Settings (Ctrl+,)",
    exact: true,
  });
  await settingsOpener.focus();
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.waitFor();
  const appearance = settings.getByRole("tab", {
    name: "Appearance",
    exact: true,
  });
  await appearance.focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () =>
      document.querySelector('.settings-dialog [role="tab"][aria-selected="true"]')?.textContent ===
      "Editor",
  );
  await settings.getByRole("spinbutton", { name: "Editor font size" }).waitFor();
  await page.keyboard.press("ArrowUp");
  await settings.getByRole("combobox", { name: "Reading width" }).waitFor();
  passed.push("settings Tabs automatic keyboard activation");

  for (const [group, choices] of [
    ["Theme", ["Light", "Dark"]],
    ["Accent", ["indigo", "emerald"]],
    ["Document font", ["Serif", "Sans"]],
  ]) {
    for (const choice of choices) {
      const item = settings
        .getByRole("radiogroup", { name: group, exact: true })
        .getByRole("radio", { name: new RegExp(choice + "$", "i") });
      await item.click();
      assert.equal(await item.getAttribute("aria-checked"), "true");
    }
  }
  passed.push("theme, accent and document font controlled choices");

  // The nested Select portal must remain usable within the modal focus scope.
  const reading = settings.getByRole("combobox", { name: "Reading width" });
  await reading.focus();
  await page.keyboard.press("Space");
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("Narrow"));
  await page.keyboard.press("Enter");
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  assert.match(await reading.innerText(), /Narrow/);
  await page.waitForFunction(() => document.activeElement?.id === "reading-width");
  await reading.press("Space");
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await settings.isVisible(), true, "Escape closes nested Select before Dialog");
  passed.push("nested Select keyboard, commit, focus and Escape");

  // Traverse more than a full settings cycle in both directions.
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 25; index++) {
      await page.keyboard.press(key);
      assert.equal(
        await settings.evaluate((node) => node.contains(document.activeElement)),
        true,
        `dialog traps ${key}`,
      );
    }
  }
  await page.keyboard.press("Escape");
  await settings.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Settings (Ctrl+,)",
  );
  passed.push("Dialog focus trap and opener restore");

  // QuickSwitcher retains its combobox search and selection semantics inside Dialog.
  await page.keyboard.press("Control+k");
  const switcher = page.getByRole("dialog", { name: "Quick file switcher" });
  await switcher.waitFor();
  const search = switcher.getByRole("combobox", { name: "Find a file" });
  assert.equal(await search.evaluate((node) => node === document.activeElement), true);
  await search.fill("Other");
  await page.keyboard.press("Enter");
  await page.locator('.tab.active[data-path="Other.md"]').waitFor();
  await switcher.waitFor({ state: "detached" });
  await page.keyboard.press("Control+k");
  await switcher.waitFor();
  await page.keyboard.press("Escape");
  await switcher.waitFor({ state: "detached" });
  passed.push("QuickSwitcher autofocus, search, open and Escape");

  // Document Dropdown uses real keyboard menu navigation and restores its trigger.
  const menuOpener = page.getByRole("button", {
    name: "Document menu",
    exact: true,
  });
  await menuOpener.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Document menu", exact: true });
  await menu.waitFor();
  await page.keyboard.press("End");
  assert.equal(await menu.evaluate((node) => node.contains(document.activeElement)), true);
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("Export note"));
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Document menu",
  );
  passed.push("document Dropdown keyboard and focus restore");

  // A cancelled rename exercises the Checkbox without changing the file.
  await file("Other.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename", exact: true });
  const checkbox = rename.getByRole("checkbox", {
    name: "Update links in saved notes",
  });
  const initial = await checkbox.getAttribute("aria-checked");
  await checkbox.focus();
  await page.keyboard.press("Space");
  assert.notEqual(await checkbox.getAttribute("aria-checked"), initial);
  await page.keyboard.press("Space");
  assert.equal(await checkbox.getAttribute("aria-checked"), initial);
  await page.keyboard.press("Escape");
  await rename.waitFor({ state: "detached" });
  assert.equal(await readFile(join(vault, "Other.md"), "utf8"), "# Other\n");
  passed.push("rename Checkbox keyboard toggle and cancel");

  // Top document tabs use manual activation: navigation moves focus before opening a file.
  const openDocuments = page.getByRole("tablist", {
    name: "Open documents",
    exact: true,
  });
  const noteTab = openDocuments.getByRole("tab", { name: "Note", exact: true });
  const otherTab = openDocuments.getByRole("tab", {
    name: "Other",
    exact: true,
  });
  assert.equal(await openDocuments.getByRole("tab").count(), 2);
  await noteTab.focus();
  await page.keyboard.press("Enter");
  await page.locator('.tabs .tab.active[data-path="Note.md"]').waitFor();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Other");
  assert.equal(
    await noteTab.getAttribute("aria-selected"),
    "true",
    "ArrowRight moves focus without activating",
  );
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Note");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Other");
  assert.equal(
    await noteTab.getAttribute("aria-selected"),
    "true",
    "Home/End keep the selected document",
  );
  await page.keyboard.press("Space");
  await page.locator('.tabs .tab.active[data-path="Other.md"]').waitFor();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Note");
  assert.equal(
    await otherTab.getAttribute("aria-selected"),
    "true",
    "ArrowLeft preserves manual activation",
  );
  await page.keyboard.press("Enter");
  await page.locator('.tabs .tab.active[data-path="Note.md"]').waitFor();
  const otherWrapper = page.locator('.tabs .tab[data-path="Other.md"]');
  await otherWrapper.click();
  await page.locator('.tabs .tab.active[data-path="Other.md"]').waitFor();
  await otherWrapper.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
  await openDocuments.getByRole("tab", { name: "Other · Pinned tab", exact: true }).waitFor();
  assert.equal(
    await otherWrapper.getByRole("button", { name: "Close Other", exact: true }).count(),
    0,
    "pinned tab hides its close control",
  );
  await otherWrapper.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin tab", exact: true }).click();
  await otherWrapper.getByRole("button", { name: "Close Other", exact: true }).click();
  await otherWrapper.waitFor({ state: "detached" });
  assert.equal(await openDocuments.getByRole("tab").count(), 1);
  await page.locator('.tabs .tab.active[data-path="Note.md"]').waitFor();
  passed.push("document Tabs manual keyboard activation, wrapper click, pin and close");

  await file("Other.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
  await file("Other.md").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = page.getByRole("dialog", { name: "Trash", exact: true });
  await trash.getByText("Other.md", { exact: true }).waitFor();
  await trash.getByRole("button", { name: "Restore", exact: true }).click();
  await file("Other.md").waitFor();
  assert.equal(await readFile(join(vault, "Other.md"), "utf8"), "# Other\n");
  await trash.getByRole("button", { name: "Close dialog", exact: true }).click();
  await trash.waitFor({ state: "detached" });
  passed.push("Trash dialog restores the original file");

  assert.deepEqual(errors, [], "renderer runtime errors");
  assert.deepEqual(warnings, [], "Radix accessibility warnings");
  await page.screenshot({ path: join(output, "success.png") });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed, errors, warnings, fixture: temp }, null, 2),
  );
  console.log(`PASS: ${passed.join("; ")}. Fixture: ${temp}`);
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
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed, errors, warnings, fixture: temp, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.close();
}
