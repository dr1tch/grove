import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
await context.route("https://challenges.cloudflare.com/**", (r) =>
  r.fulfill({
    contentType: "application/javascript",
    body: `window.turnstile={render:(h,o)=>{setTimeout(()=>o.callback('XXXX.DUMMY.TOKEN.XXXX'),20);return 'widget'},reset:()=>{},remove:()=>{}};`,
  }),
);
const a = await context.newPage(),
  b = await context.newPage();
let leaveDialogs = 0;
context.on("dialog", async (dialog) => {
  leaveDialogs++;
  await dialog.dismiss();
});
const url = process.env.GROVE_WEB_URL ?? "http://127.0.0.1:3071/grove/app/",
  password = "local-account-tabs-17",
  email = `tabs-a-${Date.now()}@grove.test`,
  other = `tabs-b-${Date.now()}@grove.test`;
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(url).hostname),
  "Run only against a locally built QA app",
);
async function login(page, address, create = false) {
  await page.getByLabel("Email", { exact: true }).waitFor();
  if (create) await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: create ? "Create account" : "Sign in", exact: true })
    .click();
  await page.locator(".vault-switch strong", { hasText: "Grove cloud" }).waitFor();
}
async function logout(page) {
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
}
try {
  await a.goto(url);
  await login(a, email, true);
  await a.keyboard.press("Control+n");
  await a.locator(".cm-content").first().fill("# Account A private\n\nOnly A.");
  await a.keyboard.press("Control+s");
  const save = a.getByRole("dialog", { name: "Save note" });
  if (await save.isVisible().catch(() => false))
    await save.getByRole("button", { name: "Save", exact: true }).click();
  await a.locator('.file-row[data-path="Account A private.md"]').first().waitFor();
  await a.locator(".sync-status", { hasText: /Synced/ }).waitFor();
  await b.goto(url);
  await b.locator('.file-row[data-path="Account A private.md"]').first().waitFor();
  await b.keyboard.press("Control+n");
  await b.locator(".cm-content").first().click();
  await b.locator(".cm-content").first().fill("# Unfinished A draft");
  await b.waitForTimeout(100);
  await logout(a);
  await b.getByLabel("Email", { exact: true }).waitFor({ timeout: 7000 });
  assert.equal(
    leaveDialogs,
    0,
    "An account change must not offer to retain the previous private UI",
  );
  assert.equal(await b.locator('.file-row[data-path="Account A private.md"]').count(), 0);
  assert.equal(
    await b.evaluate(() =>
      Object.keys(localStorage).some(
        (k) =>
          k.startsWith("grove:web:new-drafts:") &&
          localStorage.getItem(k).includes("Unfinished A draft"),
      ),
    ),
    true,
  );
  await login(a, other, true);
  await b.locator(".vault-switch strong", { hasText: "Grove cloud" }).waitFor();
  assert.equal(await b.locator('.file-row[data-path="Account A private.md"]').count(), 0);
  await logout(a);
  await b.getByLabel("Email", { exact: true }).waitFor();
  await login(a, email);
  await b.locator('.file-row[data-path="Account A private.md"]').first().waitFor();
  console.log(
    "PASS: cross-tab sign-out detaches private UI, account B sees no A files, A draft survives, signing back as A restores its vault",
  );
} finally {
  await browser.close();
}
