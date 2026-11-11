import { it, expect } from "vite-plus/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./vault";
import { Links } from "./links";
it("blocks stale plans and resumes a rename interrupted after the path move", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-links-"));
  await mkdir(join(root, "moved"));
  await writeFile(join(root, "target.md"), "# Target");
  await writeFile(join(root, "source.md"), "[Target](target.md)");
  const vault = new Vault(root),
    links = new Links(vault);
  const stale = await links.plan("target.md", "moved/target.md");
  await writeFile(join(root, "source.md"), "New external text");
  await expect(links.apply(stale.id)).rejects.toThrow("changed after planning");
  await writeFile(join(root, "source.md"), "[Target](target.md)");
  const plan = await links.plan("target.md", "moved/target.md");
  await vault.putLinkJournal(plan, true);
  await vault.rename(plan.source, plan.target);
  const resumed = new Links(new Vault(root));
  await resumed.apply(plan.id);
  expect(await readFile(join(root, "source.md"), "utf8")).toBe("[Target](moved/target.md)");
  expect(await vault.linkJournal()).toBeNull();
});
it("recognizes a saved link update after a crash before its completion marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-links-partial-"));
  await writeFile(join(root, "target.md"), "# Target");
  await writeFile(join(root, "a.md"), "[Target](target.md)");
  await writeFile(join(root, "b.md"), "[Target](target.md)");
  const vault = new Vault(root),
    links = new Links(vault),
    plan = await links.plan("target.md", "renamed.md");
  await vault.putLinkJournal(plan, true);
  await vault.rename(plan.source, plan.target);
  const first = plan.files[0];
  await vault.write(first.newPath, first.content, first.hash);
  await new Links(new Vault(root)).apply(plan.id);
  expect(await readFile(join(root, "a.md"), "utf8")).toBe("[Target](renamed.md)");
  expect(await readFile(join(root, "b.md"), "utf8")).toBe("[Target](renamed.md)");
});
it("resumes when rewriting the moved note itself replaced its inode", async () => {
  const root = await mkdtemp(join(tmpdir(), "grove-moved-note-"));
  await mkdir(join(root, "moved"));
  await writeFile(join(root, "image.svg"), "<svg/>");
  await writeFile(join(root, "a.md"), "![image](image.svg)");
  await writeFile(join(root, "back.md"), "[A](a.md)");
  const vault = new Vault(root),
    plan = await new Links(vault).plan("a.md", "moved/a.md");
  await vault.putLinkJournal(plan, true);
  await vault.rename(plan.source, plan.target);
  const moved = plan.files.find((file) => file.path === "a.md")!;
  await vault.write(moved.newPath, moved.content, moved.hash, "Rename link update");
  expect((await vault.linkJournal())?.location).toBe("target");
  await new Links(new Vault(root)).apply(plan.id);
  expect(await readFile(join(root, "back.md"), "utf8")).toBe("[A](moved/a.md)");
  expect(await vault.linkJournal()).toBeNull();
});
