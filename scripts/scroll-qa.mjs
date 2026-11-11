import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Scrolling a long note must not remount diagrams or code blocks, or show stray inner scrollbars.
const t = await mkdtemp(join(tmpdir(), "scroll-")),
  v = join(t, "v"),
  p = join(t, "p");
await cp(process.env.HOME + "/Documents/grove-samples", v, { recursive: true });
await mkdir(p);
await writeFile(join(p, "state.json"), "{}");
const long = (await import("node:fs")).readFileSync(join(v, "notes/Welcome.md"), "utf8");
await writeFile(
  join(v, "notes/Long.md"),
  long + "\n\n" + long.replace(/^# .*/m, "## Part two") + "\n\n" + "Paragraph. ".repeat(400),
);
const app = await electron.launch({ args: ["--ozone-platform=x11", ".", `--user-data-dir=${p}`] });
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
await page.locator('.file-row[data-path="package.json"]').waitFor();
await app.evaluate(
  ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
  v,
);
await page.locator('.file-tree .file-row[data-path="notes/Long.md"]').dblclick();
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__muts = { svg: 0, code: 0, removed: 0, attrs: 0 };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") {
        window.__muts.attrs++;
        continue;
      }
      for (const n of m.addedNodes)
        if (n.nodeType === 1) {
          if (n.matches?.("svg") || n.querySelector?.("svg")) window.__muts.svg++;
          if (n.matches?.("pre, .code-block") || n.querySelector?.("pre")) window.__muts.code++;
        }
      window.__muts.removed += m.removedNodes.length;
    }
  }).observe(document.querySelector(".markdown, .md, article") || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
});
const scroller = await page.evaluate(() => {
  const els = [...document.querySelectorAll("*")].filter(
    (e) =>
      e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY),
  );
  return els.map((e) => e.className).slice(0, 3);
});
assert.ok(scroller.includes("preview"), "Preview is the scroll container");
const bars = new Set();
for (let i = 0; i < 30; i++) {
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(60);
  for (const c of await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((e) => {
        const s = getComputedStyle(e);
        return (
          (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(s.overflowX)) ||
          (e.scrollHeight > e.clientHeight + 1 &&
            /auto|scroll/.test(s.overflowY) &&
            e.clientHeight < 700)
        );
      })
      .map(
        (e) =>
          e.tagName +
          "." +
          String(e.className).slice(0, 40) +
          ` ${e.clientWidth}x${e.clientHeight} sw${e.scrollWidth} sh${e.scrollHeight}`,
      ),
  ))
    bars.add(c);
}
const muts = await page.evaluate(() => window.__muts);
assert.equal(muts.svg, 0, "No diagram re-renders while scrolling");
assert.equal(muts.code, 0, "No code block re-renders while scrolling");
assert.deepEqual([...bars], [], "No inner scrollbars while scrolling");
console.log(
  "PASS: scrolling a long note keeps diagrams and code mounted with no inner scrollbars. Fixture:",
  t,
);
await app.close();
