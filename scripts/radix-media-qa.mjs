import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

// Run against the current out build: xvfb-run -a node scripts/radix-media-qa.mjs
// All media is synthetic silence. The application uses an isolated temporary profile.
const temp = await mkdtemp(join(tmpdir(), "grove-radix-media-"));
const vault = join(temp, "vault"),
  profile = join(temp, "profile");
await Promise.all([mkdir(vault), mkdir(profile)]);
const sampleRate = 8000,
  seconds = 20,
  samples = sampleRate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
await writeFile(join(vault, "Silence.wav"), wav);
await writeFile(
  join(profile, "state.json"),
  JSON.stringify({ vault, settings: { theme: "dark" } }),
);
const errors = [];
let app;
try {
  const executablePath = process.env.FOLIO_SMOKE_EXECUTABLE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), "--ozone-platform=x11", `--user-data-dir=${profile}`],
  });
  if (process.env.GROVE_EXPECT_VERSION)
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      process.env.GROVE_EXPECT_VERSION,
    );
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.locator(".app").waitFor();
  await page.waitForTimeout(700);
  await app.evaluate(
    ({ app }, root) =>
      app.emit("second-instance", {}, app.isPackaged ? ["folio", root] : ["electron", "app", root]),
    vault,
  );
  await page
    .locator('.file-tree .file-row[data-path="Silence.wav"]')
    .dblclick()
    .catch(async (error) => {
      console.error(await page.locator("body").innerText());
      console.error(errors);
      throw error;
    });
  const player = page.locator(".audio-player");
  await player.waitFor();
  await page.waitForFunction(() => document.querySelector("audio")?.duration === 20);
  const mediaState = () =>
    player.locator("audio").evaluate((media) => ({
      time: media.currentTime,
      paused: media.paused,
      volume: media.volume,
      muted: media.muted,
      rate: media.playbackRate,
    }));
  const seek = player.getByRole("slider", { name: "Seek", exact: true });
  const track = player.locator(".player-track");
  const bounds = await track.boundingBox();
  assert.ok(bounds && bounds.width > 100);
  await page.mouse.click(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2);
  let state = await mediaState();
  assert.ok(Math.abs(state.time - 5) < 0.4, JSON.stringify(state));
  assert.equal(state.paused, true, "Seeking paused audio must keep it paused");
  await seek.focus();
  await page.keyboard.press("ArrowRight");
  state = await mediaState();
  assert.ok(Math.abs(state.time - 10) < 0.4, JSON.stringify(state));
  await page.keyboard.press("Home");
  assert.equal((await mediaState()).time, 0);
  await page.keyboard.press("End");
  assert.equal((await mediaState()).time, 20);
  await page.keyboard.press("Home");
  await player.getByRole("button", { name: "Play (K)", exact: true }).click();
  await page.waitForFunction(() => {
    const media = document.querySelector("audio");
    return media && !media.paused && media.currentTime > 0;
  });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  assert.equal((await mediaState()).paused, true, "Scrubbing pauses active playback");
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  state = await mediaState();
  assert.ok(Math.abs(state.time - 12) < 1, JSON.stringify(state));
  await player.getByRole("button", { name: "Pause (K)", exact: true }).click();
  const volume = player.getByRole("slider", { name: "Volume", exact: true });
  await volume.focus();
  await page.keyboard.press("Home");
  state = await mediaState();
  assert.equal(state.volume, 0);
  assert.equal(state.muted, true);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  state = await mediaState();
  assert.ok(Math.abs(state.volume - 0.99) < 0.001, JSON.stringify(state));
  assert.equal(state.muted, false);
  const speed = player.getByRole("button", {
    name: "Playback speed",
    exact: true,
  });
  await speed.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Playback speed", exact: true });
  await menu.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "menuitemradio",
  );
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent === "2×");
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "hidden" });
  assert.equal((await mediaState()).rate, 2);
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Playback speed",
  );
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  assert.equal(
    await menu.getByRole("menuitemradio", { name: "2×", exact: true }).getAttribute("aria-checked"),
    "true",
  );
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal((await mediaState()).rate, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Radix seek pointer/keyboard, playback scrub pause/resume, volume/mute and speed menu keyboard selection. Synthetic fixture:",
    temp,
  );
} finally {
  await app?.close();
}
