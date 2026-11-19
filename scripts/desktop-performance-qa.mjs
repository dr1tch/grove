// Synthetic profiles only. Run with xvfb-run -a node scripts/desktop-performance-qa.mjs.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const results = [];
for (const mode of ["Edit", "Split", "Live", "Live Split", "Backlinks"]) {
  const temp = await mkdtemp(join(tmpdir(), "grove-performance-"));
  const vault = join(temp, "vault"),
    profile = join(temp, "profile");
  await mkdir(vault);
  await mkdir(profile);
  const files = mode === "Backlinks" ? 200 : 1000;
  const note =
    "# Performance fixture\n\n" +
    Array.from(
      { length: 350 },
      (_, index) =>
        `Paragraph ${index}. This is a synthetic note for measuring typing and scrolling. **Formatted text** with a [relative link](Other.md) and ordinary text.\n\n`,
    ).join("");
  await Promise.all(
    Array.from({ length: files }, (_, index) =>
      writeFile(
        join(vault, `Note-${index}.md`),
        mode === "Backlinks"
          ? `# Note ${index}\n\n[[Note-0]]\n`
          : index === 0
            ? note
            : `# Note ${index}\n`,
      ),
    ),
  );
  await writeFile(
    join(profile, "state.json"),
    JSON.stringify({
      vault,
      settings: { previewStyle: mode.startsWith("Live") ? "live" : "formatted" },
      tabs: [
        {
          path: "Note-0.md",
          mode:
            mode === "Backlinks" || mode === "Live"
              ? "preview"
              : mode === "Live Split"
                ? "split"
                : mode.toLowerCase(),
        },
      ],
      active: "Note-0.md",
    }),
  );
  let app;
  try {
    const executable = process.env.FOLIO_SMOKE_EXECUTABLE;
    app = await electron.launch({
      ...(executable ? { executablePath: executable } : {}),
      args: [...(executable ? [] : ["."]), "--ozone-platform=x11", `--user-data-dir=${profile}`],
    });
    if (process.env.GROVE_EXPECT_VERSION)
      assert.equal(
        await app.evaluate(({ app }) => app.getVersion()),
        process.env.GROVE_EXPECT_VERSION,
      );
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    if (mode === "Backlinks") {
      await page.getByRole("heading", { name: "Note 0", exact: true }).waitFor();
      const timing = await page.evaluate(async (root) => {
        const run = async () => {
          const start = performance.now();
          const data = await window.folio.linksFor("Note-0.md", root);
          return { ms: Math.round(performance.now() - start), incoming: data.incoming.length };
        };
        return { cold: await run(), warm: await run() };
      }, vault);
      assert.equal(timing.cold.incoming, 200);
      if (!executable || process.env.GROVE_EXPECT_VERSION)
        assert.ok(timing.cold.ms < 2000, `Cold backlink regression: ${timing.cold.ms}ms`);
      results.push({ mode, files, ...timing });
    } else {
      const source = page
        .locator(mode.startsWith("Live") ? ".live-markdown" : ".cm-content")
        .first();
      await source.waitFor();
      if (mode === "Split")
        await page.getByRole("heading", { name: "Performance fixture", exact: true }).waitFor();
      await page.waitForTimeout(500);
      await source.click();
      await page.keyboard.press("Control+End");
      await page.evaluate(() => {
        window.inputTimes = [];
        document.addEventListener(
          "beforeinput",
          () => {
            const start = performance.now();
            requestAnimationFrame(() => window.inputTimes.push(performance.now() - start));
          },
          true,
        );
      });
      await page.keyboard.type(" typing performance sample with fifty keystrokes here.", {
        delay: 20,
      });
      await page.waitForTimeout(600);
      const timing = await page.evaluate(() => {
        const samples = window.inputTimes.sort((a, b) => a - b);
        return {
          samples: samples.length,
          p95: Math.round(samples[Math.floor(samples.length * 0.95)]),
          max: Math.round(samples.at(-1)),
        };
      });
      assert.ok(timing.samples >= 50);
      if (!executable || process.env.GROVE_EXPECT_VERSION)
        assert.ok(timing.p95 < 50, `${mode} input regression: p95=${timing.p95}ms`);
      results.push({ mode, files, noteBytes: Buffer.byteLength(note), ...timing });
    }
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await app?.close();
  }
}
const output = resolve("qa-artifacts/desktop-performance");
await mkdir(output, { recursive: true });
await writeFile(
  join(
    output,
    process.env.FOLIO_SMOKE_EXECUTABLE
      ? process.env.GROVE_EXPECT_VERSION
        ? `installed-${process.env.GROVE_EXPECT_VERSION}-results.json`
        : "installed-results.json"
      : "optimized-results.json",
  ),
  JSON.stringify(results, null, 2),
);
