import { it, expect } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./vault";
import { importAttachments } from "./attachments";
it("reports partial failures and preserves files already copied", async () => {
  const base = await mkdtemp(join(tmpdir(), "grove-import-test-")),
    root = join(base, "vault");
  await mkdir(root);
  await writeFile(join(root, "n.md"), "# Note");
  await writeFile(join(base, "source.bin"), Buffer.from([0, 255, 3]));
  await symlink(join(base, "source.bin"), join(base, "alias.bin"));
  const result = await importAttachments(new Vault(root), "n.md", [
    join(base, "source.bin"),
    join(base, "missing"),
    join(base, "alias.bin"),
  ]);
  expect(result.attachments).toHaveLength(1);
  expect(result.failures).toHaveLength(2);
  expect(await readFile(join(root, result.attachments[0].path))).toEqual(
    await readFile(join(base, "source.bin")),
  );
});
