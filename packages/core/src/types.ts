export type Kind =
  | "folder"
  | "markdown"
  | "drawing"
  | "text"
  | "pdf"
  | "image"
  | "office"
  | "audio"
  | "video"
  | "unsupported";
export type Entry = { path: string; name: string; kind: Kind; size: number; modified: number };
export type Document = { path: string; content: string; hash: string; modified: number };
export type SaveResult =
  | { status: "saved"; document: Document }
  | { status: "conflict"; disk: Document };
export type Version = { id: string; path: string; content: string; at: number; author: string };
export type Settings = {
  theme: "light" | "dark" | "system";
  accent: string;
  font: "serif" | "sans" | "mono" | "local";
  localFont?: string;
  fontSize: number;
  readingWidth: number;
};
export type AttachmentRef = { path: string; kind: Kind; copied: boolean };
export type LinkRef = {
  sourcePath: string;
  targetPath: string;
  from: number;
  to: number;
  raw: string;
  syntax: "markdown" | "wiki" | "definition";
  fragment: string;
  missing: boolean;
  ambiguous: boolean;
};

export type SyncState = "off" | "synced" | "syncing" | "offline" | "conflict" | "error";
export type SyncStatus = {
  state: SyncState;
  lastSync?: number;
  message?: string;
  remote?: string;
  branch?: string;
  conflicts: string[];
  skipped: string[];
};
