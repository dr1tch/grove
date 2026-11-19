// Browser QA for Grove accounts against local Supabase (`npx supabase start`).
// Build first with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set (see scripts/web-build-local.sh).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createFakeGitHub } from "./fake-github.mjs";

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
const fixtures = new Map([
  ["notes", createFakeGitHub({ "First.md": "# First repository" })],
  ["work", createFakeGitHub({ "Second.md": "# Second repository" })],
]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info,x-github-api-version",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};
let connections = 0;
let denyAuthorization = false,
  failListing = false;
await context.route("https://github.com/login/oauth/authorize?**", async (route) => {
  const url = new URL(route.request().url());
  assert.equal(url.searchParams.get("client_id"), "fixture-client");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "offline_access");
  const callback = new URL(url.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", url.searchParams.get("state"));
  callback.searchParams.set("code", "fixture-code");
  if (denyAuthorization) callback.searchParams.set("error", "access_denied");
  connections++;
  await route.fulfill({
    contentType: "text/html",
    body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
  });
});
await context.route("**/functions/v1/github-app", async (route) => {
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  assert.ok(route.request().headers().authorization?.startsWith("Bearer "));
  assert.equal(route.request().postDataJSON().action, "exchange");
  await route.fulfill({
    headers: cors,
    json: {
      id: "1",
      login: "fixture",
      token: "fixture-token",
      refresh: "ghr_fixture_refresh_token",
      expiresIn: 3600,
      refreshExpiresIn: 86_400,
    },
  });
});
await context.route("https://api.github.com/**", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  assert.equal(req.headers().authorization, "Bearer fixture-token");
  if (failListing && url.pathname === "/user/installations")
    return route.fulfill({ status: 503, headers: cors, json: { message: "Unavailable" } });
  if (url.pathname === "/user/installations")
    return route.fulfill({
      headers: cors,
      json: { installations: [{ id: 1, app_slug: "grove-fixture" }] },
    });
  if (url.pathname === "/user/installations/1/repositories")
    return route.fulfill({
      headers: cors,
      json: {
        repositories: [...fixtures.keys()].map((name) => ({
          owner: { login: "fixture" },
          name,
          default_branch: "main",
          private: true,
          permissions: { push: true },
        })),
      },
    });
  const fake = fixtures.get(url.pathname.split("/")[3]);
  if (!fake) return route.fulfill({ status: 404, headers: cors, json: { message: "Not found" } });
  const response = await fake.fetch(req.url(), {
    method: req.method(),
    headers: req.headers(),
    ...(req.postData() ? { body: req.postData() } : {}),
  });
  await route.fulfill({
    status: response.status,
    headers: { ...Object.fromEntries(response.headers), ...cors },
    body: Buffer.from(await response.arrayBuffer()),
  });
});

const vaultName = page.locator(".vault-switch strong");
// Matches the file name in any folder the save dialog picked.
const row = (path) => page.locator(`.file-row[data-path$="${path}"]`).first();
async function signOut() {
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email", { exact: true }).waitFor();
}
async function emailForm(address, password, create = false) {
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
  for (const [button, provider, scope] of [["Continue with GitHub", "github", undefined]]) {
    const request = page.waitForRequest((r) => r.url().includes("/auth/v1/authorize"));
    await page.getByRole("button", { name: button }).click();
    const url = new URL((await request).url());
    assert.equal(url.searchParams.get("provider"), provider);
    assert.equal(url.searchParams.get("scopes"), scope ?? null);
    assert.ok(url.searchParams.get("redirect_to")?.startsWith(target));
    await page.goto(target);
    await page.getByLabel("Email", { exact: true }).waitFor();
  }
  console.log("PASS: Grove provider sign-in requests no repository scope.");

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

  // Repository authorization is independent from the signed-in Grove account.
  denyAuthorization = true;
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Connect GitHub repository" }).click();
  await page
    .getByRole("dialog", { name: "Repository account" })
    .getByRole("alert")
    .filter({ hasText: "not approved" })
    .waitFor();
  await row("Cloud note.md").waitFor();
  await page.getByRole("button", { name: "Back to notes" }).click();
  denyAuthorization = false;
  connections = 0;
  const userBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem("grove:web:account")).user.id,
  );
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Connect GitHub repository" }).click();
  await page.getByRole("heading", { name: "Choose your vault" }).waitFor();
  failListing = true;
  await page.getByRole("button", { name: "Refresh repositories" }).click();
  await page.getByRole("alert").filter({ hasText: "could not list" }).waitFor();
  failListing = false;
  await page.getByRole("button", { name: "Refresh repositories" }).click();
  await page.getByRole("button", { name: "fixture/notes" }).click();
  await row("First.md").waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("grove:web:account")).user.id),
    userBefore,
  );
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Connect GitHub repository" }).click();
  await page.getByLabel("Branch (optional)").fill("Work");
  await page.getByRole("button", { name: "fixture/work" }).click();
  await row("Second.md").waitFor();
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "multi-vault.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const bounds = await page.getByRole("dialog", { name: "Repository account" }).boundingBox();
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - 195) < 2);
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - 422) < 2);
  await page.screenshot({ path: resolve(output, "multi-vault-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  fixtures.get("notes").faults.push({ status: 404 });
  await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).click();
  await page.getByRole("dialog", { name: "Repository account" }).getByRole("alert").waitFor();
  await row("Second.md").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Open fixture/work (Work)", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await row("Cloud note.md").waitFor();
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).click();
  await row("First.md").waitFor();
  assert.equal(connections, 2);
  await row("First.md").dblclick();
  await page.getByRole("radio", { name: "Edit", exact: true }).first().click();
  fixtures.get("notes").protected = true;
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nPending across vaults");
  await page.keyboard.press("Control+s");
  await page.locator(".sync-status", { hasText: "Sync error" }).waitFor();
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await row("Cloud note.md").waitFor();
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).click();
  await row("First.md").dblclick();
  await page.getByText("Pending across vaults").first().waitFor();
  fixtures.get("notes").protected = false;
  await page.getByRole("button", { name: "Repository account" }).click();
  await page
    .getByRole("button", { name: "Remove fixture/work (Work) shortcut", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open fixture/work (Work)", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(fixtures.get("work").text("Second.md"), "# Second repository");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await row("Cloud note.md").waitFor();
  console.log(
    "PASS: independent GitHub App flow, two vaults/branches, failed switch, pending-edit recovery, responsive Account and safe shortcut removal.",
  );

  // Another account cannot see it.
  await signOut();
  assert.equal(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) => key.startsWith("grove:web:github-app:")).length,
    ),
    0,
  );
  await emailForm(other, "other-password-1", true);
  await vaultName.filter({ hasText: "Grove cloud" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await row("Cloud note.md").count(), 0);
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Refresh vaults" }).click();
  assert.equal(
    await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Back to notes" }).click();
  await signOut();
  console.log("PASS: a second account sees an empty vault.");

  // Sign in again with the password.
  await emailForm(email, "first-password-1");
  await row("Cloud note.md").waitFor();
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Open fixture/notes (main)", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Repository account" }).waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Repository account",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Repository account" })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "Repository account" }).click();
  await page.getByRole("button", { name: "Back to notes" }).click();
  await signOut();
  await emailForm(email, "wrong-password");
  await page.getByRole("alert").waitFor();
  await page.goto(target);
  console.log("PASS: password sign-in, and a wrong password shows an error.");

  // Password reset by email link, then sign in with the new password.
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
