// Browser QA for Grove accounts against local Supabase (`npx supabase start`).
// Build first with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set (see scripts/web-build-local.sh).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.env.GROVE_WEB_URL ?? "http://127.0.0.1:3071/grove/app/";
const mail = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const output = resolve("qa-artifacts/web-accounts");
await mkdir(output, { recursive: true });
const email = `qa-${Date.now()}@grove.test`,
  other = `qa-other-${Date.now()}@grove.test`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

const vaultName = page.locator(".vault-switch strong");
// Matches the file name in any folder the save dialog picked.
const row = (path) => page.locator(`.file-row[data-path$="${path}"]`).first();
async function signOut() {
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Continue with email" }).waitFor();
}
async function emailForm(address, password, create = false) {
  await page.getByRole("button", { name: "Continue with email" }).click();
  if (create) await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(password);
  await page
    .getByRole("button", { name: create ? "Create account" : "Sign in", exact: true })
    .click();
}
async function resetLink(address) {
  for (let i = 0; i < 50; i++) {
    const found = await (
      await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
    ).json();
    if (found.messages?.length) {
      const message = await (await fetch(`${mail}/api/v1/message/${found.messages[0].ID}`)).json();
      const link = (message.Text + message.HTML).match(/https?:\/\/[^\s"<>]+verify[^\s"<>]+/)?.[0];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("No reset email arrived");
}

try {
  await page.goto(target);
  await page.getByRole("heading", { name: "Your vault, in your browser." }).waitFor();
  await page.screenshot({ path: resolve(output, "sign-in.png") });

  // Provider buttons go to Supabase's authorize endpoint with the right provider and scope.
  for (const [button, provider, scope] of [
    ["Continue with GitHub", "github", "repo"],
    ["Continue with Google", "google", undefined],
  ]) {
    const request = page.waitForRequest((r) => r.url().includes("/auth/v1/authorize"));
    await page.getByRole("button", { name: button }).click();
    const url = new URL((await request).url());
    assert.equal(url.searchParams.get("provider"), provider);
    if (scope) assert.equal(url.searchParams.get("scopes"), scope);
    assert.ok(url.searchParams.get("redirect_to")?.startsWith(target));
    await page.goto(target);
    await page.getByRole("button", { name: "Continue with email" }).waitFor();
  }
  console.log("PASS: GitHub (repo scope) and Google buttons start OAuth with the app redirect.");

  // Email sign-up opens an empty cloud vault; a saved note reaches the cloud and survives reload.
  await emailForm(email, "first-password-1", true);
  await vaultName.filter({ hasText: "Grove cloud" }).waitFor();
  await page.keyboard.press("Control+n");
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("# Cloud note\n\nHello cloud");
  await page.keyboard.press("Control+s");
  const save = page.getByRole("dialog", { name: "Save note" });
  if (await save.isVisible().catch(() => false))
    await save.getByRole("button", { name: "Save" }).click();
  await row("Cloud note.md").waitFor();
  await page.locator(".sync-status", { hasText: /Synced/ }).waitFor();
  await page.reload();
  await row("Cloud note.md").waitFor();
  await page.screenshot({ path: resolve(output, "cloud-vault.png") });
  console.log("PASS: email sign-up, cloud vault, saved note and reload.");

  // Another account cannot see it.
  await signOut();
  await emailForm(other, "other-password-1", true);
  await vaultName.filter({ hasText: "Grove cloud" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await row("Cloud note.md").count(), 0);
  await signOut();
  console.log("PASS: a second account sees an empty vault.");

  // Sign in again with the password.
  await emailForm(email, "first-password-1");
  await row("Cloud note.md").waitFor();
  await signOut();
  await emailForm(email, "wrong-password");
  await page.getByRole("alert").waitFor();
  await page.goto(target);
  console.log("PASS: password sign-in, and a wrong password shows an error.");

  // Password reset by email link, then sign in with the new password.
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByRole("status").filter({ hasText: "reset link" }).waitFor();
  await page.goto(await resetLink(email));
  await page.getByLabel("New password").fill("second-password-2");
  await page.getByRole("button", { name: "Set password" }).click();
  await row("Cloud note.md").waitFor();
  await signOut();
  await emailForm(email, "second-password-2");
  await row("Cloud note.md").waitFor();
  console.log("PASS: password reset by email, then sign-in with the new password.");

  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") });
  console.error((await page.locator("body").innerText()).slice(0, 2000));
  throw error;
} finally {
  await browser.close();
}
