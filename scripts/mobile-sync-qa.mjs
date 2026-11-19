import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createFakeGitHub } from "./fake-github.mjs";
const url = process.env.GROVE_MOBILE_URL ?? "http://127.0.0.1:3072/";
const fake = createFakeGitHub({
  "Note.md":
    "# Shared note\n\nOriginal.\n\n## First diagram\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n## Second diagram\n\n```mermaid\nflowchart LR\n C-->D\n```\n",
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
let deny = false,
  offline = false,
  hold = false,
  holdRead = false,
  held,
  release;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};
await context.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (offline) return route.abort("internetdisconnected");
  if (deny)
    return route.fulfill({ status: 401, headers: cors, json: { message: "Bad credentials" } });
  if (
    (hold && request.method() === "PUT") ||
    (holdRead && request.method() === "GET" && request.url().includes("/contents/Note.md"))
  ) {
    hold = false;
    holdRead = false;
    held?.();
    await new Promise((resolve) => {
      release = resolve;
    });
  }
  const response = await fake.fetch(request.url(), {
    method: request.method(),
    headers: request.headers(),
    ...(request.postData() ? { body: request.postData() } : {}),
  });
  await route.fulfill({
    status: response.status,
    headers: { ...Object.fromEntries(response.headers), ...cors },
    body: Buffer.from(await response.arrayBuffer()),
  });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const button = (name) => page.getByRole("button", { name, exact: true });
const editor = () => page.frameLocator('iframe[title="Markdown editor"]').locator(".cm-content");
const connect = async () => {
  await page.getByLabel("Repository owner", { exact: true }).fill("fixture");
  await page.getByLabel("Repository name", { exact: true }).fill("vault");
  await page.getByLabel("Branch", { exact: true }).fill("main");
  await page.getByLabel("Repository token", { exact: true }).fill("fixture-token");
  await button("Connect repository").click();
};
const until = async (check) => {
  for (let n = 0; n < 150; n++) {
    if (await check()) return;
    await page.waitForTimeout(100);
  }
  throw Error("Sync condition did not settle");
};
try {
  await page.goto(url);
  await connect();
  await button("Open Note.md").waitFor();
  await button("Open Note.md").click();
  await button("Edit note").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" First save.");
  const started = new Promise((resolve) => {
    held = resolve;
  });
  hold = true;
  await button("Save note").click();
  await started;
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Second save while upload waits.");
  await button("Save note").click();
  release();
  await until(() => fake.text("Note.md").includes("Second save while upload waits."));
  await until(async () => (await page.locator("body").innerText()).includes("All changes synced"));
  offline = true;
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Offline edit survives sign-out.");
  await button("Save note").click();
  await until(async () => (await page.locator("body").innerText()).includes("Offline"));
  await button("Back to files").click();
  await button("Settings").click();
  await button("Sign out / connect another vault").click();
  await button("Connect repository").waitFor();
  offline = false;
  deny = true;
  await connect();
  await until(async () => (await page.locator("body").innerText()).includes("GitHub"));
  assert.equal(
    await button("Open Note.md").count(),
    0,
    "Rejected new credentials never reveal cached files",
  );
  await until(async () => await button("Connect repository").isEnabled());
  assert.equal(await button("Open Note.md").count(), 0);
  deny = false;
  offline = false;
  await connect();
  await button("Open Note.md").first().waitFor();
  await until(() => fake.text("Note.md").includes("Offline edit survives sign-out."));
  await button("New note").click();
  await editor().waitFor();
  await button("Insert from vault").click();
  await button("Select Note.md").click();
  await page.getByText("Saved Mermaid block · reviewed snapshot", { exact: true }).waitFor();
  const insertionStarted = new Promise((resolve) => {
    held = resolve;
  });
  holdRead = true;
  await button("Insert selected file").click();
  await insertionStarted;
  assert.equal(
    await button("Second diagram").isDisabled(),
    true,
    "Source choice is locked while its insert is being verified",
  );
  assert.equal(
    await button("Charts").isDisabled(),
    true,
    "Category cannot replace an in-flight insert",
  );
  release();
  await until(async () => (await editor().innerText()).includes("A-->B"));
  assert.equal((await editor().innerText()).includes("C-->D"), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: verified login, delayed two-save upload, offline sign-out/reconnect, rejected credentials cache isolation, and locked Mermaid selection during delayed source verification.",
  );
} finally {
  release?.();
  await browser.close();
}
