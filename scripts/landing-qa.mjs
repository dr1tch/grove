// Check the built landing page through its real /grove/ project path.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.env.GROVE_LANDING_URL ?? "http://127.0.0.1:3070/grove/";
const screenshots = resolve("qa-artifacts/landing");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const errors = [];
const failed = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  for (const width of [390, 768, 793, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(target);
    assert.equal(response?.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.locator("#phone").scrollIntoViewIfNeeded();
    await page.locator(".phone-preview img").evaluate(async (image) => image.decode());
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Horizontal overflow at ${width}px`,
    );
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    assert.equal(await page.locator("details").count(), 5);
    await page.getByText("Can an agent edit without asking?", { exact: true }).click();
    assert.equal(await page.locator("details[open]").count(), 1);
    assert.match(
      await page.locator("details[open]").innerText(),
      /only writes to your vault when you accept/,
    );
    await page.getByText("Will it change my Obsidian vault?", { exact: true }).click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Phone", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#phone");
    assert.match(await page.locator("#phone").innerText(), /coming soon/i);
    for (const link of await page
      .getByRole("link", { name: "Download for Linux", exact: true })
      .all()) {
      assert.equal(
        await link.getAttribute("href"),
        "https://github.com/dr1tch/grove/releases/latest",
      );
    }
    assert.equal(
      await page
        .getByRole("link", { name: "View on GitHub", exact: true })
        .first()
        .getAttribute("href"),
      "https://github.com/dr1tch/grove",
    );
    const images = await page.locator("img").evaluateAll((images) =>
      images.map((image) => ({
        src: image.currentSrc,
        valid: image.complete && image.naturalWidth > 0,
        alt: image.hasAttribute("alt"),
      })),
    );
    assert(
      images.every((image) => image.valid && image.alt),
      JSON.stringify(images),
    );
    assert(
      images.every(
        (image) =>
          image.src.startsWith("data:") || new URL(image.src).pathname.startsWith("/grove/"),
      ),
      "Images must use the project subpath",
    );
    await page.getByRole("link", { name: "Grove home" }).first().click();
    await page.screenshot({ path: resolve(screenshots, `${width}.png`), fullPage: true });
  }
  await page.goto(target);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").innerText(), "Skip to content");
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  await page.locator("summary").nth(1).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("details[open] summary").innerText(),
    "Can an agent edit without asking?",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".button")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    `PASS: 390/768/793/1440px, project-subpath assets, images/fonts, FAQ clicks/keyboard, skip link, anchor navigation, release/source links, reduced motion; no runtime or HTTP errors. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
}
