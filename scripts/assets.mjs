import { cp, mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
await mkdir("build", { recursive: true });
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const n of b) {
    c ^= n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t, b) => {
  const type = Buffer.from(t);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(b.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, b])));
  return Buffer.concat([size, type, b, crc]);
};
const size = 512;
// Same visible footprint as Claude's installed 256px icon: 216 x 215, scaled to 512.
const inside = (x, y, polygon) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      hit = !hit;
  }
  return hit;
};
const curve = (points) => {
  const polygon = [];
  for (let t = 0; t <= 1; t += 1 / 48) {
    const u = 1 - t;
    polygon.push([
      u * u * u * points[0][0] +
        3 * u * u * t * points[1][0] +
        3 * u * t * t * points[2][0] +
        t * t * t * points[3][0],
      u * u * u * points[0][1] +
        3 * u * u * t * points[1][1] +
        3 * u * t * t * points[2][1] +
        t * t * t * points[3][1],
    ]);
  }
  return polygon;
};
const left = [
  ...curve([
    [250, 315],
    [139, 323],
    [103, 254],
    [110, 166],
  ]),
  ...curve([
    [110, 166],
    [218, 160],
    [270, 212],
    [250, 315],
  ]),
];
const right = [
  ...curve([
    [253, 256],
    [242, 149],
    [299, 103],
    [398, 113],
  ]),
  ...curve([
    [398, 113],
    [407, 216],
    [360, 275],
    [253, 256],
  ]),
];
const rows = [];
const pixel = (x, y) => {
  const dx = Math.max(40 - x, 0, x - 472);
  const dy = Math.max(46 - y, 0, y - 476);
  if (dx > 0 || dy > 0) return [0, 0, 0, 0];
  const cx = Math.max(145, Math.min(367, x));
  const cy = Math.max(151, Math.min(371, y));
  if ((x - cx) ** 2 + (y - cy) ** 2 > 105 ** 2) return [0, 0, 0, 0];
  const stem =
    (x >= 243 && x <= 267 && y >= 247 && y <= 378) || (x - 255) ** 2 + (y - 378) ** 2 <= 12 ** 2;
  if (stem || inside(x, y, right)) return [249, 244, 229, 255];
  if (inside(x, y, left)) return [202, 221, 190, 255];
  return [48, 92, 70, 255];
};
for (let y = 0; y < size; y++) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    const samples = [
      pixel(x + 0.25, y + 0.25),
      pixel(x + 0.75, y + 0.25),
      pixel(x + 0.25, y + 0.75),
      pixel(x + 0.75, y + 0.75),
    ];
    const alpha = samples.reduce((n, p) => n + p[3], 0) / 4;
    row.set(
      [0, 1, 2]
        .map((c) => (alpha ? samples.reduce((n, p) => n + p[c] * p[3], 0) / (alpha * 4) : 0))
        .concat(alpha),
      1 + x * 4,
    );
  }
  rows.push(row);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
await writeFile(
  "build/icon.png",
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
await cp("build/icon.png", "out/renderer/grove-icon.png");
await mkdir("out/renderer/excalidraw-assets", { recursive: true });
await cp(
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  "out/renderer/excalidraw-assets/fonts",
  { recursive: true },
);
