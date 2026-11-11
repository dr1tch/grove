import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import {
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  rm,
  readdir,
  stat,
  rename,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./vault";
let root: string;
let vault: Vault;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "folio-test-"));
  vault = new Vault(root);
  await writeFile(join(root, "note.md"), "original");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("vault boundaries and recovery", () => {
  it("detects PDF content behind a different extension without changing text decoding", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xe2]);
    await writeFile(join(root, "receipt.xhtml"), bytes);
    await writeFile(join(root, "real.xhtml"), "<html>Actual XHTML</html>");
    expect((await vault.info("receipt.xhtml")).mime).toBe("application/pdf");
    expect((await vault.info("real.xhtml")).mime).toBe("application/xhtml+xml");
    await expect(vault.read("receipt.xhtml")).rejects.toThrow();
    expect((await vault.read("real.xhtml")).content).toBe("<html>Actual XHTML</html>");
    expect(await readFile(join(root, "receipt.xhtml"))).toEqual(bytes);
    await symlink("/etc/passwd", join(root, "escape.xhtml"));
    await expect(vault.info("escape.xhtml")).rejects.toThrow();
  });
  it("rejects traversal and internal metadata", async () => {
    await expect(vault.read("../secret")).rejects.toThrow();
    await expect(vault.create(".folio/x", "x")).rejects.toThrow();
  });
  it("rejects symlinks leaving the vault", async () => {
    await symlink("/etc/passwd", join(root, "escape.md"));
    await expect(vault.read("escape.md")).rejects.toThrow();
  });
  it("preserves external changes on a stale save", async () => {
    const doc = await vault.read("note.md");
    await writeFile(join(root, "note.md"), "external");
    expect((await vault.write("note.md", "mine", doc.hash)).status).toBe("conflict");
    expect(await readFile(join(root, "note.md"), "utf8")).toBe("external");
  });
  it("serializes simultaneous writes against the same base", async () => {
    const doc = await vault.read("note.md");
    const results = await Promise.all([
      vault.write("note.md", "one", doc.hash),
      vault.write("note.md", "two", doc.hash),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "saved"]);
  });
  it("never replaces an existing file on create", async () => {
    await expect(vault.create("note.md", "replacement")).rejects.toThrow();
    expect((await vault.read("note.md")).content).toBe("original");
  });
  it("keeps versions and restores through conflict checks", async () => {
    const first = await vault.read("note.md");
    const result = await vault.write("note.md", "edited", first.hash);
    expect(result.status).toBe("saved");
    const history = await vault.versions("note.md");
    expect(history.some((v) => v.content === "original")).toBe(true);
    const old = history.find((v) => v.content === "original")!;
    const now = await vault.read("note.md");
    await vault.restore("note.md", old.id, now.hash);
    expect((await vault.read("note.md")).content).toBe("original");
  });
  it("restores trash without overwriting a newly created file", async () => {
    const doc = await vault.read("note.md");
    await vault.trash("note.md", doc.hash);
    const [item] = await vault.trashList();
    await vault.create("note.md", "new");
    await expect(vault.undelete(item.id)).rejects.toThrow();
    expect((await vault.read("note.md")).content).toBe("new");
    expect((await vault.trashList()).length).toBe(1);
  });
});
it("keeps unsaved drafts as restorable versions before discarding", async () => {
  await vault.checkpoint("note.md", "unsaved work");
  const versions = await vault.versions("note.md");
  expect(versions.some((v) => v.content === "unsaved work")).toBe(true);
  expect((await vault.read("note.md")).content).toBe("original");
});
it("records both sides of an observed external change", async () => {
  await vault.read("note.md");
  await writeFile(join(root, "note.md"), "external");
  await vault.observe("note.md");
  const versions = await vault.versions("note.md");
  expect(versions.map((v) => v.content).sort()).toEqual(["external", "original"]);
});
it("rejects invalid UTF-8 without changing the original bytes", async () => {
  await writeFile(join(root, "latin.md"), Buffer.from([99, 97, 102, 233]));
  await expect(vault.read("latin.md")).rejects.toThrow();
  expect(await readFile(join(root, "latin.md"))).toEqual(Buffer.from([99, 97, 102, 233]));
});
it("restores the actual trashed bytes rather than a stale metadata copy", async () => {
  const original = await vault.read("note.md");
  await vault.trash("note.md", original.hash);
  const [item] = await vault.trashList();
  await writeFile(join(root, ".trash", item.id + ".data"), "newer bytes");
  const restored = await vault.undelete(item.id);
  expect(restored.content).toBe("newer bytes");
});
it("rejects parent symlink escapes", async () => {
  await symlink("/etc", join(root, "outside"));
  await expect(vault.read("outside/passwd")).rejects.toThrow();
});

