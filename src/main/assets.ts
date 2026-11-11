import type { Vault } from "./vault";
export async function assetBytes(
  vault: Vault,
  path: string,
  signal?: AbortSignal,
  maximum = 50 * 1024 * 1024,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const info = await vault.info(path);
  if (info.size > maximum)
    throw new Error(`File exceeds ${Math.round(maximum / 1024 / 1024)} MB search limit`);
  const child = vault.stream(path),
    chunks: Buffer[] = [];
  let size = 0,
    error = "";
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });
  child.stderr.on("data", (data) => {
    if (error.length < 2000) error += data;
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(error || "File read canceled")),
    );
  });
  try {
    await Promise.all([
      finished,
      (async () => {
        for await (const chunk of child.stdout) {
          size += chunk.length;
          if (size > maximum) {
            child.kill();
            throw new Error("File exceeds search limit");
          }
          chunks.push(chunk);
        }
      })(),
    ]);
    signal?.throwIfAborted();
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener("abort", abort);
    child.kill();
  }
}
