// Clicks every video player control and key in the source build; exits non-zero if any fails.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const t = await mkdtemp(join(tmpdir(), "vc-")),
  v = join(t, "v"),
  p = join(t, "p");
await mkdir(v);
await mkdir(p);
await writeFile(join(p, "state.json"), "{}");
await copyFile(process.env.HOME + "/Documents/grove-samples/media/clip.mp4", join(v, "Clip.mp4"));
const app = await electron.launch({ args: ["--ozone-platform=x11", ".", `--user-data-dir=${p}`] });
const page = await app.firstWindow();
page.setDefaultTimeout(5000);
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await page.locator('.file-row[data-path="package.json"]').waitFor({ timeout: 15000 });
await app.evaluate(
  ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
  v,
);
await page.locator('.file-tree .file-row[data-path="Clip.mp4"]').click();
await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, null, {
  timeout: 15000,
});
const st = () =>
  page.evaluate(() => {
    const x = document.querySelector("video");
    return {
      t: +x.currentTime.toFixed(2),
      paused: x.paused,
      muted: x.muted,
      vol: x.volume,
      w: Math.round(x.getBoundingClientRect().width),
      fs: !!document.fullscreenElement,
    };
  });
const log = [];
const _log = console.log;
console.log = (...a) => log.push(a.join(" "));
const tryIt = async (name, fn, check) => {
  const before = await st();
  try {
    await fn();
    await page.waitForTimeout(400);
    const after = await st();
    console.log(
      (check(before, after) ? "OK  " : "FAIL") + " " + name,
      JSON.stringify(before),
      "->",
      JSON.stringify(after),
    );
  } catch (e) {
    console.log("ERR  " + name, e.message.split("\n")[0]);
  }
};
const btn = (n) => page.getByRole("button", { name: n, exact: true });
await tryIt(
  "play button",
  () => btn("Play (K)").click(),
  (a, b) => !b.paused,
);
await tryIt(
  "pause button",
  () => btn("Pause (K)").click(),
  (a, b) => b.paused,
);
await tryIt(
  "forward 10",
  () => btn("Forward 10 seconds (L)").click(),
  (a, b) => b.t > a.t,
);
await tryIt(
  "back 10",
  () => btn("Back 10 seconds (J)").click(),
  (a, b) => b.t < a.t || a.t === 0,
);
await tryIt(
  "mute",
  () => btn("Mute (M)").click(),
  (a, b) => b.muted,
);
await tryIt(
  "unmute",
  () => btn("Unmute (M)").click(),
  (a, b) => !b.muted,
);
await tryIt(
  "volume slider",
  async () => {
    await btn("Mute (M)").hover();
    await page.getByRole("slider", { name: "Volume" }).fill("30");
  },
  (a, b) => Math.abs(b.vol - 0.3) < 0.02,
);
await tryIt(
  "zoom in",
  () => btn("Zoom in").click(),
  (a, b) => b.w > a.w,
);
await tryIt(
  "zoom out",
  () => btn("Zoom out").click(),
  (a, b) => b.w < a.w,
);
await tryIt(
  "fit",
  async () => {
    await btn("Zoom in").click();
    await btn("Fit to window").click();
  },
  (a, b) => b.w === a.w,
);
await tryIt(
  "seek drag",
  async () => {
    const bx = await page.getByRole("slider", { name: "Seek" }).boundingBox();
    await page.mouse.move(bx.x + 5, bx.y + bx.height / 2);
    await page.mouse.down();
    await page.mouse.move(bx.x + bx.width * 0.6, bx.y + bx.height / 2, { steps: 5 });
    await page.mouse.up();
  },
  (a, b) => b.t > 1.5,
);
await tryIt(
  "seek keyboard right",
  async () => {
    await page.getByRole("slider", { name: "Seek" }).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
  },
  (a, b) => b.t > 0,
);
await tryIt(
  "key K",
  async () => {
    await page.locator(".video-shell").focus();
    await page.keyboard.press("k");
  },
  (a, b) => b.paused !== a.paused,
);
await tryIt(
  "key M",
  () => page.keyboard.press("m"),
  (a, b) => b.muted !== a.muted,
);
await tryIt(
  "key J (back)",
  async () => {
    await page.locator("video").evaluate((x) => {
      x.pause();
      x.currentTime = 3;
    });
    await page.keyboard.press("j");
  },
  (a, b) => b.t < 1,
);
await tryIt(
  "space",
  () => page.keyboard.press(" "),
  (a, b) => b.paused !== a.paused,
);
await tryIt(
  "fullscreen button",
  () => btn("Fullscreen").click(),
  (a, b) => b.fs,
);
await tryIt(
  "exit fullscreen",
  () => btn("Exit fullscreen").click(),
  (a, b) => !b.fs,
);
await tryIt(
  "fullscreen key F",
  async () => {
    await page.locator(".video-shell").focus();
    await page.keyboard.press("f");
  },
  (a, b) => b.fs,
);
await tryIt(
  "escape leaves fullscreen",
  () => page.keyboard.press("Escape"),
  (a, b) => !b.fs,
);
const rate = () => page.locator("video").evaluate((x) => x.playbackRate);
await btn("Playback speed").click();
await page.getByRole("menuitemradio", { name: "1.5×" }).click();
console.log((await rate()) === 1.5 ? "OK   speed menu 1.5x" : "FAIL speed menu", await rate());
await page.locator(".video-shell").focus();
await page.keyboard.press(">");
console.log((await rate()) === 2 ? "OK   speed key >" : "FAIL speed key >", await rate());
await page.keyboard.press("<");
console.log((await rate()) === 1.5 ? "OK   speed key <" : "FAIL speed key <", await rate());
await btn("Playback speed").click();
await page.keyboard.press("Escape");
console.log(
  (await page.getByRole("menu").count()) === 0
    ? "OK   speed menu closes on Escape"
    : "FAIL menu still open",
);
await btn("Playback speed").click();
await page.mouse.click(700, 300);
console.log(
  (await page.getByRole("menu").count()) === 0
    ? "OK   speed menu closes on outside click"
    : "FAIL menu still open (outside)",
);
await tryIt(
  "ended then play restarts",
  async () => {
    await page.locator("video").evaluate((x) => {
      x.currentTime = x.duration;
    });
    await page.waitForTimeout(500);
    await btn("Play (K)").click();
  },
  (a, b) => !b.paused && b.t < 1,
);
await page.locator("video").evaluate((x) => x.pause());
await page.waitForTimeout(300);
await btn("Playback speed").hover();
await page.waitForTimeout(600);
await btn("Playback speed").click();
await page.waitForTimeout(600);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] + "/vctl.png" });
await app.close();
const out = log.join("\n");
_log(out);
if (/^(FAIL|ERR)/m.test(out)) process.exit(1);
_log("PASS: every video control (buttons, keys, seek, volume, speed, zoom, fullscreen)");