describe("vault folders and binary entries", () => {
  it("creates and lists empty directories, including nested folders", async () => {
    await vault.mkdir("empty");
    await vault.mkdir("projects/drafts");
    expect(
      (await vault.list())
        .filter((entry) => String(entry.kind) === "folder")
        .map((entry) => entry.path),
    ).toEqual(["empty", "projects", "projects/drafts"]);
    await expect(vault.mkdir("empty")).rejects.toThrow();
    await expect(vault.mkdir("note.md")).rejects.toThrow();
  });
  it("renames files and nested folders without overwriting collisions", async () => {
    await vault.mkdir("projects/drafts");
    await vault.create("projects/drafts/one.md", "one");
    await vault.rename("projects/drafts", "projects/notes");
    expect((await vault.read("projects/notes/one.md")).content).toBe("one");
    await vault.rename("projects/notes/one.md", "projects/notes/two.md");
    await expect(vault.rename("note.md", "projects/notes/two.md")).rejects.toThrow();
    await expect(vault.rename("projects", "projects/notes/inside")).rejects.toThrow();
    await expect(vault.rename("projects", "projects")).rejects.toThrow();
    await vault.mkdir("occupied");
    await expect(vault.rename("projects", "occupied")).rejects.toThrow();
    expect((await vault.read("note.md")).content).toBe("original");
    expect((await vault.read("projects/notes/two.md")).content).toBe("one");
  });
  it("moves whole folders to trash and restores actual nested data", async () => {
    await vault.mkdir("projects/empty");
    await vault.create("projects/note.md", "nested");
    await vault.trashEntry("projects");
    expect((await vault.list()).map((entry) => entry.path)).toEqual(["note.md"]);
    const [item] = await vault.trashList();
    expect(item).toMatchObject({ path: "projects", directory: true });
    expect(item).not.toHaveProperty("content");
    await writeFile(join(root, ".trash", item.id + ".data", "note.md"), "new bytes");
    await vault.mkdir("projects");
    await expect(vault.undelete(item.id)).rejects.toThrow();
    await vault.rename("projects", "other");
    expect(await vault.undelete(item.id)).toMatchObject({
      path: "projects",
      directory: true,
    });
    expect((await vault.read("projects/note.md")).content).toBe("new bytes");
    expect((await vault.list()).find((entry) => entry.path === "projects/empty")).toBeDefined();
    expect(await vault.trashList()).toEqual([]);
  });
  it("trashes and restores binary bytes without text decoding", async () => {
    const bytes = Buffer.from([0, 255, 128, 1]);
    await writeFile(join(root, "image.bin"), bytes);
    await vault.trashEntry("image.bin");
    const [item] = await vault.trashList();
    expect(item).toMatchObject({
      path: "image.bin",
      directory: false,
      size: bytes.length,
    });
    expect(item).not.toHaveProperty("content");
    await vault.undelete(item.id);
    expect(await readFile(join(root, "image.bin"))).toEqual(bytes);
  });
  it("keeps text trash compatible and refuses stale legacy deletion", async () => {
    const doc = await vault.read("note.md");
    await writeFile(join(root, "note.md"), "changed");
    await expect(vault.trash("note.md", doc.hash)).rejects.toThrow();
    await vault.trashEntry("note.md");
    expect((await vault.trashList())[0]).toMatchObject({
      content: "changed",
      directory: false,
    });
  });
  it("validates both rename paths and rejects symlinks for every operation", async () => {
    await symlink("/etc", join(root, "escape"));
    await symlink("note.md", join(root, "linked.md"));
    for (const path of [
      "../outside",
      ".trash/x",
      "a/../b",
      "a//b",
      "a/",
      "a\\b",
      "/absolute",
      "",
    ]) {
      await expect(vault.mkdir(path)).rejects.toThrow();
      await expect(vault.rename(path, "target")).rejects.toThrow();
      await expect(vault.rename("note.md", path)).rejects.toThrow();
      await expect(vault.trashEntry(path)).rejects.toThrow();
    }
    await expect(vault.mkdir("escape/new")).rejects.toThrow();
    await expect(vault.rename("note.md", "escape/new")).rejects.toThrow();
    await expect(vault.rename("linked.md", "moved.md")).rejects.toThrow();
    await expect(vault.trashEntry("linked.md")).rejects.toThrow();
    await expect(vault.trashEntry("escape")).rejects.toThrow();
    expect((await vault.read("note.md")).content).toBe("original");
  });
  it("serializes folder operations with file creation and recovery", async () => {
    await Promise.all([
      vault.mkdir("queue"),
      vault.create("queue/file.md", "queued"),
      vault.rename("queue", "renamed"),
      vault.trashEntry("renamed"),
    ]);
    const [item] = await vault.trashList();
    await vault.undelete(item.id);
    expect((await vault.read("renamed/file.md")).content).toBe("queued");
  });
});

