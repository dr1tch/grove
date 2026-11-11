import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "grove-wheel-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await mkdir(vault);
await mkdir(profile);
await writeFile(join(profile, "state.json"), "{}");
await writeFile(
  join(vault, "Picture.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="#368478"/></svg>',
);
await promisify(execFile)("ffmpeg", [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=640x360:rate=12",
  "-t",
  "2",
  "-c:v",
  "libvpx",
  "-pix_fmt",
  "yuv420p",
  join(vault, "Clip.webm"),
]);
let app;
await promisify(execFile)("ffmpeg", [
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  join(vault, "Tone.mp3"),
]);
const originals = await Promise.all(
  ["Picture.svg", "Clip.webm"].map((name) => readFile(join(vault, name))),
);
try {
  app = await electron.launch({
    args: ["--ozone-platform=x11", ".", `--user-data-dir=${profile}`],
  });
  let page = await app.firstWindow();
  const main = page;
  const errors = [];
  const watch = (page) => {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watch(page);
  await page.locator('.file-row[data-path="package.json"]').waitFor();
  await app.evaluate(
    ({ app }, root) => app.emit("second-instance", {}, ["electron", "app", root]),
    vault,
  );
  const checkZoom = async (selector) => {
    const media = page.locator(selector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return el instanceof HTMLVideoElement ? el.readyState >= 2 : el?.naturalWidth > 0;
    }, selector);
    await page.getByRole("button", { name: "Fit to window", exact: true }).click();
    const before = await media.boundingBox();
    await media.hover();
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(
      ({ selector, width }) =>
        document.querySelector(selector).getBoundingClientRect().width > width + 5,
      { selector, width: before.width },
    );
    const enlarged = await media.boundingBox();
    assert.equal(
      await page
        .getByRole("button", { name: "Fit to window", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    await media.hover();
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(
      ({ selector, width }) =>
        document.querySelector(selector).getBoundingClientRect().width < width - 5,
      { selector, width: enlarged.width },
    );
    assert.ok(
      await media.evaluate((el) => {
        const event = new WheelEvent("wheel", {
          deltaY: -2,
          deltaMode: 1,
          cancelable: true,
          bubbles: true,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      "Line scrolling is consumed for zoom",
    );
    assert.equal(
      await media.evaluate((el) => {
        const event = new WheelEvent("wheel", {
          deltaX: 30,
          deltaY: 0,
          cancelable: true,
          bubbles: true,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      false,
      "Horizontal panning is preserved",
    );
    await page.getByRole("button", { name: "Fit to window", exact: true }).click();
    await page.waitForFunction(
      ({ selector, width }) =>
        Math.abs(document.querySelector(selector).getBoundingClientRect().width - width) < 2,
      { selector, width: before.width },
    );
  };
  const checkPan = async (selector) => {
    const media = page.locator(selector);
    for (let i = 0; i < 24; i++)
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const view = page.locator(selector.startsWith(".image") ? ".image-view" : ".video-view");
    await view.evaluate((el) => el.scrollTo(120, 120));
    const box = await view.boundingBox();
    const start = await view.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    await page.mouse.move(box.x + 220, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 110, { steps: 5 });
    await page.mouse.up();
    const end = await view.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    assert.ok(end[0] > start[0] + 50 && end[1] > start[1] + 50, "Dragging pans both axes");
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x - 10, box.y + 80, { steps: 5 });
    assert.ok(
      await view.evaluate((el) => el.classList.contains("panning")),
      "Capture keeps drag active outside frame",
    );
    await media.dispatchEvent("pointercancel", { pointerId: 1 });
    const cancelled = await view.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    await page.mouse.move(box.x + 150, box.y + 100);
    await page.mouse.up();
    assert.deepEqual(
      await view.evaluate((el) => [el.scrollLeft, el.scrollTop]),
      cancelled,
      "Cancel stops panning",
    );
    assert.equal(await view.evaluate((el) => el.classList.contains("panning")), false);
    await page.mouse.dblclick(box.x + 200, box.y + 150);
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Fit to window"]').getAttribute("aria-pressed") ===
        "true",
    );
    assert.deepEqual(await view.evaluate((el) => [el.scrollLeft, el.scrollTop]), [0, 0]);
  };
  await page.locator('.file-tree .file-row[data-path="Picture.svg"]').click();
  await page.locator('.tab.active[data-path="Picture.svg"]').waitFor();
  await checkZoom(".image-view img");
  await checkPan(".image-view img");
  const opened = app.waitForEvent("window");
  await page.getByRole("button", { name: "Full window", exact: true }).click();
  page = await opened;
  watch(page);
  await checkZoom(".image-view img");
  await checkPan(".image-view img");
  await page.close();
  page = main;
  await page.locator('.file-tree .file-row[data-path="Clip.webm"]').click();
  await page.locator('.tab.active[data-path="Clip.webm"]').waitFor();
  await checkZoom(".video-view video");
  await page.locator("video").evaluate((video) => video.play());
  await page.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
  await page.locator("video").evaluate((video) => video.pause());
  const time = await page.locator("video").evaluate((video) => video.currentTime);
  await checkPan(".video-view video");
  assert.equal(
    await page.locator("video").evaluate((video) => video.paused),
    true,
    "Pan and reset preserve paused state",
  );
  await checkZoom(".video-view video");
  assert.equal(
    await page.locator("video").evaluate((video) => video.currentTime),
    time,
    "Zoom keeps playback position",
  );
  assert.equal(await page.locator("video").evaluate((video) => video.controls), false);
  const center = await page.locator("video").boundingBox();
  await page.mouse.click(center.x + center.width / 2, center.y + center.height / 2);
  await page.waitForFunction(() => !document.querySelector("video").paused);
  await page.locator(".video-big-play").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Pause (K)" }).click();
  await page.waitForFunction(() => document.querySelector("video").paused);
  const track = await page.getByRole("slider", { name: "Seek" }).boundingBox();
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  const duration = await page.locator("video").evaluate((video) => video.duration);
  const seeked = await page.locator("video").evaluate((video) => video.currentTime);
  assert.ok(Math.abs(seeked - duration * 0.75) < duration * 0.05, "Seek bar click jumps to 75%");
  assert.equal(
    await page.locator("video").evaluate((video) => video.paused),
    true,
    "Seeking keeps the paused state",
  );
  await page.locator(".video-shell").focus();
  await page.keyboard.press("k");
  await page.waitForFunction(() => !document.querySelector("video").paused);
  await page.keyboard.press("k");
  await page.waitForFunction(() => document.querySelector("video").paused);
  const videoBox = await page.locator("video").boundingBox();
  await page.mouse.click(videoBox.x + videoBox.width / 2, videoBox.y + 20);
  await page.waitForFunction(() => !document.querySelector("video").paused);
  await page.locator("video").evaluate((video) => video.pause());
  await page.locator('.file-tree .file-row[data-path="Tone.mp3"]').click();
  const audio = page.locator(".audio-player audio");
  await audio.waitFor({ state: "attached" });
  assert.equal(await audio.evaluate((el) => el.controls), false, "Audio uses the custom player");
  await page.waitForFunction(() => document.querySelector(".audio-player audio").readyState >= 1);
  await page.locator(".audio-big-play").click();
  await page.waitForFunction(() => !document.querySelector(".audio-player audio").paused);
  assert.ok(await page.locator(".audio-player.playing").count(), "Playing state animates the bars");
  await page.locator(".audio-big-play").click();
  await page.waitForFunction(() => document.querySelector(".audio-player audio").paused);
  const audioTrack = await page
    .locator(".audio-player")
    .getByRole("slider", { name: "Seek" })
    .boundingBox();
  await page.mouse.click(audioTrack.x + audioTrack.width / 2, audioTrack.y + audioTrack.height / 2);
  const half = await audio.evaluate((el) => el.currentTime / el.duration);
  assert.ok(Math.abs(half - 0.5) < 0.08, "Audio seek bar jumps to the middle");
  await page.locator(".audio-player").getByRole("button", { name: "Mute (M)" }).click();
  assert.equal(await audio.evaluate((el) => el.muted), true, "Mute button mutes audio");
  assert.deepEqual(errors, []);
  for (const [index, name] of ["Picture.svg", "Clip.webm"].entries())
    assert.deepEqual(
      await readFile(join(vault, name)),
      originals[index],
      "Media originals unchanged",
    );
  console.log(
    "PASS: image/video wheel zoom, two-axis pan, capture outside frame, cancellation, double-click fit, separate image window, custom video player (play, pause, seek, K key, click to play), custom audio player (play, seek, mute), paused state and original bytes preserved. Fixture:",
    temp,
  );
} finally {
  await app?.close();
}
