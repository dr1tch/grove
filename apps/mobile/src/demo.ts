import type { Document, SaveResult } from "@grove/core/types";
import { kindOf } from "@grove/core/files";
import type { RemoteStore } from "@grove/github-vault/remote";
import { GitHubError, filePath } from "@grove/github-vault/types";
import { loadLocal, saveLocal } from "./local";
import { randomUUID } from "expo-crypto";

const initial: Record<string, string> = {
  "Projects/Local-first sync.md":
    "# Local-first sync\n\nYour notes stay files. Everything else is help.\n\n## Three promises\n\n- [ ] Plain files, opened in place\n- [x] Agents propose, you decide\n- [ ] Drawings stay editable\n\n## How it works\n\nEvery edit is saved on your device before syncing.\n\n```mermaid\nflowchart LR\n Editor --> Device\n Device --> GitHub\n```\n\nThis is a **sample vault**. Changes stay on this device.\n",
  "Projects/Meeting notes.md":
    "# Meeting notes\n\n## Next steps\n\n- Review the phone app\n- Write a note\n- Try the formatting toolbar\n\n| Item | Status |\n| --- | --- |\n| Native shell | Ready to try |\n| Private files | Never used in this sample |\n",
  "Reading/Welcome.md":
    "# A quieter place to think\n\nOpen a note, start writing, and keep your thoughts in Markdown.\n\nThe sample vault lives only on this device. Connect your own repository from Settings when you are ready.\n",
  "Code/example.ts": "export const greeting = 'Hello from Grove';\n",
};
const missing = () => new GitHubError("not-found", "This sample file is unavailable.");
class SampleStore implements RemoteStore {
  readonly root = "sample:grove";
  readonly device = "Phone sample";
  #writes: Promise<unknown> = Promise.resolve();
  constructor(private files: Record<string, Document>) {}
  dispose() {}
  async head() {
    return "sample";
  }
  async list() {
    const folders = new Set<string>();
    for (const path of Object.keys(this.files)) {
      const parts = path.split("/");
      for (let n = 1; n < parts.length; n++) folders.add(parts.slice(0, n).join("/"));
    }
    return [
      ...Object.values(this.files).map((doc) => ({
        path: doc.path,
        name: doc.path.split("/").pop()!,
        sha: doc.hash,
        kind: kindOf(doc.path),
        size: new TextEncoder().encode(doc.content).length,
        modified: doc.modified,
      })),
      ...[...folders].map((path) => ({
        path,
        name: path.split("/").pop()!,
        sha: "",
        kind: "folder" as const,
        size: 0,
        modified: 0,
      })),
    ];
  }
  async read(path: string) {
    filePath(path);
    if (!this.files[path]) throw missing();
    return { ...this.files[path] };
  }
  async readAsset(_path: string): Promise<{ hash: string; bytes: Uint8Array }> {
    throw missing();
  }
  async write(path: string, content: string, baseHash: string): Promise<SaveResult> {
    filePath(path);
    const operation = this.#writes.then(async (): Promise<SaveResult> => {
      const before = this.files[path];
      if ((before?.hash ?? "") !== baseHash)
        return {
          status: "conflict",
          disk: before ? { ...before } : { path, content: "", hash: "", modified: 0 },
        };
      const document = { path, content, hash: `sample:${randomUUID()}`, modified: Date.now() };
      const next = { ...this.files, [path]: document };
      await saveLocal("sample-files", next);
      this.files = next;
      return { status: "saved", document };
    });
    this.#writes = operation.catch(() => {});
    return operation;
  }
  async create(path: string, content: string) {
    const result = await this.write(path, content, "");
    if (result.status === "conflict")
      throw new GitHubError("conflict", "A file already uses this name.");
    return result.document;
  }
  async createBytes(): Promise<void> {
    throw new Error("The sample vault accepts text files.");
  }
  async remove(): Promise<void> {
    throw new Error("Deleting sample files is unavailable.");
  }
  async rename(): Promise<void> {
    throw new Error("Renaming sample files is unavailable.");
  }
  async mkdir(): Promise<void> {
    throw new Error("Folders are created when a note is saved inside them.");
  }
  async versions() {
    return [];
  }
}
export async function sampleStore(): Promise<RemoteStore> {
  let files = await loadLocal<Record<string, Document>>("sample-files");
  if (!files) {
    files = Object.fromEntries(
      Object.entries(initial).map(([path, content]) => [
        path,
        { path, content, hash: `sample:${randomUUID()}`, modified: 0 },
      ]),
    );
    await saveLocal("sample-files", files);
  }
  return new SampleStore(files);
}
