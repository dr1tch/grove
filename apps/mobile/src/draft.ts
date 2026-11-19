import { filePath } from "@grove/github-vault/types";
import { vaultReference } from "@grove/core/vault-insert";

export type NoteState = {
  id: string;
  path: string;
  value: string;
  saved: string;
  hash: string;
  draft: boolean;
};
export function proposedName(value: string): string {
  const title = value.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? "Untitled";
  return (
    (title
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, " ")
      .trim()
      .slice(0, 100) || "Untitled") + ".md"
  );
}
export function noteDestination(name: string, folder: string): string {
  const clean = name.trim();
  if (!clean || /[\\/\p{Cc}]/u.test(clean)) throw new Error("Enter a file name without slashes.");
  const path =
    (folder ? folder + "/" : "") + (clean.toLowerCase().endsWith(".md") ? clean : clean + ".md");
  return filePath(path);
}
export function insertReference(path: string, embed: boolean) {
  // Root references survive the first save into any folder.
  return vaultReference(path, embed);
}
export function recoveryNote(value: unknown): NoteState | undefined {
  if (!value || typeof value !== "object") return;
  const note = value as Partial<NoteState>;
  if (
    typeof note.id !== "string" ||
    typeof note.path !== "string" ||
    typeof note.value !== "string" ||
    typeof note.saved !== "string" ||
    typeof note.hash !== "string" ||
    typeof note.draft !== "boolean"
  )
    return;
  if (!note.draft) {
    try {
      filePath(note.path);
    } catch {
      return;
    }
  }
  return note as NoteState;
}
