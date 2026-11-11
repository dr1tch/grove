import { it, expect } from "vite-plus/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHtmlPreview } from "./html-preview";
import { Vault } from "./vault";
it("preserves local styles and images while removing executable and network content", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-html-"));
  await writeFile(
    join(root, "local.css"),
    '@import "cycle.css"; h1{color:rgb(12,34,56);background:url("local.svg")}',
  );
  await writeFile(join(root, "cycle.css"), '@import "local.css";p{font-weight:bold}');
  await writeFile(
    join(root, "local.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  const result = await buildHtmlPreview(
    new Vault(root),
    "index.html",
    '<link rel="stylesheet" href="local.css"><h1 onclick="alert(1)">Hello</h1><img src="local.svg"><script>fetch("https://evil.test")</script><meta http-equiv="refresh" content="0;url=https://evil.test"><iframe src="https://evil.test"></iframe><a href="https://evil.test">Remote</a>',
  );
  expect(result.html).toContain("rgb(12,34,56)");
  expect(result.html).toContain("data:image/svg+xml;base64,");
  expect(result.html).not.toMatch(/onclick|<script|<iframe|http-equiv|href="https:/);
  expect(result.warnings.some((w) => w.includes("cycle"))).toBe(true);
});
