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
export type TrashItem = Version & { deleted: number; directory?: boolean };
export type Settings = {
  theme: "light" | "dark" | "system";
  accent: string;
  font: "serif" | "sans" | "mono" | "local";
  localFont?: string;
  fontSize: number;
  readingWidth: number;
};
export type TabState = {
  path: string;
  mode: "edit" | "preview" | "split";
  pinned?: boolean;
  preview?: boolean;
  scroll?: number;
};
export type AppState = {
  vault?: string;
  tabs?: TabState[];
  active?: string;
  settings?: Settings;
  sidebar?: boolean;
  sidebarWidth?: number;
  assistant?: boolean;
  bounds?: { width: number; height: number; x?: number; y?: number };
  maximized?: boolean;
  sync?: Record<string, { enabled: boolean }>;
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
export type SyncConnectRequest = { url?: string; createName?: string; confirmDirty?: boolean };
export type ViewState = {
  mode: TabState["mode"];
  selection?: { anchor: number; head: number };
  editorScroll?: number;
  previewScroll?: number;
  page?: number;
  find?: { id: string; query: string; from: number; to: number; page?: number };
  media?: { fit: boolean; scale: number; scrollLeft: number; scrollTop: number };
};
export type PaneState = {
  id: string;
  tabs: string[];
  active: string;
  views: Record<string, ViewState>;
};
export type WorkspaceLayout = { panes: PaneState[]; activePaneId: string; splitRatio: number };
export type WorkspacePreset = {
  id: string;
  name: string;
  vaultRoot: string;
  layout: WorkspaceLayout;
  tabs: TabState[];
  expandedFolders: string[];
  sidebar: boolean;
  sidebarWidth: number;
  assistant: boolean;
};
export type ExportRequest = {
  path: string;
  content: string;
  format: "html" | "pdf";
  theme: "light" | "dark";
};
export type ExportInfo = ExportRequest & { id: string; document: Document };
export type PreparedExport = {
  id: string;
  size: number;
  warnings: string[];
  format: "html" | "pdf";
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type AttachmentRef = { path: string; kind: Kind; copied: boolean };
export type AttachmentResult = {
  attachments: AttachmentRef[];
  failures: { name: string; error: string }[];
};
export type SearchHit = {
  path: string;
  sourceHash: string;
  page?: number;
  line?: number;
  from: number;
  to: number;
  snippet: string;
  unsaved?: boolean;
};
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
export type RenamePlan = {
  id: string;
  source: string;
  target: string;
  files: {
    path: string;
    newPath: string;
    hash: string;
    content: string;
    original: string;
    done?: boolean;
  }[];
  identity?: number[];
  renamed?: boolean;
};
export type SearchBatch = {
  id: string;
  root: string;
  hits: SearchHit[];
  errors: { path: string; error: string }[];
  done?: boolean;
  truncated?: boolean;
};
export type PreviewInfo = { url: string; image?: string; theme: "light" | "dark"; accent: string };
export type AgentReply = {
  text: string;
  proposals: {
    verb: "create" | "update" | "delete";
    path: string;
    content?: string;
    reason?: string;
    baseHash?: string;
  }[];
};
export interface FolioAPI {
  prepareExport(request: ExportRequest, vaultRoot: string): Promise<PreparedExport>;
  finishExport(
    id: string,
    allowOmissions: boolean,
    vaultRoot: string,
  ): Promise<{ saved: boolean; backup?: string }>;
  cancelExport(id: string, vaultRoot: string): Promise<void>;
  exportInfo(): Promise<ExportInfo>;
  exportReady(html: string, warnings: string[]): Promise<void>;
  htmlPreview(
    path: string,
    source: string,
    vaultRoot: string,
  ): Promise<{ url: string; warnings: string[] }>;
  revokeHtmlPreview(url: string, vaultRoot: string): Promise<void>;
  linksFor(
    path: string,
    vaultRoot: string,
  ): Promise<{ incoming: LinkRef[]; outgoing: LinkRef[]; broken: LinkRef[] }>;
  planRenameLinks(path: string, target: string, vaultRoot: string): Promise<RenamePlan>;
  applyRenamePlan(id: string, vaultRoot: string): Promise<void>;
  linkRenameRecovery(vaultRoot: string): Promise<RenamePlan | null>;
  startSearch(
    id: string,
    query: string,
    path: string | undefined,
    vaultRoot: string,
  ): Promise<void>;
  cancelSearch(id: string, vaultRoot: string): Promise<void>;
  validateSearchHit(hit: SearchHit, vaultRoot: string): Promise<boolean>;
  onSearch(callback: (batch: SearchBatch) => void): () => void;
  importDropped(notePath: string, stamp: number, vaultRoot: string): Promise<AttachmentResult>;
  pasteScreenshot(notePath: string, stamp: number, vaultRoot: string): Promise<AttachmentResult>;
  chooseAttachments(notePath: string, vaultRoot: string): Promise<AttachmentResult>;
  state(): Promise<AppState>;
  persist(state: Partial<AppState>): Promise<void>;
  openFolder(): Promise<{ root: string; entries: Entry[] } | null>;
  list(): Promise<{ root: string; entries: Entry[] } | null>;
  fonts(): Promise<string[]>;
  copyText(text: string): Promise<void>;
  mkdir(path: string, vaultRoot: string): Promise<void>;
  rename(path: string, newPath: string, vaultRoot: string): Promise<void>;
  trashEntry(path: string, vaultRoot: string): Promise<void>;
  read(path: string): Promise<Document>;
  write(path: string, content: string, hash: string, vaultRoot: string): Promise<SaveResult>;
  create(path: string, content: string, vaultRoot: string): Promise<Document>;
  checkpoint(path: string, content: string, vaultRoot: string): Promise<void>;
  versions(path: string): Promise<Version[]>;
  restore(path: string, id: string, hash: string, vaultRoot: string): Promise<SaveResult>;
  trash(path: string, hash: string, vaultRoot: string): Promise<void>;
  trashList(): Promise<TrashItem[]>;
  undelete(
    id: string,
    vaultRoot: string,
  ): Promise<Document | { path: string; directory: boolean; size: number }>;
  asset(path: string): Promise<string>;
  inspect(path: string): Promise<Entry>;
  openPreview(path: string, vaultRoot: string): Promise<void>;
  previewInfo(): Promise<PreviewInfo>;
  closePreview(): Promise<void>;
  external(path: string, reveal?: boolean): Promise<void>;
  saveCopy(content: string): Promise<boolean>;
  window(action: "minimize" | "maximize" | "close" | "close-now" | "fullscreen"): Promise<void>;
  draftsPending(pending: boolean): Promise<void>;
  agent(
    provider: "claude" | "codex",
    prompt: string,
    paths: string[],
    vaultRoot: string,
  ): Promise<AgentReply>;
  syncStatus(vaultRoot: string): Promise<SyncStatus>;
  syncConnect(
    request: SyncConnectRequest,
    vaultRoot: string,
  ): Promise<SyncStatus | { needsConfirm: number }>;
  syncNow(vaultRoot: string): Promise<SyncStatus>;
  syncDisable(vaultRoot: string): Promise<SyncStatus>;
  onSync(cb: (status: SyncStatus) => void): () => void;
  onChange(cb: (path: string) => void): () => void;
  onOpen(cb: (path: string) => void): () => void;
  onCloseRequest(cb: () => void): () => void;
}
export { kindOf } from "./files";

declare global {
  interface Window {
    folio: FolioAPI;
  }
}
