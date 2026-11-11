import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join, basename, extname } from "node:path";
import type { Vault } from "./vault";
const exec = promisify(execFile);
const pending = new Map<string, Promise<string>>();
export async function officePDF(vault: Vault, source: string, cache: string): Promise<string> {
  const info = await vault.info(source);
  const key = createHash("sha256")
    .update(`${vault.root}:${source}:${info.modified}:${info.size}`)
    .digest("hex");
  const folder = join(cache, key);
  const target = join(folder, basename(source, extname(source)) + ".pdf");
  const active = pending.get(target);
  if (active) return active;
  const convert = async () => {
    try {
      await stat(target);
      return target;
    } catch {}
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const profile = await mkdtemp(join(folder, "profile-"));
    const input = join(folder, basename(source));
    const child = vault.stream(source);
    const finished = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error("Could not read Office file")),
      );
    });
    await Promise.all([
      pipeline(child.stdout, createWriteStream(input, { mode: 0o600 })),
      finished,
    ]);
    try {
      // Converter gets a copy, a private profile and no network or real home directory.
      await exec(
        "/usr/bin/bwrap",
        [
          "--die-with-parent",
          "--unshare-net",
          "--unshare-pid",
          "--ro-bind",
          "/usr",
          "/usr",
          "--ro-bind",
          "/lib",
          "/lib",
          "--ro-bind",
          "/lib64",
          "/lib64",
          "--symlink",
          "usr/bin",
          "/bin",
          "--ro-bind",
          "/etc",
          "/etc",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--tmpfs",
          "/tmp",
          "--dir",
          "/home/folio",
          "--setenv",
          "HOME",
          "/home/folio",
          "--bind",
          folder,
          "/work",
          "--chdir",
          "/work",
          "/usr/bin/libreoffice",
          `-env:UserInstallation=file:///work/${basename(profile)}`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          "/work",
          `/work/${basename(input)}`,
        ],
        { timeout: 60000, maxBuffer: 100000 },
      );
      await stat(target);
      return target;
    } catch {
      throw new Error(
        "Office preview could not be generated. LibreOffice Writer, Calc and Impress plus Bubblewrap are required. You can open the original externally.",
      );
    }
  };
  const result = convert();
  pending.set(target, result);
  try {
    return await result;
  } finally {
    pending.delete(target);
  }
}
