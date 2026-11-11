import { lstat, mkdtemp, open, rename, link, unlink, rm, realpath } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
export async function destinationIdentity(path: string) {
  try {
    const info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Choose a regular file destination");
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function publishOutput(
  path: string,
  bytes: Uint8Array,
  expected: string | null,
): Promise<{ backup?: string }> {
  const folder = await realpath(dirname(path)),
    target = join(folder, basename(path)),
    temporary = await mkdtemp(join(folder, ".grove-export-")),
    file = join(temporary, "output");
  let backup: string | undefined;
  try {
    const output = await open(file, "wx", 0o600);
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    if ((await destinationIdentity(target)) !== expected)
      throw new Error("Destination changed while exporting. Choose another filename.");
    if (expected) {
      backup = target + ".before-export-" + randomUUID();
      await rename(target, backup);
      const moved = await destinationIdentity(backup);
      if (moved?.split(":").slice(0, -1).join(":") !== expected.split(":").slice(0, -1).join(":")) {
        try {
          await link(backup, target);
        } catch {}
        throw new Error(`Destination changed. Its bytes are kept at ${backup}`);
      }
    }
    try {
      await link(file, target);
    } catch (error) {
      if (backup) {
        try {
          await link(backup, target);
        } catch {}
      }
      throw new Error(
        `Could not publish export: ${String(error)}${backup ? `. Previous bytes are kept at ${backup}` : ""}`,
      );
    }
    await unlink(file);
    return { backup };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
