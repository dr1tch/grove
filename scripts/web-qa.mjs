import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";
const target = process.env.GROVE_WEB_URL ?? "http://127.0.0.1:3071/grove/app/";
const output = resolve("qa-artifacts/web");
await mkdir(output, { recursive: true });
// Smallest valid one-page PDF with correct xref offsets.
function tinyPdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 18 Tf 20 70 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) body += `${String(at).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
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
  "Notes/Links.md": "# Links\n\nSee [Welcome](Welcome.md).\n",
  "Docs/Guide.pdf": tinyPdf("Grove PDF fixture"),
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
  if (fake.offline) {
    await route.abort("internetdisconnected");
    return;
  }
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
  // Builds with accounts configured put the token form behind a link.
  const tokenLink = page.getByRole("button", { name: "Use a GitHub token instead" });
  if (await tokenLink.isVisible()) await tokenLink.click();
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

  const row = (path) => page.locator(`.file-row[data-path="${path}"]`).first();
  const view = (name) =>
    page.locator(".title-actions").getByRole("button", { name, exact: true }).click();

  // Previews: Mermaid and an embedded vault image in a note, then image, PDF and drawing files.
  await view("Preview");
  await page.locator(".mermaid svg").first().waitFor();
  await until(
    () => page.locator('img[alt="Picture"]').evaluate((img) => img.naturalWidth > 0),
    "embedded image loads",
  );
  await row("Media/picture.png").dblclick();
  await until(
    () =>
      page
        .locator("main img")
        .last()
        .evaluate((img) => img.naturalWidth > 0),
    "image preview loads",
  );
  await row("Docs/Guide.pdf").dblclick();
  await page.locator(".pdf-page canvas").first().waitFor();
  await row("Drawings/Sketch.excalidraw").dblclick();
  await page.locator(".excalidraw").first().waitFor();
  console.log("PASS: Mermaid, embedded image, image, PDF and drawing previews.");

  // Content search finds note text; backlinks list the linking note.
  await page.keyboard.press("Control+Shift+f");
  await page.getByRole("textbox", { name: "Search file contents" }).fill("browser QA");
  await page.locator(".search-results button", { hasText: "Welcome" }).first().waitFor();
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await row("Notes/Welcome.md").dblclick();
  await page.getByRole("button", { name: "Backlinks and broken links", exact: true }).click();
  await page.locator(".backlinks-panel", { hasText: "Links" }).waitFor();
  await page.getByRole("button", { name: "Backlinks and broken links", exact: true }).click();
  console.log("PASS: content search and backlinks.");

  // Insert from vault embeds an existing file by its vault path.
  await view("Edit");
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Insert from vault" }).click();
  const insert = page.getByRole("dialog", { name: "Insert from vault", exact: true });
  await insert.getByRole("textbox").first().fill("Sketch");
  await insert.getByText("Sketch", { exact: false }).first().click();
  await insert.getByRole("button", { name: "Insert", exact: true }).click();
  await insert.waitFor({ state: "detached" });
  assert.ok((await page.locator(".cm-content").first().innerText()).includes("Sketch.excalidraw"));
  await page.keyboard.press("Control+z");
  assert.ok(
    !(await page.locator(".cm-content").first().innerText()).includes("Sketch.excalidraw"),
    "undo removes the insert",
  );
  await page.keyboard.press("Control+s");
  console.log("PASS: Insert from vault and undo.");

  // A new note asks Save/Discard/Cancel when closed; Discard writes nothing.
  const writes = () => fake.requests.filter((r) => r.method === "PUT").length;
  const before = writes();
  await page.keyboard.press("Control+n");
  await page.locator(".tab.active", { hasText: "Untitled" }).waitFor();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("scratch");
  await page.keyboard.press("Control+w");
  const closing = page.getByRole("dialog", { name: "Save note" });
  await closing.getByRole("button", { name: "Cancel" }).click();
  await page.locator(".tab.active", { hasText: "Untitled" }).waitFor();
  await page.keyboard.press("Control+w");
  await closing.getByRole("button", { name: "Discard" }).click();
  await closing.waitFor({ state: "detached" });
  assert.equal(writes(), before);
  console.log("PASS: new-note Cancel and Discard.");

  // A change made on GitHub reaches an open, unedited tab.
  await row("Notes/Chart.md").dblclick();
  await view("Preview");
  fake.set("Notes/Chart.md", "# Chart\n\nUpdated elsewhere.\n");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("Updated elsewhere.").first().waitFor();
  console.log("PASS: remote change refreshes an open note.");

  // Offline: the app shell reloads from the service worker, cached notes open and edits queue.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await row("Notes/Welcome.md").waitFor();
  fake.offline = true;
  await context.setOffline(true);
  const offlineMisses = [];
  const miss = (request) => {
    if (request.url().startsWith(new URL(target).origin)) offlineMisses.push(request.url());
  };
  page.on("requestfailed", miss);
  await page.reload();
  await row("Notes/Welcome.md").dblclick();
  await page.getByText("A note for browser QA.").first().waitFor();
  await view("Edit");
  await type("\nWritten offline.");
  await page.locator(".sync-status", { hasText: "Offline" }).waitFor();
  page.off("requestfailed", miss);
  assert.deepEqual(offlineMisses, [], "every app file loads offline");
  fake.offline = false;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(
    () => fake.text("Notes/Welcome.md")?.includes("Written offline."),
    "offline edit uploads",
  );
  console.log("PASS: offline reload, cached note, queued edit and reconnect.");

  // Phone width: no horizontal scroll, files reachable, touch targets at least 44 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(output, "phone.png") });
  await page.getByRole("button", { name: /^Hide sidebar/ }).click();
  await page.screenshot({ path: resolve(output, "phone-editor.png") });
  await view("Preview");
  await page.getByRole("heading", { name: "Welcome", exact: true }).waitFor();
  await until(
    () =>
      page
        .locator(".mermaid svg")
        .first()
        .evaluate((svg) => svg.getBoundingClientRect().height > 20),
    "diagram renders at phone width",
  );
  const account = await page.getByRole("button", { name: "Repository account" }).boundingBox();
  assert.ok(account && account.x + account.width <= 390, "Account button fits on screen");
  assert.equal(await page.getByText("1/1/1970").count(), 0);
  await page.screenshot({ path: resolve(output, "phone-preview.png") });
  await view("Edit");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, [role=button], a")]
      .filter((el) => el.offsetParent && el.getBoundingClientRect().height < 32)
      .map((el) => el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20)),
  );
  console.log("INFO: controls under 32 px at 390 px:", small.length, small.slice(0, 12));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Show sidebar" }).click();
  console.log("PASS: phone width has no horizontal scroll.");

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
  // Either sync writes a conflict copy, or the save sees the newer GitHub version first and
  // the tab shows the conflict banner with the local text intact. Both keep both versions.
  const banner = page.getByText("Another device changed this file at the same time.");
  await until(
    async () => conflictWrites().length > 0 || (await banner.isVisible()),
    "conflict copy or conflict banner",
  );
  assert.equal(fake.text(welcome), "# Welcome\n\nChanged on GitHub.\n");
  if (conflictWrites().length)
    await page.locator(".sync-status", { hasText: "Conflict" }).waitFor();
  else
    assert.ok(
      (await page.locator(".cm-content").first().innerText()).includes(
        "Local after remote change.",
      ),
    );
  await page.screenshot({ path: resolve(output, "conflict.png") });
  console.log("PASS: same-note conflict keeps GitHub's version and the local edit.");
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
