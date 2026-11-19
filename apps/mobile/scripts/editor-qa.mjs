// Build first: pnpm --filter @grove/mobile editor
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { editorHtml } from "../editor/generated.ts";

const executablePath =
  process.env.GROVE_CHROME_BIN ||
  (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
  const requests = [];
  const errors = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<style>body{margin:0}iframe{border:0;width:390px;height:720px}</style><iframe sandbox="allow-scripts" title="Isolated note"></iframe>',
  );
  await page.evaluate((html) => {
    window.__messages = [];
    window.addEventListener("message", (event) => {
      if (event.source !== document.querySelector("iframe").contentWindow) return;
      try {
        window.__messages.push(JSON.parse(event.data));
      } catch {
        /* Only protocol messages count. */
      }
    });
    document.querySelector("iframe").srcdoc = html;
  }, editorHtml);
  await page.waitForFunction(() => window.__messages.some((message) => message.type === "boot"));
  const frame = page.frameLocator("iframe");
  const identity = { documentId: "notes/test.md", session: "qa-1" };
  const send = (message) =>
    page.evaluate(
      (value) =>
        document.querySelector("iframe").contentWindow.postMessage(JSON.stringify(value), "*"),
      message,
    );
  const original = "# Phone\n\nhello";
  await send({
    type: "initialize",
    ...identity,
    revision: 0,
    value: original,
    mode: "edit",
    dark: false,
  });
  await frame.locator(".cm-content").click();
  assert.ok(
    await frame.locator(".cm-gutters").evaluate((node) => node.getBoundingClientRect().width >= 44),
  );
  assert.equal(
    await frame
      .locator(".cm-line span")
      .first()
      .evaluate((node) => getComputedStyle(node).color),
    "rgb(29, 78, 216)",
  );
  assert.equal(
    await frame.locator(".cm-editor").evaluate((node) => getComputedStyle(node).fontSize),
    "15px",
  );
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Home");
  await send({
    type: "command",
    ...identity,
    command: { id: 1, action: "bold" },
  });
  await page.waitForFunction(() =>
    window.__messages.some(
      (message) => message.type === "change" && message.value.includes("**hello**"),
    ),
  );
  await send({
    type: "command",
    ...identity,
    command: { id: 2, action: "undo" },
  });
  await page.waitForFunction(
    (value) =>
      window.__messages.filter((message) => message.type === "change").at(-1)?.value === value,
    original,
  );
  await send({
    type: "command",
    ...identity,
    command: { id: 3, action: "insert", text: "inserted" },
  });
  await page.waitForFunction(() =>
    window.__messages
      .filter((message) => message.type === "change")
      .at(-1)
      ?.value.includes("inserted"),
  );
  const next = { documentId: identity.documentId, session: "qa-2" };
  const reading =
    "# Safe\n\n| A | B |\n| - | - |\n| One | Two |\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n<script>window.hacked=true</script>\n![tracking](https://evil.example/track.png)\n\n[unsafe](javascript:alert(1))";
  await send({
    type: "replace",
    ...identity,
    nextSession: next.session,
    revision: 0,
    value: reading,
  });
  await send({ type: "appearance", ...next, mode: "read", dark: false });
  await frame.locator(".reading table").waitFor();
  await frame.locator(".diagram svg").waitFor();
  assert.match(await frame.locator(".diagram svg .node").first().textContent(), /A/);
  assert.equal(await frame.locator(".diagram svg foreignObject").count(), 0);
  assert.equal(
    await frame
      .locator(".diagram svg .node rect")
      .first()
      .evaluate((node) => getComputedStyle(node).filter),
    "none",
  );
  assert.equal(await frame.locator("img").count(), 0);
  assert.equal(await frame.locator("a[href]").count(), 0);
  assert.equal(await frame.locator("body").evaluate(() => window.hacked), undefined);
  assert.equal(
    await frame.locator("body").evaluate(() => {
      try {
        return !!window.parent.document;
      } catch {
        return false;
      }
    }),
    false,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: isolated offline editor, cursor formatting, one-step undo, insertion, source replacement, safe GFM, Mermaid labels, no network or HTML execution",
  );
} finally {
  await browser.close();
}