describe("rename history migration", () => {
  it("moves file versions and isolates a reused old name", async () => {
    const first = await vault.read("note.md");
    await vault.write("note.md", "edited", first.hash);
    const before = await vault.versions("note.md");
    await vault.rename("note.md", "renamed.md");
    expect((await vault.versions("renamed.md")).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before
        .map((version) => ({ ...version, path: "renamed.md" }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await vault.versions("note.md")).toEqual([]);
    await vault.create("note.md", "new file");
    expect((await vault.versions("note.md")).map((v) => v.content)).toEqual(["new file"]);
    const old = (await vault.versions("renamed.md")).find((v) => v.content === "original")!;
    await vault.restore("renamed.md", old.id, (await vault.read("renamed.md")).hash);
    expect((await vault.read("renamed.md")).content).toBe("original");
  });

  it("moves every descendant history without matching sibling prefixes", async () => {
    await vault.create("folder/deep/a.md", "a");
    await vault.checkpoint("folder/deep/a.md", "draft");
    await vault.create("folder/b.md", "b");
    await vault.create("folder-other/c.md", "c");
    await vault.rename("folder", "moved");
    expect((await vault.versions("moved/deep/a.md")).map((v) => v.content).sort()).toEqual([
      "a",
      "draft",
    ]);
    expect((await vault.versions("moved/b.md"))[0].content).toBe("b");
    expect((await vault.versions("folder-other/c.md"))[0].content).toBe("c");
    await vault.create("folder/deep/a.md", "replacement");
    expect((await vault.versions("folder/deep/a.md")).map((v) => v.content)).toEqual([
      "replacement",
    ]);
  });

  it("leaves both histories unchanged on file and folder collisions", async () => {
    await vault.create("source/a.md", "source");
    await vault.create("target/a.md", "target");
    const source = await vault.versions("source/a.md");
    const target = await vault.versions("target/a.md");
    await expect(vault.rename("source/a.md", "target/a.md")).rejects.toThrow();
    expect(await vault.versions("source/a.md")).toEqual(source);
    expect(await vault.versions("target/a.md")).toEqual(target);
    await expect(vault.rename("source", "target")).rejects.toThrow();
    expect(await vault.versions("source/a.md")).toEqual(source);
    expect(await vault.versions("target/a.md")).toEqual(target);
  });

  it("retains payloads and the journal on recovery failure, then retries safely", async () => {
    await vault.checkpoint("note.md", "original snapshot");
    const [version] = await vault.versions("note.md");
    const info = await stat(join(root, "note.md"));
    const history = join(root, ".folio/history");
    const metadata = join(history, version.id + ".json");
    const item = JSON.parse(await readFile(metadata, "utf8"));
    item.path = "renamed.md";
    // Simulate interruption after the filesystem move, before metadata replacement.
    await writeFile(
      join(root, ".folio/rename.json"),
      JSON.stringify({
        source: "note.md",
        target: "renamed.md",
        identity: [info.dev, info.ino],
        entries: [item],
      }),
    );
    await rename(join(root, "note.md"), join(root, "renamed.md"));
    await rm(metadata);
    await mkdir(metadata);
    await expect(vault.create("note.md", "new file")).rejects.toThrow();
    expect(await readFile(join(history, version.id + ".data"), "utf8")).toBe("original snapshot");
    expect(JSON.parse(await readFile(join(root, ".folio/rename.json"), "utf8")).entries).toEqual([
      item,
    ]);
    await rm(metadata, { recursive: true });
    const reopened = new Vault(root);
    await reopened.create("note.md", "new file");
    expect((await reopened.versions("renamed.md"))[0]).toMatchObject({
      id: version.id,
      content: "original snapshot",
    });
    expect((await reopened.versions("note.md")).map((v) => v.content)).toEqual(["new file"]);
    expect(await readdir(join(root, ".folio"))).not.toContain("rename.json");
    expect((await readdir(history)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});

it("serializes queued checkpoints and version reads with rename", async () => {
  const checkpoint = vault.checkpoint("note.md", "watcher snapshot");
  const moved = vault.rename("note.md", "moved.md");
  const versions = vault.versions("moved.md");
  await Promise.all([checkpoint, moved]);
  const history = await versions;
  expect(history.map((v) => v.content)).toEqual(["watcher snapshot"]);
  expect(await vault.versions("note.md")).toEqual([]);
  await vault.restore("moved.md", history[0].id, (await vault.read("moved.md")).hash);
  expect((await vault.read("moved.md")).content).toBe("watcher snapshot");
});
it("reading an unopened folder does not create private metadata", async () => {
  await vault.list();
  await vault.read("note.md");
  expect(await readdir(root)).not.toContain(".folio");
});
