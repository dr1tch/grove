import { expect, it } from "vite-plus/test";
import type {
  Kind,
  Entry,
  Document,
  SaveResult,
  Version,
  Settings,
  AttachmentRef,
  LinkRef,
} from "@grove/core/types";
import { kindOf, languageOf } from "@grove/core/files";
import { fileIconSpec } from "@grove/core/file-icons";
import { entryPath, folderStyle, suggestedName } from "@grove/core/tree";
import { parseLinks, resolveLink } from "@grove/core/links";
import { formatMarkdown } from "@grove/core/markdown-format";
import { mermaidBlocks, vaultReference } from "@grove/core/vault-insert";
import { attachmentMarkdown } from "@grove/core/attachments";
import { conflictCopyName, MAX_SYNC_BYTES } from "@grove/core/conflicts";
import { kindOf as desktopKindOf } from "./files";
import { formatMarkdown as desktopFormat } from "./markdown-format";
import { conflictCopyName as desktopConflictName } from "../main/sync";

it("exposes platform-independent helpers through the public workspace exports", () => {
  const kind: Kind = kindOf("notes/Café.md");
  const entry: Entry = { path: "notes/Café.md", name: "Café.md", kind, size: 10, modified: 0 };
  const document: Document = { path: entry.path, content: "# Café", hash: "base", modified: 0 };
  const saved: SaveResult = { status: "saved", document };
  const version: Version = { ...document, id: "1", at: 0, author: "phone" };
  const settings: Settings = {
    theme: "system",
    accent: "green",
    font: "serif",
    fontSize: 16,
    readingWidth: 720,
  };
  const attachment: AttachmentRef = { path: "assets/chart.png", kind: "image", copied: false };
  const links: LinkRef[] = parseLinks(entry.path, "[Chart](../assets/chart.png)", [
    attachment.path,
  ]);
  expect([saved.status, version.author, settings.theme, languageOf("app.ts")]).toEqual([
    "saved",
    "phone",
    "system",
    "typescript",
  ]);
  expect(fileIconSpec("app.ts").mark).toBe("TS");
  expect(folderStyle("notes")).toBe("notes");
  expect(entryPath("notes", "New", "file")).toBe("notes/New.md");
  expect(suggestedName([], "notes", "file")).toBe("Untitled.md");
  expect(resolveLink(entry.path, "../assets/chart.png", [attachment.path])?.path).toBe(
    attachment.path,
  );
  expect(links[0]?.targetPath).toBe(attachment.path);
  expect(formatMarkdown("hello", 0, 5, "bold").changes).toEqual([
    { from: 0, to: 5, insert: "**hello**" },
  ]);
  expect(attachmentMarkdown(entry.path, attachment)).toContain("../assets/chart.png");
  expect(vaultReference(attachment.path, true)).toBe("![chart.png](</assets/chart.png>)");
  expect(mermaidBlocks("```mermaid\nflowchart LR\n A --> B\n```")).toHaveLength(1);
  expect(
    conflictCopyName(entry.path, "phone", new Date(2026, 10, 12), (path) =>
      path.endsWith("2026-11-12).md"),
    ),
  ).toBe("notes/Café (conflict phone 2026-11-12) 2.md");
  expect(MAX_SYNC_BYTES).toBe(50 * 1024 * 1024);
});

it("keeps desktop compatibility imports on the same implementation", () => {
  expect(desktopKindOf).toBe(kindOf);
  expect(desktopFormat).toBe(formatMarkdown);
  expect(desktopConflictName).toBe(conflictCopyName);
});
