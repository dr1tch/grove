import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const output = "../../out/web";
await mkdir(`${output}/excalidraw-assets`, { recursive: true });
await cp(
  "../../node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  `${output}/excalidraw-assets/fonts`,
  { recursive: true },
);
await cp("../../resources/brand/grove-mark.svg", `${output}/grove-mark.svg`);
const files = [];
async function walk(directory, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) await walk(join(directory, item.name), relative + "/");
    else if (relative !== "sw.js" && !relative.endsWith(".map")) files.push(relative);
  }
}
await walk(output);
files.sort((a, b) => a.localeCompare(b));
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(join(output, file)));
}
const worker = await readFile("public/sw.js", "utf8");
await writeFile(
  `${output}/sw.js`,
  worker
    .replace("__BUILD_ID__", hash.digest("hex").slice(0, 16))
    .replace("__STATIC_FILES__", JSON.stringify(files.map((file) => `/grove/app/${file}`))),
);
console.log(`Assembled local fonts and offline app shell (${files.length} static files).`);
