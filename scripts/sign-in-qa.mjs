// All external auth, captcha and repository requests are intercepted. No real accounts are used.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.env.GROVE_WEB_URL ?? "http://127.0.0.1:3071/grove/app/";
const origin = new URL(target).origin;
const output = resolve("qa-artifacts/sign-in");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ serviceWorkers: "block" });
const requests = [],
  errors = [],
  unexpected = [];
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin === origin) return route.continue();
  if (url.hostname === "challenges.cloudflare.com" && url.pathname.endsWith("api.js"))
    return route.fulfill({
      contentType: "application/javascript",
      body: `
      const widgets = new Map();
      window.turnstile = {
        render(host, options) { const id = String(widgets.size); widgets.set(id, options); queueMicrotask(() => options.callback('fixture-captcha')); return id; },
        reset(id) { queueMicrotask(() => widgets.get(id)?.callback('fixture-captcha')); },
        remove(id) { widgets.delete(id); }
      };
    `,
    });
  if (url.pathname.startsWith("/auth/v1/")) {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    requests.push({ path: url.pathname, query: url.searchParams, body: request.postDataJSON() });
    if (url.pathname.endsWith("/authorize"))
      return route.fulfill({ contentType: "text/html", body: "<h1>Provider fixture</h1>" });
    if (url.pathname.endsWith("/token"))
      return route.fulfill({
        status: 400,
        headers: cors,
        json: { code: "invalid_credentials", msg: "Invalid login credentials" },
      });
    if (url.pathname.endsWith("/signup"))
      return route.fulfill({
        headers: cors,
        json: { user: { id: "fixture-user", identities: [] }, session: null },
      });
    if (url.pathname.endsWith("/recover")) return route.fulfill({ headers: cors, json: {} });
  }
  if (url.hostname === "api.github.com")
    return route.fulfill({ status: 401, headers: cors, json: { message: "Bad credentials" } });
  unexpected.push(url.origin + url.pathname);
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(String(error)));
const email = page.getByLabel("Email", { exact: true });
const password = page.getByLabel("Password", { exact: true });
try {
  await page.goto(target);
  await page.getByRole("button", { name: "Continue with GitHub", exact: true }).waitFor();
  await email.waitFor();
  await password.waitFor();
  assert.equal(await password.getAttribute("type"), "password");
  assert.equal(await password.getAttribute("autocomplete"), "current-password");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: resolve(output, `sign-in-${width}.png`), fullPage: true });
  }
  await email.fill("fixture@grove.test");
  await password.fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Invalid login credentials" }).waitFor();
  const login = requests.find((request) => request.path.endsWith("/token"));
  assert.equal(login.query.get("grant_type"), "password");
  assert.equal(login.body.email, "fixture@grove.test");
  assert.equal(login.body.password, "fixture-password");
  assert.equal(await email.inputValue(), "fixture@grove.test");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  assert.equal(await password.getAttribute("autocomplete"), "new-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Check your email" }).waitFor();
  assert.ok(requests.some((request) => request.path.endsWith("/signup")));
  await page.getByRole("button", { name: "I already have an account", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await email.fill("fixture@grove.test");
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "reset link" }).waitFor();
  assert.ok(requests.some((request) => request.path.endsWith("/recover")));
  await page.goto(target);
  await page.getByRole("button", { name: "Continue with GitHub", exact: true }).click();
  await page.getByRole("heading", { name: "Provider fixture" }).waitFor();
  const oauth = requests.find((request) => request.path.endsWith("/authorize"));
  assert.equal(oauth.query.get("provider"), "github");
  assert.equal(oauth.query.get("redirect_to"), target);
  await page.goto(target);
  await page.evaluate(() =>
    localStorage.setItem(
      "grove:web:credentials",
      JSON.stringify({
        kind: "github",
        ref: { owner: "fixture", repo: "vault", branch: "main" },
        token: "fixture-token",
        remember: true,
      }),
    ),
  );
  await page.reload();
  await email.waitFor();
  await page.getByRole("button", { name: "Continue with GitHub", exact: true }).waitFor();
  await page.getByRole("button", { name: "Use a GitHub token instead", exact: true }).click();
  await page.getByLabel("GitHub owner", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Other ways to sign in", exact: true }).click();
  await email.waitFor();
  await password.waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    "PASS: GitHub and inline email/password, failed-login retention, signup confirmation, password reset, returning-token users, fallback navigation and desktop/phone layout. Auth requests mocked; no hosted accounts changed.",
  );
} finally {
  await browser.close();
}
