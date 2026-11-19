import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const url = process.env.GROVE_MOBILE_URL ?? "http://127.0.0.1:3072/";
const output = "qa-artifacts/mobile";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.route("**/*", (route) => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const button = (name) => page.getByRole("button", { name, exact: true });
const source = () => page.frameLocator('iframe[title="Markdown editor"]').locator(".cm-content");
const until = async (check) => {
  for (let n = 0; n < 100; n++) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Condition did not settle");
};
try {
  await page.goto(url);
  await button("Try sample vault").click();
  await button("New note").waitFor();
  assert.equal(await page.getByRole("tab").count(), 0);
  assert.equal(await page.getByRole("tablist").count(), 0);
  const add = await button("New note").boundingBox();
  assert.ok(add.width >= 56 && add.height >= 56);
  await page.screenshot({ path: `${output}/files-light.png` });
  await button("Use dark theme").click();
  await page.screenshot({ path: `${output}/files-dark.png` });
  await button("Open Projects/Local-first sync.md").click();
  const reading = page.frameLocator('iframe[title="Note reading view"]');
  await reading.getByRole("heading", { name: "Local-first sync", exact: true }).waitFor();
  await reading.locator(".diagram svg").waitFor();
  await button("Edit note").click();
  await source().waitFor();
  await source().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Phone QA edit.");
  await button("Save note").click();
  await until(
    async () =>
      (await page.locator("body").innerText()).includes("Saved in the local sample vault") ||
      (await page.locator("body").innerText()).includes(
        "Sample vault · changes stay on this device",
      ),
  );
  await button("Back to files").click();
  await button("New note").waitFor();
  await button("New note").click();
  await source().waitFor();
  await source().click();
  await page.keyboard.type("# Phone draft\n\nBold words");
  await until(async () => (await source().innerText()).includes("Bold words"));
  for (let index = 0; index < 40; index++) {
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(" after repeated undo");
  await until(async () => (await source().innerText()).includes("after repeated undo"));
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+End");
  for (let index = 0; index < " after repeated undo".length; index++)
    await page.keyboard.press("Backspace");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await button("Bold").click();
  await until(async () => (await source().innerText()).includes("**words**"));
  await button("Undo").click();
  await until(async () => !(await source().innerText()).includes("**words**"));
  await page.screenshot({ path: `${output}/draft-editor.png` });
  await button("Save note").click();
  await page.getByLabel("File name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("File name", { exact: true }).inputValue(), "Phone draft.md");
  await page.screenshot({ path: `${output}/first-save.png` });
  await button("Cancel").click();
  await source().waitFor();
  await button("Back to files").click();
  await button("Discard changes").waitFor();
  await button("Cancel").click();
  await button("Save note").click();
  await page.getByLabel("File name", { exact: true }).fill("Phone saved.md");
  await button("Save note").last().click();
  await page.getByLabel("File name", { exact: true }).waitFor({ state: "hidden" });
  await button("Back to files").click();
  await button("Open Phone saved.md").first().waitFor();
  await page.getByLabel("Search files", { exact: true }).fill("Meeting");
  await button("Open Projects/Meeting notes.md").first().waitFor();
  assert.equal(await button("Open Phone saved.md").count(), 0);
  await page.getByLabel("Search files", { exact: true }).fill("");
  await button("New note").click();
  await source().waitFor();
  await source().click();
  await page.keyboard.type("# Recovered phone draft\n\nKeep this through reload.");
  await page.waitForTimeout(300);
  await page.reload();
  await button("Try sample vault").click();
  await source().waitFor();
  assert.match(await source().innerText(), /Keep this through reload/);
  await button("Insert from vault").click();
  await page.getByLabel("Search saved files", { exact: true }).fill("Local-first");
  await button("Select Projects/Local-first sync.md").click();
  await page.getByText("Saved Mermaid block · reviewed snapshot", { exact: true }).waitFor();
  await button("Insert selected file").click();
  await until(async () => (await source().innerText()).includes("flowchart LR"));
  await button("Insert from vault").click();
  await page.getByLabel("Search saved files", { exact: true }).fill("Meeting");
  await button("Select Projects/Meeting notes.md").click();
  await until(async () => (await page.locator("body").innerText()).includes("no Mermaid blocks"));
  assert.equal(
    await button("Insert as embed").count(),
    0,
    "Whole-note transclusion stays unavailable",
  );
  await button("Insert as link").click();
  await button("Insert selected file").click();
  await until(async () => (await source().innerText()).includes("/Projects/Meeting"));
  await button("Back to files").click();
  await button("Discard changes").click();
  await button("New note").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: native shell browser preview, no tabs, 56px add button, themes, safe Markdown/Mermaid, edit/save, formatting/undo, first-save/cancel/discard, search, reload recovery and existing-content insertion. No external requests.",
  );
} catch (error) {
  console.error(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error((await page.locator("body").innerText()).slice(-3000));
  throw error;
} finally {
  await browser.close();
}
