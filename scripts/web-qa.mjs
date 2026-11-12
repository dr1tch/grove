import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";
const target = process.env.GROVE_WEB_URL ?? "http://127.0.0.1:3071/grove/app/";
const output = resolve("qa-artifacts/web");
await mkdir(output, { recursive: true });
const fake = createFakeGitHub({
  "Notes/Welcome.md":
    "# Welcome\n\nA note for browser QA.\n\n## Diagram\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n![Picture](</Media/picture.png>)\n",
  "Notes/Chart.md": '# Chart\n\n```mermaid\npie\n "Done" : 3\n```\n',
  "Media/picture.png": new Uint8Array(await readFile("build/icon.png")),
  "Drawings/Sketch.excalidraw": JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: {},
    files: {},
  }),
  "Code/example.ts": "export const example = 42;\n",
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
context.on("page", (page) => page.on("pageerror", (error) => errors.push(String(error))));
await context.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers });
    return;
  }
  if (request.headers().authorization !== "Bearer fixture-token") {
    await route.fulfill({
      status: 401,
      headers,
      contentType: "application/json",
      body: '{"message":"invalid token"}',
    });
    return;
  }
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
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("console", (message) => {
    if (message.type() === "error") console.error("BROWSER", message.text());
  });
  page.on("requestfailed", (request) =>
    console.error("FAILED", request.url(), request.failure()?.errorText),
  );
  await page.goto(target);
  await page.getByRole("heading", { name: "Your vault, in your browser." }).waitFor();
  await page.getByLabel("GitHub owner", { exact: true }).fill("fixture");
  await page.getByLabel("Repository", { exact: true }).fill("vault");
  await page.getByLabel("Fine-grained access token", { exact: true }).fill("bad-token");
  await page.getByRole("button", { name: "Open vault", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Repository", { exact: true }).inputValue(), "vault");
  await page.getByLabel("Fine-grained access token", { exact: true }).fill("fixture-token");
  await page.getByRole("button", { name: "Open vault", exact: true }).click();
  await page.locator('.file-row[data-path="Notes/Welcome.md"]').waitFor();
  await page.locator('.file-row[data-path="Notes/Welcome.md"]').dblclick();
  await page.getByRole("heading", { name: "Welcome", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("toolbar", { name: "Markdown formatting" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Minimize", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Assistant", exact: true }).count(), 0);
  await page.screenshot({ path: resolve(output, "desktop-light.png") });
  console.log(
    "PASS: sign-in error retention, fake-repository login, reused renderer and Markdown toolbar.",
  );

  const until = async (check, label) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const type = async (text) => {
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(text);
    await page.keyboard.press("Control+s");
  };
  const welcome = "Notes/Welcome.md";
  const conflictWrites = () =>
    fake.requests.filter(
      (r) => r.method === "PUT" && decodeURIComponent(r.url).includes("(conflict "),
    );

  await type("\nSaved from browser.");
  await until(() => fake.text(welcome)?.includes("Saved from browser."), "save reaches GitHub");
  console.log("PASS: browser save reaches the repository.");

  fake.protected = true;
  await type("\nBlocked by protection.");
  await page.locator(".sync-status", { hasText: "Sync error" }).waitFor();
  assert.ok(!fake.text(welcome).includes("Blocked by protection."));
  await page.reload();
  await page.locator('.file-row[data-path="Notes/Welcome.md"]').first().dblclick();
  await page.getByText("Blocked by protection.").first().waitFor();
  fake.protected = false;
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+s");
  await until(() => fake.text(welcome)?.includes("Blocked by protection."), "queued edit uploads");
  console.log("PASS: protected branch keeps the edit queued across reload, then uploads.");

  fake.set(welcome, "# Welcome\n\nChanged on GitHub.\n");
  await type("\nLocal after remote change.");
  await until(() => conflictWrites().length > 0, "conflict copy written");
  assert.equal(fake.text(welcome), "# Welcome\n\nChanged on GitHub.\n");
  await page.locator(".sync-status", { hasText: "Conflict" }).waitFor();
  await page.screenshot({ path: resolve(output, "conflict.png") });
  console.log("PASS: same-note conflict keeps GitHub's version and writes a conflict copy.");
  assert.deepEqual(errors, []);
} catch (error) {
  const page = context.pages()[0];
  if (page) {
    await page.screenshot({ path: resolve(output, "failure.png") });
    console.error(
      "API requests",
      fake.requests.map((request) => ({ url: request.url, method: request.method })),
    );
    console.error((await page.locator("body").innerText()).slice(0, 3500));
  }
  throw error;
} finally {
  await browser.close();
}
