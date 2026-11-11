import { it, expect } from "vite-plus/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portableDocument } from "./export-document";
import { Vault } from "./vault";
it("inlines local images and attachments and produces inert standalone HTML", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-export-"));
  await writeFile(
    join(root, "p.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  await writeFile(join(root, "a.bin"), Buffer.from([1, 2, 3]));
  const result = await portableDocument(
    new Vault(root),
    { path: "n.md", content: "# Note", format: "html", theme: "light" },
    '<h1>Note</h1><img src="folio://app/_export/token/p.svg"><a href="a.bin">Attachment</a><script>alert(1)</script><p onclick="alert(1)">Text</p>',
    "",
  );
  expect(result.html).toContain("data:image/svg+xml;base64,");
  expect(result.html).toContain("data:application/octet-stream;base64,AQID");
  expect(result.html).not.toMatch(/<script|onclick|file:\/\//);
  expect(result.warnings).toEqual([]);
});
it("keeps sanitized SVG labels without retaining executable content", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-export-label-"));
  const result = await portableDocument(
    new Vault(root),
    { path: "n.md", content: "# Note", format: "pdf", theme: "light" },
    "<svg><foreignObject><div><span>Flow label</span><script>alert(1)</script></div></foreignObject></svg>",
    "",
  );
  expect(result.html).toContain("Flow label");
  expect(result.html).not.toContain("<script");
});
