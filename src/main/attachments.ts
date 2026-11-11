import { basename, relative, isAbsolute } from "node:path";
import type { AttachmentResult } from "../shared/types";
import { kindOf } from "../shared/types";
import type { Vault } from "./vault";
export async function importAttachments(
  vault: Vault,
  notePath: string,
  sources: string[],
): Promise<AttachmentResult> {
  if (
    !Array.isArray(sources) ||
    sources.length > 100 ||
    sources.some((s) => typeof s !== "string" || !isAbsolute(s))
  )
    throw new Error("Invalid attachment selection");
  const result: AttachmentResult = { attachments: [], failures: [] };
  for (const source of sources) {
    try {
      const path = await vault.importAttachment(notePath, source);
      const info = await vault.info(path);
      result.attachments.push({
        path,
        kind: info.mime === "application/pdf" ? "pdf" : kindOf(path),
        copied: relative(vault.root, source) !== path,
      });
    } catch (error) {
      result.failures.push({ name: basename(source), error: String(error) });
    }
  }
  return result;
}
