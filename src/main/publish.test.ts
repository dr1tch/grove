import { it, expect } from "vite-plus/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { destinationIdentity, publishOutput } from "./publish";
it("preserves originals and refuses a destination changed during rendering", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-publish-")),
    path = join(root, "note.html");
  await writeFile(path, "Original");
  const expected = await destinationIdentity(path);
  await writeFile(path, "External");
  await expect(publishOutput(path, Buffer.from("Output"), expected)).rejects.toThrow("changed");
  expect(await readFile(path, "utf8")).toBe("External");
  const result = await publishOutput(path, Buffer.from("Output"), await destinationIdentity(path));
  expect(await readFile(path, "utf8")).toBe("Output");
  expect(await readFile(result.backup!, "utf8")).toBe("External");
});
