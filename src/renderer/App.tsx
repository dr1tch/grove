import { useCallback, useEffect, useRef, useState } from "react";
import {
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  Sun,
  Moon,
  Ellipsis,
  Sparkles,
  Minus,
  Square,
  X,
  Search,
  FileText,
  Shapes,
  Trash2,
  SlidersHorizontal,
  ChevronsUpDown,
  ExternalLink,
  History,
  Pin,
  Check,
  FolderOpen,
  Folder,
  Pencil,
  ArrowUp,
  AtSign,
  RotateCcw,
  Columns2,
  Link2,
} from "lucide-react";
import {
  kindOf,
  type Document,
  type Entry,
  type Settings,
  type TabState,
  type TrashItem,
  type Version,
} from "../shared/types";
import { DocumentPane } from "./DocumentPane";
import { QuickSwitcher } from "./QuickSwitcher";
import { SearchPanel } from "./SearchPanel";
import { Backlinks } from "./Backlinks";
import { RecoveryDialog } from "./RecoveryDialog";
import { Workspaces } from "./Workspaces";
import { ExportDialog } from "./ExportDialog";
import { cleanPresets, migratePresets } from "../shared/workspaces";
import type { WorkspacePreset } from "../shared/types";
import type { RenamePlan } from "../shared/types";
import type { SearchHit } from "../shared/types";
import { textMatches } from "../shared/search";
import { cleanLayout, pruneLayout, renameLayout } from "../shared/panes";
import { cleanState } from "../shared/state";
import type { AppState, WorkspaceLayout, ViewState } from "../shared/types";
import { conflictCopyPath, draftMoves } from "../shared/workspace";
import { Appearance } from "./Appearance";
import { SaveDraftDialog } from "./SaveDraftDialog";
import type { SyncStatus } from "../shared/types";
import { entryPath, suggestedName } from "../shared/tree";
import { Tooltip } from "./Tooltip";
import { FileIcon } from "./FileIcon";
import { GroveMark } from "./FolderIcon";
import type { TreeCreation } from "./FileTree";
import { FileTree } from "./FileTree";
import { Proposal } from "./Proposal";
import type { AgentReply } from "../shared/types";
import { recoverTab, type WorkingTab as Tab } from "../shared/recovery";

const defaults: Settings = {
  theme: "system",
  accent: "emerald",
  font: "serif",
  fontSize: 14,
  readingWidth: 680,
};
const editable = (path: string, kind = kindOf(path)) =>
  ["markdown", "text", "drawing", "unsupported"].includes(kind);
const name = (path: string) => path.split("/").pop()?.replace(/\.md$/, "") || path;
// A new note lives only in its tab until the user saves it; its name is its first heading.
const DRAFT = "draft://";
const isDraft = (path: string) => path.startsWith(DRAFT);
const draftTitle = (value: string) => value.match(/^#\s+(.+)$/m)?.[1].trim() || "Untitled";
const tabName = (t: { path: string; value: string }) =>
  isDraft(t.path) ? draftTitle(t.value) : name(t.path);
const savedTabs = (tabs: TabState[]) =>
  tabs
    .filter((t) => !isDraft(t.path))
    .map(({ path, mode, pinned, preview }) => ({ path, mode, pinned, preview }));
const savedLayout = (layout: WorkspaceLayout): WorkspaceLayout => ({
  ...layout,
  panes: layout.panes.map((p) => ({
    ...p,
    tabs: p.tabs.filter((t) => !isDraft(t)),
    active: isDraft(p.active) ? p.tabs.find((t) => !isDraft(t)) || "" : p.active,
  })),
});
function Icon({ path }: { path: string }) {
  return <FileIcon path={path} />;
}
function Button({
  label,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip text={label}>
      <button {...props} aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}
export function App() {
  const [root, setRoot] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [layout, setLayout] = useState<WorkspaceLayout>(() => cleanLayout(null));
  const activePane = layout.panes.find((p) => p.id === layout.activePaneId) || layout.panes[0];
  const active = activePane.active;
  const updateLayout = useCallback((update: (layout: WorkspaceLayout) => WorkspaceLayout) => {
    const next = update(live.current.layout);
    live.current.layout = next;
    setLayout(next);
  }, []);
  const setActive = useCallback(
    (value: string | ((path: string) => string), paneId?: string) => {
      updateLayout((current) => ({
        ...current,
        panes: current.panes.map((p) => {
          if (p.id !== (paneId || current.activePaneId)) return p;
          const path = typeof value === "function" ? value(p.active) : value;
          const doc = live.current.tabs.find((t) => t.path === path);
          return {
            ...p,
            active: path,
            tabs: path && !p.tabs.includes(path) ? [...p.tabs, path] : p.tabs,
            views:
              path && !p.views[path]
                ? { ...p.views, [path]: { mode: doc?.mode || "preview" } }
                : p.views,
          };
        }),
      }));
    },
    [updateLayout],
  );
  const updateView = useCallback(
    (paneId: string, path: string, view: Partial<ViewState>) => {
      updateLayout((current) => ({
        ...current,
        panes: current.panes.map((p) =>
          p.id === paneId && p.tabs.includes(path)
            ? {
                ...p,
                views: {
                  ...p.views,
                  [path]: { ...(p.views[path] || { mode: "preview" }), ...view },
                },
              }
            : p,
        ),
      }));
    },
    [updateLayout],
  );
  const [settings, setSettings] = useState(defaults);
  const [sidebar, setSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [contextMenu, setContextMenu] = useState<{
    root: string;
    path: string;
    directory: boolean;
    tab?: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [draftSave, setDraftSave] = useState<{
    path: string;
    closing: boolean;
    quitting?: boolean;
  } | null>(null);
  const quitting = useRef(false);
  const dirtyDraft = tabs.find((t) => isDraft(t.path) && t.value !== t.doc.content)?.path;
  useEffect(() => {
    void window.folio.draftsPending(!!dirtyDraft).catch(() => {});
  }, [dirtyDraft]);
  // Quitting with unsaved new notes asks about each one, then closes the window.
  useEffect(
    () =>
      window.folio.onCloseRequest(() => {
        const path = live.current.tabs.find(
          (t) => isDraft(t.path) && t.value !== t.doc.content,
        )?.path;
        if (!path) return void window.folio.window("close-now");
        quitting.current = true;
        setDraftSave({ path, closing: true, quitting: true });
      }),
    [],
  );
  useEffect(() => {
    if (draftSave || !quitting.current) return;
    if (dirtyDraft) setDraftSave({ path: dirtyDraft, closing: true, quitting: true });
    else {
      quitting.current = false;
      void window.folio.window("close-now");
    }
  }, [draftSave, dirtyDraft]);
  const [fileAction, setFileAction] = useState<{
    type: "rename";
    path: string;
    root: string;
  } | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [search, setSearch] = useState("");
  const [switcher, setSwitcher] = useState(false);
  const [contentSearch, setContentSearch] = useState<{ path?: string }>();
  const [recent, setRecent] = useState<string[]>([]);
  const recentVault = useRef("");
  const [dialog, setDialog] = useState<"settings" | "history" | "trash" | null>(null);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "sync">("appearance");
  const [syncOn, setSyncOn] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>();
  const [syncClock, setSyncClock] = useState(0);
  const [newName, setNewName] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [exportNote, setExportNote] = useState<{
    path: string;
    content: string;
    root: string;
  }>();
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExportNote(undefined);
    setWorkspacesOpen(false);
    setRecoveryPreview(undefined);
    setSwitcher(false);
    setContentSearch(undefined);
  }, [root]);
  const [renamePlan, setRenamePlan] = useState<RenamePlan>();
  const [updateLinks, setUpdateLinks] = useState(true);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameContext = useRef({ fileAction, newName });
  renameContext.current = { fileAction, newName };
  useEffect(() => setRenamePlan(undefined), [fileAction, newName, updateLinks]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [creation, setCreation] = useState<TreeCreation | null>(null);
  const [menu, setMenu] = useState(false);
  const [tabMenu, setTabMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [ready, setReady] = useState(false);
  const restoring = useRef("");
  const saves = useRef(new Set<string>());
  const [darkOS, setDarkOS] = useState(matchMedia("(prefers-color-scheme: dark)").matches);
  const [recoveryPreview, setRecoveryPreview] = useState<{
    root: string;
    expected: Tab;
    version?: Version;
  }>();
  const [selection, setSelection] = useState("");
  const [context, setContext] = useState<string[]>([]);
  const live = useRef({ tabs, active, root, layout });
  live.current = { tabs, active, root, layout };
  const closed = useRef<Tab[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const dark = settings.theme === "dark" || (settings.theme === "system" && darkOS);
  const currentDocument = tabs.find((t) => t.path === active);
  const tab = currentDocument
    ? { ...currentDocument, mode: activePane.views[active]?.mode || currentDocument.mode }
    : undefined;
  const originalEntry = entries.find((e) => e.path === active) || {
    path: active,
    name: active.split("/").pop() || "",
    kind: kindOf(active),
    size: 0,
    modified: Date.now(),
  };
  const entry: Entry = {
    ...originalEntry,
    kind: tab?.readError ? "unsupported" : tab?.asText ? "text" : tab?.kind || originalEntry.kind,
  };
  const notify = useCallback((message: string) => setToast(message), []);
  // Conflict copies are found by name, so they survive restarts: `<stem> (conflict <device> <date>[ N]).<ext>`.
  const conflictCopies = syncOn
    ? entries.filter(
        (e) =>
          e.kind !== "folder" &&
          /^.+ \(conflict .+ \d{4}-\d{2}-\d{2}(?: \d+)?\)(\.[^.]+)?$/.test(e.name),
      )
    : [];
  const activeConflict = (() => {
    if (!syncOn || !active) return undefined;
    const slash = active.lastIndexOf("/"),
      dir = slash < 0 ? "" : active.slice(0, slash + 1),
      base = active.slice(slash + 1),
      dot = base.lastIndexOf("."),
      stem = dot > 0 ? base.slice(0, dot) : base,
      ext = dot > 0 ? base.slice(dot) : "";
    const prefix = `${dir}${stem} (conflict `;
    return conflictCopies.find(
      (e) =>
        e.path.startsWith(prefix) &&
        e.path.endsWith(`)${ext}`) &&
        /^.+ \d{4}-\d{2}-\d{2}(?: \d+)?$/.test(e.path.slice(prefix.length, -(ext.length + 1))),
    );
  })();
  void syncClock;
  const syncText = (() => {
    if (!syncOn) return "";
    const state = syncStatus?.state;
    if (state === "syncing") return "Syncing…";
    if (state === "offline") return "Offline · changes saved locally";
    if (state === "error") return "Sync error";
    if (state === "conflict" || conflictCopies.length) {
      const n = conflictCopies.length || syncStatus?.conflicts.length || 1;
      return `Conflict · ${n} ${n === 1 ? "file" : "files"} kept both ways`;
    }
    if (!syncStatus?.lastSync) return "Syncing…";
    const minutes = Math.floor((Date.now() - syncStatus.lastSync) / 60_000);
    return minutes < 1
      ? "Synced just now"
      : minutes < 60
        ? `Synced ${minutes} min ago`
        : minutes < 1440
          ? `Synced ${Math.floor(minutes / 60)} h ago`
          : `Synced ${Math.floor(minutes / 1440)} d ago`;
  })();
  useEffect(() => {
    if (!root) return;
    let paths = recent;
    if (recentVault.current !== root) {
      recentVault.current = root;
      try {
        const saved = JSON.parse(localStorage.getItem(`folio:recent:${root}`) || "[]");
        paths = Array.isArray(saved) ? saved.filter((p): p is string => typeof p === "string") : [];
      } catch {
        paths = [];
      }
    }
    const next =
      active && !isDraft(active)
        ? [active, ...paths.filter((path) => path !== active)].slice(0, 100)
        : paths;
    setRecent(next);
    try {
      localStorage.setItem(`folio:recent:${root}`, JSON.stringify(next));
    } catch {}
  }, [root, active]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDarkOS(m.matches);
    m.addEventListener("change", listener);
    return () => m.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = dark ? "dark" : "light";
    html.dataset.accent = settings.accent;
    html.dataset.docfont = settings.font;
    html.style.setProperty("--reading-width", `${settings.readingWidth}px`);
    html.dataset.reading = settings.readingWidth === 0 ? "full" : "fixed";
    html.style.setProperty("--local-font", JSON.stringify(settings.localFont || "system-ui"));
  }, [dark, settings]);
  const loadSync = useCallback(async (vaultRoot: string) => {
    if (!vaultRoot) {
      setSyncOn(false);
      setSyncStatus(undefined);
      return;
    }
    try {
      const on = !!(await window.folio.state()).sync?.[vaultRoot]?.enabled;
      if (live.current.root !== vaultRoot) return;
      setSyncOn(on);
      setSyncStatus(on ? await window.folio.syncStatus(vaultRoot) : undefined);
    } catch {
      setSyncOn(false);
    }
  }, []);
  useEffect(() => {
    void loadSync(root);
  }, [root, loadSync]);
  useEffect(() => window.folio.onSync(setSyncStatus), []);
  useEffect(() => {
    const timer = setInterval(() => setSyncClock((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const refresh = useCallback(async () => {
    const vault = await window.folio.list();
    if (vault) {
      if (live.current.root && live.current.root !== vault.root) {
        restoring.current = vault.root;
        closed.current = [];
        setTabs([]);
        updateLayout(() => cleanLayout(null));
        live.current.tabs = [];
        live.current.active = "";
        setContextMenu(null);
        setCreation(null);
        setSelectedFolder("");
        setFileAction(null);
        setDialog(null);
        setMenu(false);
        setTabMenu(false);
      }
      live.current.root = vault.root;
      setRoot(vault.root);
      setEntries(vault.entries);
    }
    return vault;
  }, []);
  const loadTab = useCallback(async (path: string, state?: TabState): Promise<Tab> => {
    const origin = live.current.root;
    const inspected = await window.folio.inspect(path);
    if (live.current.root === origin)
      setEntries((entries) => entries.map((entry) => (entry.path === path ? inspected : entry)));
    const kind = inspected.kind;
    let doc: Document = { path, content: "", hash: "", modified: Date.now() };
    let readError: string | undefined;
    if (editable(path, kind)) {
      try {
        doc = await window.folio.read(path);
      } catch (e) {
        readError = String(e);
      }
    }
    const asText = kind === "unsupported" && !readError;
    let value = doc.content;
    let base = doc;
    try {
      const draft = JSON.parse(
        localStorage.getItem(`folio:draft:${live.current.root}:${path}`) || "null",
      );
      if (draft && typeof draft.value === "string" && typeof draft.hash === "string") {
        value = draft.value;
        base = { ...doc, content: draft.original ?? doc.content, hash: draft.hash };
      }
    } catch {}
    return {
      ...state,
      id: crypto.randomUUID(),
      readError,
      asText,
      kind,
      path,
      mode: state?.mode || "preview",
      doc: base,
      value,
      ...(base.hash !== doc.hash ? { disk: doc } : {}),
    };
  }, []);
  const open = useCallback(
    async (path: string, pin = false, paneId = live.current.layout.activePaneId) => {
      try {
        if (!path) {
          await refresh();
          return;
        }
        const existing = live.current.tabs.find((t) => t.path === path);
        if (existing) {
          setActive(path, paneId);
          if (pin) setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, preview: false } : t)));
          return;
        }
        const openingRoot = live.current.root;
        const loaded = await loadTab(path);
        if (live.current.root !== openingRoot) return;
        if (!live.current.layout.panes.some((p) => p.id === paneId)) return;
        setTabs((ts) => {
          if (ts.some((t) => t.path === path))
            return pin ? ts.map((t) => (t.path === path ? { ...t, preview: false } : t)) : ts;
          const preview = ts.findIndex(
            (t) =>
              t.preview &&
              !t.pinned &&
              t.value === t.doc.content &&
              !live.current.layout.panes.some((p) => p.id !== paneId && p.tabs.includes(t.path)),
          );
          const next = ts.filter((t) => t.path !== path);
          if (preview >= 0 && !pin) next.splice(preview, 1, { ...loaded, preview: true });
          else next.push({ ...loaded, preview: !pin });
          return next;
        });
        setActive(path, paneId);
      } catch (e) {
        notify(String(e));
      }
    },
    [loadTab, refresh, notify],
  );
  const openBeside = (path: string) => {
    const target = live.current.layout.activePaneId === "primary" ? "secondary" : "primary";
    updateLayout((current) => ({
      ...current,
      activePaneId: target,
      panes: current.panes.some((p) => p.id === target)
        ? current.panes
        : [...current.panes, { id: target, tabs: [], active: "", views: {} }],
    }));
    void open(path, true, target);
  };
  const jumpToMatch = async (hit: SearchHit, query: string) => {
    const origin = live.current.root,
      paneId = live.current.layout.activePaneId;
    const doc = live.current.tabs.find((t) => t.path === hit.path);
    if (hit.unsaved) {
      if (
        !doc ||
        hit.sourceHash !== `draft:${doc.id}` ||
        !textMatches(doc.value, query).some(
          (match) => match.from === hit.from && match.to === hit.to,
        )
      )
        throw new Error("This result changed. Search again.");
    } else if (!(await window.folio.validateSearchHit(hit, origin)))
      throw new Error("This file changed. Search again before jumping.");
    if (live.current.root !== origin) return;
    await open(hit.path, true, paneId);
    if (live.current.root !== origin) return;
    updateView(paneId, hit.path, {
      mode: hit.page ? "preview" : "edit",
      find: { id: crypto.randomUUID(), query, from: hit.from, to: hit.to, page: hit.page },
    });
  };
  const restoreWorkspace = useCallback(
    async (vault: { root: string; entries: Entry[] }, fallback: AppState = {}) => {
      let saved: {
        layout?: unknown;
        tabs?: TabState[];
        expandedFolders?: string[];
      } = {};
      try {
        saved = JSON.parse(localStorage.getItem(`folio:workspace:${vault.root}`) || "{}");
      } catch {}
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
      const savedTabs = cleanState({ tabs: saved.tabs || fallback.tabs }).tabs || [];
      const restoredLayout = cleanLayout(saved.layout, savedTabs, fallback.active);
      const states = new Map(savedTabs.map((t) => [t.path, t]));
      const paths = [...new Set(restoredLayout.panes.flatMap((p) => p.tabs))];
      const available = paths.filter((path) => vault.entries.some((e) => e.path === path));
      const results = await Promise.allSettled(
        available.map((path) => loadTab(path, states.get(path))),
      );
      if (live.current.root !== vault.root) return;
      const docs = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (docs.length !== paths.length)
        notify("Some files could not be reopened. Recovery drafts are kept.");
      live.current.tabs = docs;
      setTabs(docs);
      updateLayout(() =>
        pruneLayout(
          restoredLayout,
          docs.map((t) => t.path),
        ),
      );
      setCollapsedFolders(
        new Set(
          Array.isArray(saved.expandedFolders)
            ? vault.entries
                .filter((e) => e.kind === "folder" && !saved.expandedFolders!.includes(e.path))
                .map((e) => e.path)
            : [],
        ),
      );
      restoring.current = "";
    },
    [loadTab, notify, updateLayout],
  );
  useEffect(() => {
    if (!ready || !root) return;
    const valid = new Set(tabs.map((t) => t.path));
    if (layout.panes.some((p) => p.tabs.some((path) => !valid.has(path))))
      updateLayout((current) => pruneLayout(current, [...valid]));
  }, [tabs, ready, root, layout, updateLayout]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.folio.state();
        if (cancelled) return;
        setSettings({ ...defaults, ...state.settings });
        setSidebar(state.sidebar ?? true);
        setSidebarWidth(state.sidebarWidth ?? 268);
        setAssistant(state.assistant ?? false);
        const vault = await refresh();
        if (vault) {
          live.current.root = vault.root;
          await restoreWorkspace(vault, state);
          if (cancelled) return;
        }
      } catch (e) {
        notify(String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready || restoring.current) return;
    const persistLocal = () => {
      if (!root) return;
      try {
        localStorage.setItem(
          `folio:workspace:${root}`,
          JSON.stringify({
            layout: savedLayout(layout),
            expandedFolders: entries
              .filter((e) => e.kind === "folder" && !collapsedFolders.has(e.path))
              .map((e) => e.path),
            tabs: savedTabs(tabs),
          }),
        );
      } catch {
        notify("Workspace storage is full. Document recovery drafts are kept.");
      }
    };
    const timer = setTimeout(() => {
      persistLocal();
      void window.folio
        .persist({
          tabs: savedTabs(tabs),
          active: isDraft(active) ? undefined : active,
          settings,
          sidebar,
          sidebarWidth,
          assistant,
        })
        .catch((error) => notify(String(error)));
    }, 300);
    window.addEventListener("pagehide", persistLocal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", persistLocal);
      if (live.current.root !== root) persistLocal();
    };
  }, [
    tabs,
    active,
    layout,
    root,
    settings,
    sidebar,
    sidebarWidth,
    assistant,
    ready,
    collapsedFolders,
    entries,
  ]);

  useEffect(
    () =>
      window.folio.onOpen((path) => {
        const origin = live.current.root;
        void refresh().then(async (vault) => {
          if (!vault) return;
          if (origin !== vault.root) await restoreWorkspace(vault);
          if (path && live.current.root === vault.root) void open(path, true);
        });
      }),
    [open, refresh, restoreWorkspace],
  );
  useEffect(
    () =>
      window.folio.onChange((path) => {
        void refresh().catch((e) => notify(String(e)));
        const origin = live.current.root;
        const current = live.current.tabs.find((t) => t.path === path);
        if (!current || !editable(path, current.kind)) return;
        void window.folio
          .read(path)
          .then((disk) =>
            setTabs((ts) =>
              ts.map((t) =>
                live.current.root !== origin || t.id !== current.id
                  ? t
                  : t.value === t.doc.content
                    ? {
                        ...t,
                        doc: disk,
                        value: disk.content,
                        disk: undefined,
                        unavailable: undefined,
                      }
                    : disk.hash === t.doc.hash
                      ? { ...t, unavailable: undefined }
                      : { ...t, disk, unavailable: undefined },
              ),
            ),
          )
          .catch((error) => {
            if (live.current.root !== origin) return;
            setTabs((ts) =>
              ts.map((t) => (t.id === current.id ? { ...t, unavailable: String(error) } : t)),
            );
            notify(`${path} was removed or is unreadable. Your open copy is kept.`);
          });
      }),
    [refresh, notify],
  );
  const change = useCallback(
    (value: string, path = live.current.active) => {
      const { root } = live.current;
      const active = path;
      setTabs((ts) =>
        ts.map((t) => {
          if (t.path !== active) return t;
          if (isDraft(active)) return { ...t, value, preview: false, error: undefined };
          try {
            localStorage.setItem(
              `folio:draft:${root}:${active}`,
              JSON.stringify({ value, hash: t.doc.hash, original: t.doc.content }),
            );
          } catch {
            notify("Recovery storage is full. Save a copy before closing.");
          }
          return { ...t, value, preview: false, error: undefined };
        }),
      );
    },
    [notify],
  );
  const save = useCallback(async (path: string, forceHash?: string) => {
    const current = live.current.tabs.find((t) => t.path === path);
    if (current && isDraft(path)) {
      setDraftSave({ path, closing: false });
      return;
    }
    if (
      !current ||
      !editable(path, current.kind) ||
      current.readError ||
      current.unavailable ||
      current.saving ||
      (current.disk && !forceHash)
    )
      return;
    const snapshot = current.value;
    const savingRoot = live.current.root;
    const savingKey = `${savingRoot}:${current.id}`;
    if (saves.current.has(savingKey)) return;
    saves.current.add(savingKey);
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, saving: true } : t)));
    try {
      const result = await window.folio.write(
        path,
        snapshot,
        forceHash || current.doc.hash,
        savingRoot,
      );
      if (live.current.root !== savingRoot) return;
      setTabs((ts) =>
        ts.map((t) => {
          if (t.id !== current.id) return t;
          if (result.status === "conflict") return { ...t, disk: result.disk, saving: false };
          if (t.value === snapshot)
            localStorage.removeItem(`folio:draft:${live.current.root}:${path}`);
          else
            localStorage.setItem(
              `folio:draft:${live.current.root}:${path}`,
              JSON.stringify({
                value: t.value,
                hash: result.document.hash,
                original: result.document.content,
              }),
            );
          return { ...t, doc: result.document, disk: undefined, error: undefined, saving: false };
        }),
      );
    } catch (e) {
      setTabs((ts) =>
        ts.map((t) =>
          live.current.root === savingRoot && t.id === current.id
            ? { ...t, error: String(e), saving: false }
            : t,
        ),
      );
    } finally {
      saves.current.delete(savingKey);
    }
  }, []);
  useEffect(() => {
    const dirty = tabs.filter(
      (t) =>
        editable(t.path, t.kind) &&
        !isDraft(t.path) &&
        !t.readError &&
        t.value !== t.doc.content &&
        !t.disk &&
        !t.error &&
        !t.saving,
    );
    if (!dirty.length) return;
    const timer = setTimeout(() => {
      for (const t of dirty) void save(t.path);
    }, 800);
    return () => clearTimeout(timer);
  }, [tabs, save]);
  function finishRecovery(originRoot: string, expected: Tab, disk: Document) {
    if (live.current.root !== originRoot) return;
    setTabs((ts) =>
      ts.map((current) => {
        const result = recoverTab(current, expected, disk, live.current.root, originRoot);
        if (result.clearDraft)
          localStorage.removeItem(`folio:draft:${originRoot}:${expected.path}`);
        return result.tab;
      }),
    );
  }
  function close(path: string, force = false) {
    const t = live.current.tabs.find((t) => t.path === path);
    if (!t || t.pinned) return;
    if (isDraft(path) && !force && t.value !== t.doc.content) {
      setDraftSave({ path, closing: true });
      return;
    }
    if (
      !isDraft(path) &&
      t.value !== t.doc.content &&
      !confirm("This tab has unsaved edits. Close it? A recovery draft is kept.")
    )
      return;
    const paneId = live.current.layout.activePaneId;
    const elsewhere = live.current.layout.panes.some(
      (p) => p.id !== paneId && p.tabs.includes(path),
    );
    updateLayout((current) => ({
      ...current,
      panes: current.panes.map((p) =>
        p.id !== paneId
          ? p
          : {
              ...p,
              tabs: p.tabs.filter((t) => t !== path),
              active: p.active === path ? p.tabs.find((t) => t !== path) || "" : p.active,
            },
      ),
    }));
    if (elsewhere) return;
    if (!isDraft(path)) closed.current.push(t);
    setTabs((ts) => ts.filter((t) => t.path !== path));
    if (active === path)
      setActive(
        tabs[Math.max(0, tabs.findIndex((t) => t.path === path) - 1)]?.path === path
          ? tabs.find((t) => t.path !== path)?.path || ""
          : tabs[Math.max(0, tabs.findIndex((t) => t.path === path) - 1)]?.path || "",
      );
  }
  async function folder() {
    try {
      if (
        tabs.some((t) => t.value !== t.doc.content) &&
        !confirm("Open another folder? Unsaved recovery drafts stay with this folder.")
      )
        return;
      const vault = await window.folio.openFolder();
      if (vault) {
        setRoot(vault.root);
        live.current.root = vault.root;
        setEntries(vault.entries);
        setSelectedFolder("");
        setCreation(null);
        setContextMenu(null);
        setFileAction(null);
        setDialog(null);
        closed.current = [];
        setTabs([]);
        updateLayout(() => cleanLayout(null));
        await restoreWorkspace(vault);
      }
    } catch (e) {
      notify(String(e));
    }
  }
  async function remove() {
    if (!tab || isDraft(tab.path)) return;
    try {
      if (tab.value !== tab.doc.content) await window.folio.checkpoint(tab.path, tab.value, root);
      await window.folio.trash(tab.path, tab.doc.hash, root);
      if (live.current.root !== root) return;
      setTabs((ts) => ts.filter((t) => t.path !== tab.path));
      setActive(tabs.find((t) => t.path !== tab.path)?.path || "");
      await refresh();
      notify("Moved to Trash. Restore it from the sidebar.");
      setMenu(false);
    } catch (e) {
      notify(String(e));
    }
  }
  function canRename(plan: RenamePlan) {
    const dirty = live.current.tabs.find(
      (t) =>
        t.value !== t.doc.content &&
        (plan.files.some((f) => f.path === t.path || f.newPath === t.path) ||
          t.path === plan.source ||
          t.path.startsWith(plan.source + "/")),
    );
    if (dirty) {
      notify(`Save ${dirty.path} before updating its links.`);
      return false;
    }
    return true;
  }
  async function migrateRename(source: string, target: string, origin: string) {
    const moved = (p: string) => p === source || p.startsWith(source + "/");
    const renamed = (p: string) => target + p.slice(source.length);
    const migrations = draftMoves(localStorage, origin, source, target);
    for (const move of migrations) {
      if (move.displaced && move.displaced !== move.value) {
        try {
          const draft = JSON.parse(move.displaced);
          if (typeof draft.value === "string")
            await window.folio.checkpoint(move.path, draft.value, origin);
        } catch (e) {
          throw new Error(`Could not retain an earlier recovery draft: ${String(e)}`);
        }
      }
    }
    if (live.current.root !== origin) return;
    for (const move of migrations) {
      localStorage.setItem(move.newKey, move.value);
      localStorage.removeItem(move.oldKey);
    }
    setTabs((ts) =>
      ts.map((t) =>
        moved(t.path)
          ? {
              ...t,
              path: renamed(t.path),
              doc: { ...t.doc, path: renamed(t.path) },
              disk: t.disk ? { ...t.disk, path: renamed(t.path) } : undefined,
              saving: false,
            }
          : t,
      ),
    );
    updateLayout((current) => renameLayout(current, source, target));
    setSelectedFolder((path) => (moved(path) ? renamed(path) : path));
    closed.current = [];
    setCollapsedFolders(
      (paths) =>
        new Set(
          [...paths].map((renamedPath) =>
            moved(renamedPath) ? renamed(renamedPath) : renamedPath,
          ),
        ),
    );
    try {
      const key = `folio:presets:${origin}`;
      const presets = cleanPresets(JSON.parse(localStorage.getItem(key) || "[]"), origin);
      localStorage.setItem(key, JSON.stringify(migratePresets(presets, source, target)));
    } catch {
      notify("File renamed; workspace presets could not be updated.");
    }
    setRecent((paths) =>
      paths.map((path) =>
        path === source || path.startsWith(source + "/")
          ? target + path.slice(source.length)
          : path,
      ),
    );
  }
  const workspaceSnapshot = (): Omit<WorkspacePreset, "id" | "name"> => ({
    vaultRoot: root,
    layout: cleanLayout(savedLayout(layout)),
    tabs: savedTabs(tabs),
    expandedFolders: entries
      .filter((e) => e.kind === "folder" && !collapsedFolders.has(e.path))
      .map((e) => e.path),
    sidebar,
    sidebarWidth,
    assistant,
  });
  async function applyWorkspace(preset: WorkspacePreset) {
    if (preset.vaultRoot !== root || live.current.root !== root)
      throw new Error("This workspace belongs to another folder");
    const origin = root,
      available = entries.filter((e) => e.kind !== "folder").map((e) => e.path),
      nextLayout = pruneLayout(cleanLayout(preset.layout), available);
    const requested = new Set(nextLayout.panes.flatMap((p) => p.tabs));
    const loads = await Promise.allSettled(
      [...requested]
        .filter((path) => !live.current.tabs.some((t) => t.path === path))
        .map((path) =>
          loadTab(
            path,
            preset.tabs.find((t) => t.path === path),
          ),
        ),
    );
    if (live.current.root !== origin) return;
    const loaded = loads.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      current = live.current.tabs;
    const dirty = current.filter((t) => t.value !== t.doc.content),
      docs = [
        ...current.filter((t) => requested.has(t.path) || dirty.includes(t)),
        ...loaded.filter((t) => !current.some((c) => c.path === t.path)),
      ];
    let merged = pruneLayout(
      nextLayout,
      docs.map((t) => t.path),
    );
    const first = merged.panes[0];
    merged = {
      ...merged,
      panes: merged.panes.map((p, i) =>
        i
          ? p
          : {
              ...first,
              tabs: [...new Set([...first.tabs, ...dirty.map((t) => t.path)])],
              active: first.active || dirty[0]?.path || "",
              views: {
                ...Object.fromEntries(dirty.map((t) => [t.path, { mode: t.mode }])),
                ...first.views,
              },
            },
      ),
    };
    live.current.tabs = docs;
    setTabs(docs);
    updateLayout(() => merged);
    setSidebar(preset.sidebar);
    setSidebarWidth(preset.sidebarWidth);
    setAssistant(preset.assistant);
    setCollapsedFolders(
      new Set(
        entries
          .filter((e) => e.kind === "folder" && !preset.expandedFolders.includes(e.path))
          .map((e) => e.path),
      ),
    );
    if (loads.some((result) => result.status === "rejected"))
      notify("Some files could not be opened. Unsaved notes are kept.");
  }
  async function finishLinkRename(plan: RenamePlan, origin: string, snapshots: Tab[]) {
    if (live.current.root !== origin) return;
    await migrateRename(plan.source, plan.target, origin);
    for (const file of plan.files) {
      const expected = snapshots.find((t) => t.path === file.path || t.path === file.newPath);
      if (!expected) continue;
      const disk = await window.folio.read(file.newPath);
      if (live.current.root !== origin) return;
      setTabs((ts) =>
        ts.map((t) => {
          if (t.id !== expected.id || t.doc.hash === disk.hash) return t;
          const result = recoverTab(t, expected, disk, live.current.root, origin);
          if (result.clearDraft) localStorage.removeItem(`folio:draft:${origin}:${file.newPath}`);
          return result.tab;
        }),
      );
    }
    await refresh();
  }
  async function applyLinkRename(plan: RenamePlan) {
    const origin = root;
    if (live.current.root !== origin) throw new Error("The active folder changed");
    if (!canRename(plan)) throw new Error("Save affected notes before updating links");
    const snapshots = [...live.current.tabs];
    await window.folio.applyRenamePlan(plan.id, origin);
    if (live.current.root !== origin) return;
    await finishLinkRename(plan, origin, snapshots);
  }
  async function changePath() {
    if (!fileAction) return;
    const origin = fileAction.root;
    if (live.current.root !== origin) {
      setFileAction(null);
      return;
    }
    const action = fileAction;
    const target = newName.trim();
    try {
      if (updateLinks && !renamePlan) {
        setRenameBusy(true);
        const plan = await window.folio.planRenameLinks(action.path, target, origin);
        if (
          live.current.root === origin &&
          renameContext.current.fileAction === action &&
          renameContext.current.newName.trim() === target &&
          canRename(plan)
        )
          setRenamePlan(plan);
        return;
      }
      if (updateLinks && renamePlan) {
        if (!canRename(renamePlan)) return;
        setRenameBusy(true);
        await applyLinkRename(renamePlan);
        if (live.current.root !== origin) return;
      } else {
        await window.folio.rename(action.path, target, origin);
        if (live.current.root !== origin) return;
        await migrateRename(action.path, target, origin);
      }
      setFileAction(null);
      setContextMenu(null);
      await refresh();
      notify("Renamed.");
    } catch (e) {
      notify(String(e));
      setShowLinks(true);
    } finally {
      setRenameBusy(false);
    }
  }
  async function deleteEntry(path: string, origin: string) {
    if (live.current.root !== origin) {
      setContextMenu(null);
      return;
    }
    const affected = live.current.tabs.filter(
      (t) => t.path === path || t.path.startsWith(path + "/"),
    );
    try {
      await Promise.all(
        affected
          .filter((t) => t.value !== t.doc.content)
          .map((t) => window.folio.checkpoint(t.path, t.value, origin)),
      );
      await window.folio.trashEntry(path, origin);
      if (live.current.root !== origin) return;
      setTabs((ts) => ts.filter((t) => t.path !== path && !t.path.startsWith(path + "/")));
      if (active === path || active.startsWith(path + "/")) setActive("");
      closed.current = [];
      setContextMenu(null);
      await refresh();
      notify("Moved to Trash. Restore from the sidebar.");
    } catch (e) {
      notify(String(e));
    }
  }
  function beginCreation(type: "file" | "folder", parent = selectedFolder, drawing = false) {
    if (!root) {
      void folder();
      return;
    }
    if (creation?.busy) return;
    setSidebar(true);
    setSearch("");
    setSelectedFolder(parent);
    setContextMenu(null);
    setDialog(null);
    setCreation({ root, parent, type, name: suggestedName(entries, parent, type, drawing) });
  }
  async function commitCreation() {
    const request = creation;
    if (!request || request.busy) return;
    if (live.current.root !== request.root) {
      setCreation(null);
      return;
    }
    try {
      const path = entryPath(request.parent, request.name, request.type);
      setCreation((c) => (c === request ? { ...c, busy: true, error: undefined } : c));
      if (request.type === "folder") await window.folio.mkdir(path, request.root);
      else {
        const content = path.endsWith(".excalidraw")
          ? JSON.stringify(
              {
                type: "excalidraw",
                version: 2,
                source: "grove",
                elements: [],
                appState: {},
                files: {},
              },
              null,
              2,
            )
          : /\.(md|markdown)$/i.test(path)
            ? `# ${name(path)}\n\n`
            : "";
        await window.folio.create(path, content, request.root);
      }
      if (live.current.root !== request.root) return;
      setCreation(null);
      await refresh();
      if (live.current.root !== request.root) return;
      if (request.type === "file") {
        await open(path, true);
        setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, mode: "preview" } : t)));
      } else setSelectedFolder(path);
    } catch (error) {
      if (live.current.root === request.root)
        setCreation((c) =>
          c && c.root === request.root && c.parent === request.parent
            ? { ...c, busy: false, error: String(error) }
            : c,
        );
    }
  }
  function newNote(drawing = false) {
    if (drawing || !root) {
      beginCreation("file", selectedFolder, drawing);
      return;
    }
    const path = `${DRAFT}${crypto.randomUUID()}.md`,
      value = "# Untitled\n\n";
    setTabs((ts) => [
      ...ts,
      {
        id: crypto.randomUUID(),
        path,
        mode: "edit",
        kind: "markdown",
        doc: { path, content: value, hash: "", modified: Date.now() },
        value,
      },
    ]);
    setActive(path);
    updateView(live.current.layout.activePaneId, path, { mode: "edit" });
  }
  async function saveDraft(fileName: string, parent: string) {
    const request = draftSave;
    const draft = request && live.current.tabs.find((t) => t.path === request.path);
    if (!request || !draft) {
      setDraftSave(null);
      return;
    }
    const path = entryPath(parent, fileName, "file");
    await window.folio.create(path, draft.value, root);
    setDraftSave(null);
    close(draft.path, true);
    await refresh();
    if (request.closing) return;
    await open(path, true);
    updateView(live.current.layout.activePaneId, path, { mode: "edit" });
  }
  function mode(mode: TabState["mode"]) {
    updateView(layout.activePaneId, active, { mode });
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        setTabMenu(false);
        setContextMenu(null);
        setFileAction(null);
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        void window.folio.window("fullscreen");
        return;
      }
      if (dialog === "settings") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        setContentSearch(e.shiftKey ? {} : { path: active || undefined });
        return;
      }
      if (["k", "j", "e", "n", "t", "w", ",", "\\", "tab", "s"].includes(key) || /^\d$/.test(key)) {
        e.preventDefault();
        if (key === "k") setSwitcher(true);
        if (key === "j") setAssistant((v) => !v);
        if (key === "\\") setSidebar((v) => !v);
        if (key === ",") setDialog("settings");
        if (key === "e") mode(e.shiftKey ? "split" : tab?.mode === "edit" ? "preview" : "edit");
        if (key === "n" || (key === "t" && !e.shiftKey)) newNote(e.shiftKey && key === "n");
        if (key === "w" && tab) close(tab.path);
        if (key === "t" && e.shiftKey) {
          const last = closed.current.pop();
          if (last) {
            setTabs((ts) => (ts.some((t) => t.path === last.path) ? ts : [...ts, last]));
            setActive(last.path);
          }
        }
        if (key === "s" && tab) void save(tab.path);
        if (key === "tab") {
          const i = tabs.findIndex((t) => t.path === active);
          setActive(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]?.path || "");
        }
        if (/^\d$/.test(key))
          setActive(tabs[key === "9" ? tabs.length - 1 : Number(key) - 1]?.path || active);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function history() {
    if (!tab || isDraft(tab.path)) return;
    try {
      const history = await window.folio.versions(tab.path);
      if (live.current.root !== root) return;
      setVersions(history);
      setDialog("history");
      setMenu(false);
    } catch (e) {
      notify(String(e));
    }
  }
  const paths = entries.filter((e) => e.path.toLowerCase().includes(search.toLowerCase()));
  const fileRow = (e: Entry) => (
    <Tooltip key={e.path} text={e.path}>
      <button
        className={`file-row ${active === e.path ? "selected" : ""}`}
        onClick={() => void open(e.path)}
        onDoubleClick={() => void open(e.path, true)}
        data-path={e.path}
      >
        <Icon path={e.path} />
        <span>{name(e.path)}</span>
        {!editable(e.path, e.kind) && (
          <small>
            {["audio", "video"].includes(e.kind)
              ? "Play"
              : e.kind === "unsupported"
                ? "External"
                : "Preview"}
          </small>
        )}
      </button>
    </Tooltip>
  );
  return (
    <div
      className={`app ${sidebar ? "has-sidebar" : ""} ${assistant ? "has-assistant" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {sidebar && (
        <aside className="sidebar">
          <div className="sidebar-top drag">
            <Button label="Hide sidebar (Ctrl+\\)" onClick={() => setSidebar(false)}>
              <PanelLeft />
            </Button>
            <span className="push" />
            <Button
              label="Previous tab"
              onClick={() =>
                setActive(
                  tabs[Math.max(0, tabs.findIndex((t) => t.path === active) - 1)]?.path || "",
                )
              }
            >
              <ChevronLeft />
            </Button>
            <Button
              label="Next tab"
              onClick={() =>
                setActive(
                  tabs[Math.min(tabs.length - 1, tabs.findIndex((t) => t.path === active) + 1)]
                    ?.path || "",
                )
              }
            >
              <ChevronRight />
            </Button>
          </div>
          <label className="search">
            <Search size={16} />
            <input
              ref={searchRef}
              placeholder="Search files"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <Button label="Clear search" onClick={() => setSearch("")}>
                <X size={12} />
              </Button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </label>
          <div className="tree">
            {!search && tabs.length > 0 && (
              <>
                <h4>Recent</h4>
                {tabs
                  .slice(-4)
                  .reverse()
                  .map((t) =>
                    fileRow(
                      entries.find((e) => e.path === t.path) || {
                        path: t.path,
                        name: t.path,
                        kind: kindOf(t.path),
                        size: 0,
                        modified: 0,
                      },
                    ),
                  )}
              </>
            )}
            {search ? (
              <>
                <h4>Search results</h4>
                {paths.filter((e) => e.kind !== "folder").map(fileRow)}
              </>
            ) : (
              <FileTree
                key={root}
                collapsed={collapsedFolders}
                setCollapsed={setCollapsedFolders}
                entries={entries}
                active={active}
                open={(p, pin) => void open(p, pin)}
                context={(path, directory, x, y) => setContextMenu({ root, path, directory, x, y })}
                selectedFolder={selectedFolder}
                selectFolder={setSelectedFolder}
                creation={creation?.root === root ? creation : null}
                changeCreation={(name) =>
                  setCreation((c) => (c ? { ...c, name, error: undefined } : c))
                }
                commitCreation={() => void commitCreation()}
                cancelCreation={() => setCreation(null)}
                newFile={(parent) => beginCreation("file", parent)}
                newFolder={(parent) => beginCreation("folder", parent)}
              />
            )}
            {search && !paths.length && (
              <div className="search-empty">
                <Search />
                <p>No file names match “{search}”</p>
                <button
                  onClick={() => {
                    beginCreation("file", selectedFolder);
                    setCreation((c) =>
                      c ? { ...c, name: search.includes(".") ? search : `${search}.md` } : c,
                    );
                  }}
                >
                  New note “{search}”
                </button>
              </div>
            )}
            {!root && (
              <button className="open-folder" onClick={() => void folder()}>
                <FolderOpen /> Open a folder
              </button>
            )}
          </div>
          <footer className="sidebar-footer">
            <button
              className="file-row"
              onClick={() =>
                void window.folio
                  .trashList()
                  .then((items) => {
                    setTrash(items);
                    setDialog("trash");
                  })
                  .catch((e) => notify(String(e)))
              }
            >
              <Trash2 />
              <span>Trash</span>
            </button>
            <div className="vault-row">
              <Tooltip text={[root || "Grove", syncText].filter(Boolean).join(" · ")}>
                <button className="vault-switch" onClick={() => void folder()}>
                  <span className="workspace-avatar">
                    <GroveMark size={25} />
                  </span>
                  <span>
                    <strong>{root ? name(root) : "Grove"}</strong>
                    {root && syncText ? (
                      <small
                        className="sync-status"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsSection("sync");
                          setDialog("settings");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setSettingsSection("sync");
                            setDialog("settings");
                          }
                        }}
                      >
                        {syncText}
                      </small>
                    ) : (
                      <small>
                        {root ? "Local folder · opened in place" : "Your files, your space"}
                      </small>
                    )}
                  </span>
                  <ChevronsUpDown size={14} />
                </button>
              </Tooltip>
              <Button label="Workspaces" onClick={() => setWorkspacesOpen(true)}>
                <Columns2 />
              </Button>
              <Button label="Settings (Ctrl+,)" onClick={() => setDialog("settings")}>
                <SlidersHorizontal />
              </Button>
              <Button label="New note (Ctrl+N)" onClick={() => newNote()}>
                <Plus />
              </Button>
            </div>
          </footer>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                setSidebarWidth((w) =>
                  Math.max(190, Math.min(520, w + (e.key === "ArrowRight" ? 16 : -16))),
                );
              }
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);
              document.body.classList.add("resizing-sidebar");
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setSidebarWidth(Math.max(190, Math.min(520, e.clientX)));
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              document.body.classList.remove("resizing-sidebar");
            }}
            onLostPointerCapture={() => document.body.classList.remove("resizing-sidebar")}
          />
        </aside>
      )}
      <header
        className="titlebar drag"
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) void window.folio.window("maximize");
        }}
      >
        {!sidebar && (
          <div className="left-controls">
            <Button label="Show sidebar" onClick={() => setSidebar(true)}>
              <PanelLeft />
            </Button>
            <Button
              label="Search files"
              onClick={() => {
                setSidebar(true);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <Search />
            </Button>
          </div>
        )}
        <div className="tabs">
          {tabs
            .filter((t) => activePane.tabs.includes(t.path))
            .map((t) => (
              <Tooltip key={t.path} text={t.pinned ? `${t.path} · Pinned` : t.path}>
                <div
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("application/x-grove-tab", t.path)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData("application/x-grove-tab");
                    setTabs((ts) => {
                      const moving = ts.find((t) => t.path === from);
                      if (!moving) return ts;
                      const next = ts.filter((t) => t.path !== from);
                      next.splice(
                        next.findIndex((x) => x.path === t.path),
                        0,
                        moving,
                      );
                      return next;
                    });
                  }}
                  className={`tab ${active === t.path ? "active" : ""} ${t.preview ? "temporary" : ""} ${t.pinned ? "pinned" : ""}`}
                  data-path={t.path}
                  aria-label={t.pinned ? `${tabName(t)} · Pinned tab` : tabName(t)}
                  onClick={() => {
                    setActive(t.path);
                    setSelectedFolder(t.path.split("/").slice(0, -1).join("/"));
                  }}
                  onDoubleClick={() =>
                    setTabs((ts) =>
                      ts.map((x) => (x.path === t.path ? { ...x, preview: false } : x)),
                    )
                  }
                  onAuxClick={(e) => {
                    if (e.button === 1) close(t.path);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActive(t.path);
                    setContextMenu({
                      root,
                      path: t.path,
                      directory: false,
                      tab: true,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <Icon path={t.path} />
                  {!t.pinned && <span>{tabName(t)}</span>}
                  {t.pinned ? (
                    <Pin size={12} />
                  ) : (
                    <Button
                      label={`Close ${tabName(t)}`}
                      className={`tab-close ${t.value !== t.doc.content ? "dirty" : ""} ${t.disk ? "conflicted" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        close(t.path);
                      }}
                    >
                      {t.value !== t.doc.content ? <i /> : <X size={12} />}
                    </Button>
                  )}
                </div>
              </Tooltip>
            ))}
          <Button label="New tab (Ctrl+T)" className="tab-add" onClick={() => newNote()}>
            <Plus />
          </Button>
        </div>
        <Button label="All open tabs" onClick={() => setTabMenu(!tabMenu)}>
          <ChevronDown />
        </Button>
        <div className="drag-handle" aria-hidden="true" />
        <div className="title-actions">
          {root && (
            <Button label="Backlinks and broken links" onClick={() => setShowLinks((v) => !v)}>
              <Link2 />
            </Button>
          )}
          {tab && (
            <Button label="Open beside" onClick={() => openBeside(active)}>
              <Columns2 />
            </Button>
          )}
          {tab && !tab.readError && editable(active, entry.kind) && (
            <span
              className={`save-status ${tab.error ? "danger-text" : tab.disk ? "warning-text" : ""}`}
            >
              <i />
              {tab.error
                ? "Not saved"
                : tab.disk
                  ? "Changed on disk"
                  : tab.saving
                    ? "Saving…"
                    : tab.value !== tab.doc.content
                      ? "Unsaved"
                      : "Saved"}
            </span>
          )}
          {tab && ["markdown", "text"].includes(entry.kind) && (
            <div className="seg">
              {(["edit", "preview", "split"] as const).map((m) => (
                <button className={tab.mode === m ? "active" : ""} key={m} onClick={() => mode(m)}>
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          )}
          <Button
            label="Toggle light/dark"
            onClick={() => setSettings({ ...settings, theme: dark ? "light" : "dark" })}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Button label="Document menu" onClick={() => setMenu(!menu)}>
            <Ellipsis />
          </Button>
          <button
            className={`assistant-toggle ${assistant ? "selected" : ""}`}
            onClick={() => setAssistant(!assistant)}
          >
            <Sparkles /> <span>Assistant</span>
          </button>
          <span className="divider" />
        </div>
        <div className="window-controls">
          <Button label="Minimize" onClick={() => void window.folio.window("minimize")}>
            <Minus />
          </Button>
          <Button label="Maximize" onClick={() => void window.folio.window("maximize")}>
            <Square />
          </Button>
          <Button
            label="Close window"
            className="window-close"
            onClick={() => void window.folio.window("close")}
          >
            <X />
          </Button>
        </div>
      </header>
      {menu && (
        <>
          <div className="dismiss" onClick={() => setMenu(false)} />
          <div className="menu">
            {tab && entry.kind === "markdown" && (
              <button
                onClick={() => {
                  setExportNote({ path: tab.path, content: tab.value, root });
                  setMenu(false);
                }}
              >
                Export note…
              </button>
            )}
            <button onClick={() => void history()}>
              <History /> Version history <kbd>Ctrl Alt H</kbd>
            </button>
            <button
              disabled={!tab || isDraft(active)}
              onClick={() => void window.folio.external(active, true)}
            >
              <FolderOpen /> Show in Files
            </button>
            <button
              disabled={!tab || isDraft(active)}
              onClick={() => void window.folio.external(active)}
            >
              <ExternalLink /> Open externally
            </button>
            <button
              disabled={!tab}
              onClick={() => {
                void window.folio
                  .copyText(`${root}/${active}`)
                  .then(() => notify("Copied path"))
                  .catch((e) => notify(String(e)));
                setMenu(false);
              }}
            >
              Copy path
            </button>
            <hr />
            <button
              disabled={!tab}
              onClick={() => {
                setTabs((ts) =>
                  ts.map((t) =>
                    t.path === active ? { ...t, pinned: !t.pinned, preview: false } : t,
                  ),
                );
                setMenu(false);
              }}
            >
              <Pin /> {tab?.pinned ? "Unpin" : "Pin"} tab
            </button>
            <button
              onClick={() => {
                setContext((c) => Array.from(new Set([...c, active])));
                setAssistant(true);
                setMenu(false);
              }}
            >
              <Sparkles /> Add to assistant context
            </button>
            <button
              onClick={() => {
                setDialog("settings");
                setMenu(false);
              }}
            >
              <SlidersHorizontal /> Appearance
            </button>
            <hr />
            <button
              className="danger-text"
              disabled={!tab || !editable(active, entry.kind)}
              onClick={() => void remove()}
            >
              <Trash2 /> Move to Trash
            </button>
          </div>
        </>
      )}
      {tabMenu && (
        <>
          <div className="dismiss" onClick={() => setTabMenu(false)} />
          <div className="menu tab-list">
            {tabs.map((t) => (
              <button
                key={t.path}
                onClick={() => {
                  setActive(t.path);
                  setTabMenu(false);
                }}
              >
                <Icon path={t.path} />
                {tabName(t)}
                {active === t.path && <Check className="push" />}
              </button>
            ))}
          </div>
        </>
      )}
      {contextMenu && (
        <>
          <div className="dismiss" onClick={() => setContextMenu(null)} />
          <div
            className="menu file-context-menu"
            role="menu"
            aria-label={
              contextMenu.tab
                ? "Tab actions"
                : contextMenu.directory
                  ? "Folder actions"
                  : "File actions"
            }
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 260),
              top: Math.min(contextMenu.y, window.innerHeight - 330),
              right: "auto",
            }}
          >
            {contextMenu.directory ? (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    if (contextMenu.root === root) beginCreation("file", contextMenu.path);
                  }}
                >
                  <FileText /> New file
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    if (contextMenu.root === root) beginCreation("folder", contextMenu.path);
                  }}
                >
                  <Folder /> New folder
                </button>
              </>
            ) : (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    void open(contextMenu.path, true);
                    setContextMenu(null);
                  }}
                >
                  <FileText /> Open file
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    if (contextMenu.root === root) void open(contextMenu.path, true);
                    setContextMenu(null);
                  }}
                >
                  <Plus /> Open in new tab
                </button>
                {contextMenu.tab && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setTabs((ts) =>
                          ts.map((t) =>
                            t.path === contextMenu.path
                              ? { ...t, pinned: !t.pinned, preview: false }
                              : t,
                          ),
                        );
                        setContextMenu(null);
                      }}
                    >
                      <Pin />{" "}
                      {tabs.find((t) => t.path === contextMenu.path)?.pinned
                        ? "Unpin tab"
                        : "Pin tab"}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        close(contextMenu.path);
                        setContextMenu(null);
                      }}
                    >
                      <X /> Close tab
                    </button>
                  </>
                )}
              </>
            )}
            {contextMenu.path && (
              <>
                <hr />
                <button
                  role="menuitem"
                  onClick={() => {
                    setNewName(contextMenu.path);
                    setFileAction({
                      type: "rename",
                      path: contextMenu.path,
                      root: contextMenu.root,
                    });
                    setContextMenu(null);
                  }}
                >
                  <Pencil /> Rename
                </button>
                <button
                  role="menuitem"
                  onClick={() =>
                    void window.folio
                      .external(contextMenu.path, true)
                      .then(() => setContextMenu(null))
                      .catch((e) => notify(String(e)))
                  }
                >
                  <FolderOpen /> Show in Files
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    void window.folio
                      .copyText(`${root}/${contextMenu.path}`)
                      .then(() => notify("Copied path"))
                      .catch((e) => notify(String(e)));
                    setContextMenu(null);
                  }}
                >
                  Copy path
                </button>
                <hr />
                <button
                  role="menuitem"
                  className="danger-text"
                  onClick={() => void deleteEntry(contextMenu.path, contextMenu.root)}
                >
                  <Trash2 /> Move to Trash
                </button>
              </>
            )}
          </div>
        </>
      )}
      {draftSave && (
        <SaveDraftDialog
          key={draftSave.path}
          title={draftTitle(tabs.find((t) => t.path === draftSave.path)?.value || "")}
          folders={entries.filter((e) => e.kind === "folder").map((e) => e.path)}
          folder={selectedFolder}
          closing={draftSave.closing}
          vaultName={name(root)}
          save={saveDraft}
          discard={() => {
            const path = draftSave.path;
            setDraftSave(null);
            close(path, true);
          }}
          cancel={() => {
            quitting.current = false;
            setDraftSave(null);
          }}
        />
      )}
      {fileAction && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFileAction(null);
          }}
        >
          <section className="modal" role="dialog" aria-label="Rename">
            <header>
              <h2>Rename</h2>
              <button aria-label="Close dialog" onClick={() => setFileAction(null)}>
                <X />
              </button>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void changePath();
              }}
            >
              <label htmlFor="file-action-name">New path</label>
              <input
                id="file-action-name"
                autoFocus
                required
                value={newName}
                disabled={renameBusy}
                onChange={(e) => setNewName(e.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={updateLinks}
                  disabled={renameBusy}
                  onChange={(event) => setUpdateLinks(event.target.checked)}
                />{" "}
                Update links in saved notes
              </label>
              {renamePlan && (
                <div className="rename-preview">
                  <p>
                    {renamePlan.files.length} notes will have their links updated. Newer disk edits
                    will stop the update safely.
                  </p>
                  {renamePlan.files.map((file) => (
                    <p key={file.path}>
                      {file.path} → {file.newPath}
                    </p>
                  ))}
                </div>
              )}
              <footer>
                <button type="button" onClick={() => setFileAction(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={renameBusy}>
                  {renameBusy
                    ? "Working…"
                    : updateLinks && !renamePlan
                      ? "Preview changes"
                      : "Rename"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      <main className="document-panel">
        {showLinks && root && !isDraft(active) && (
          <Backlinks
            key={root}
            root={root}
            path={active}
            open={(path) => void open(path, true)}
            close={() => setShowLinks(false)}
            apply={applyLinkRename}
          />
        )}
        {contentSearch && (
          <SearchPanel
            key={`${root}:${contentSearch.path || "workspace"}`}
            root={root}
            path={contentSearch.path}
            documents={tabs}
            jump={jumpToMatch}
            close={() => setContentSearch(undefined)}
          />
        )}
        {activeConflict && (
          <div className="banner warning">
            <p>Another device changed this file at the same time. Both versions are kept.</p>
            <div className="actions">
              <button onClick={() => openBeside(activeConflict.path)}>Compare side by side</button>
            </div>
          </div>
        )}
        {tab?.unavailable && (
          <div className="banner warning">
            <strong>File unavailable on disk</strong>
            <p>{tab.unavailable}. Your working copy and drafts are kept.</p>
            <div className="actions">
              <button
                onClick={() =>
                  void window.folio.saveCopy(tab.value).catch((error) => notify(String(error)))
                }
              >
                Save copy
              </button>
              {tab && entry.kind === "markdown" && (
                <button
                  onClick={() => {
                    setExportNote({ path: tab.path, content: tab.value, root });
                    setMenu(false);
                  }}
                >
                  Export note…
                </button>
              )}
              <button onClick={() => void history()}>View history</button>
            </div>
          </div>
        )}
        {tab?.readError && (
          <div className="banner warning">
            <strong>This file cannot be edited as text.</strong>
            <p>{tab.readError}</p>
          </div>
        )}
        {tab?.disk && (
          <div className="banner warning">
            <div>
              <strong>This file changed on disk while you had unsaved edits.</strong>
              <p>Nothing was overwritten. Choose which version to keep.</p>
            </div>
            <div className="actions">
              <button onClick={() => setRecoveryPreview({ root, expected: tab })}>Compare</button>
              <button
                className="primary"
                onClick={() =>
                  void (async () => {
                    try {
                      const copy = conflictCopyPath(active);
                      await window.folio.create(copy, tab.value, root);
                      if (live.current.root !== root) return;
                      const disk = await window.folio.read(active);
                      if (live.current.root !== root) return;
                      finishRecovery(root, tab, disk);
                      await refresh();
                      if (live.current.root !== root) return;
                      await open(copy, true);
                      notify("Both versions kept in separate files.");
                    } catch (e) {
                      notify(String(e));
                    }
                  })()
                }
              >
                Keep both
              </button>
              <button onClick={() => void save(active, tab.disk!.hash)}>Keep mine</button>
              <button
                onClick={() =>
                  void window.folio
                    .checkpoint(active, tab.value, root)
                    .then(() => {
                      finishRecovery(root, tab, tab.disk!);
                    })
                    .catch((e) => notify(String(e)))
                }
              >
                Use disk version
              </button>
            </div>
          </div>
        )}
        {tab?.error && (
          <div className="banner danger">
            <strong>Couldn’t save {entry.name}</strong>
            <p>{tab.error}. Your edits are retained in a recovery draft.</p>
            <div className="actions">
              <button onClick={() => void save(active)}>Retry</button>
              <button
                onClick={() =>
                  void window.folio.saveCopy(tab.value).catch((e) => notify(String(e)))
                }
              >
                Save a copy…
              </button>
            </div>
          </div>
        )}
        {!tab ? (
          <div className="empty welcome">
            <div className="folio-mark">
              <GroveMark size={38} />
            </div>
            <h1>{root ? "No file open" : "A quiet place for your ideas."}</h1>
            <p>
              {root
                ? "Choose a file from the sidebar, or start something new."
                : "Notes, drawings, and the things you want to keep.\nAll in a folder you already own."}
            </p>
            <div className="welcome-actions">
              {!root ? (
                <button className="primary" onClick={() => void folder()}>
                  <FolderOpen /> Open a folder <kbd>↵</kbd>
                </button>
              ) : (
                <>
                  <button onClick={() => newNote()}>
                    <FileText /> New note <kbd>Ctrl N</kbd>
                  </button>
                  <button onClick={() => newNote(true)}>
                    <Shapes /> New drawing <kbd>Ctrl Shift N</kbd>
                  </button>
                </>
              )}
            </div>
            <small>Local files. No account. Yours to keep.</small>
          </div>
        ) : (
          <div className="document-panes">
            {layout.panes.map((pane, index) => {
              const document = tabs.find((t) => t.path === pane.active);
              const found = entries.find((e) => e.path === pane.active);
              const paneEntry = document
                ? {
                    ...(found || {
                      path: document.path,
                      name: document.path.split("/").pop() || document.path,
                      size: 0,
                      modified: 0,
                    }),
                    kind: document.readError
                      ? ("unsupported" as const)
                      : document.asText
                        ? ("text" as const)
                        : document.kind || kindOf(document.path),
                  }
                : undefined;
              return (
                <div
                  key={pane.id}
                  className="pane-slot"
                  style={{
                    flex:
                      layout.panes.length === 1
                        ? 1
                        : index === 0
                          ? layout.splitRatio
                          : 1 - layout.splitRatio,
                  }}
                >
                  {index === 1 && (
                    <div
                      role="separator"
                      aria-label="Resize document panes"
                      aria-orientation="vertical"
                      aria-valuenow={Math.round(layout.splitRatio * 100)}
                      tabIndex={0}
                      className="pane-divider"
                      onKeyDown={(e) => {
                        if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
                          e.preventDefault();
                          updateLayout((l) => ({
                            ...l,
                            splitRatio:
                              e.key === "Home"
                                ? 0.5
                                : Math.max(
                                    0.25,
                                    Math.min(
                                      0.75,
                                      l.splitRatio + (e.key === "ArrowRight" ? 0.05 : -0.05),
                                    ),
                                  ),
                          }));
                        }
                      }}
                      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                      onPointerMove={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          const box = e.currentTarget
                            .closest(".document-panes")!
                            .getBoundingClientRect();
                          updateLayout((l) => ({
                            ...l,
                            splitRatio: Math.max(
                              0.25,
                              Math.min(0.75, (e.clientX - box.left) / box.width),
                            ),
                          }));
                        }
                      }}
                      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                    />
                  )}
                  <DocumentPane
                    notify={notify}
                    pane={pane}
                    tab={document}
                    entry={paneEntry}
                    label={(path) => {
                      const t = tabs.find((t) => t.path === path);
                      return t ? tabName(t) : name(path);
                    }}
                    settings={settings}
                    root={root}
                    dark={dark}
                    focused={pane.id === layout.activePaneId}
                    split={layout.panes.length > 1}
                    focus={() => {
                      if (live.current.layout.activePaneId !== pane.id)
                        updateLayout((l) => ({ ...l, activePaneId: pane.id }));
                    }}
                    activate={(path) => setActive(path, pane.id)}
                    closePane={() =>
                      updateLayout((l) => {
                        const remaining = l.panes.filter((p) => p.id !== pane.id);
                        if (!remaining.length) return l;
                        remaining[0] = {
                          ...remaining[0],
                          tabs: [...new Set([...remaining[0].tabs, ...pane.tabs])],
                          views: { ...pane.views, ...remaining[0].views },
                        };
                        return { ...l, panes: remaining, activePaneId: remaining[0].id };
                      })
                    }
                    change={(path, value) => change(value, path)}
                    open={(path) => void open(path, true, pane.id)}
                    ask={(s) => {
                      setSelection(s);
                      setAssistant(true);
                    }}
                    updateView={(path, view) => updateView(pane.id, path, view)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>
      {assistant && (
        <Assistant
          key={root}
          vaultRoot={root}
          active={active}
          paths={context}
          tabs={tabs.map((t) => t.path)}
          selection={selection}
          add={(p) => setContext(p)}
          close={() => setAssistant(false)}
          notify={notify}
        />
      )}
      {switcher && (
        <QuickSwitcher
          entries={entries}
          recent={recent}
          close={() => setSwitcher(false)}
          open={(path, beside) => {
            setSwitcher(false);
            if (beside) openBeside(path);
            else void open(path, true);
          }}
        />
      )}
      {recoveryPreview &&
        (() => {
          const { expected, version, root: origin } = recoveryPreview;
          const check = () => {
            if (live.current.root !== origin)
              throw new Error("The active folder changed. Reopen the comparison.");
          };
          const disk = expected.disk;
          const actions = version
            ? [
                {
                  label: "Restore version",
                  primary: true,
                  run: async () => {
                    check();
                    await window.folio.checkpoint(expected.path, expected.value, origin);
                    const result = await window.folio.restore(
                      expected.path,
                      version.id,
                      expected.doc.hash,
                      origin,
                    );
                    check();
                    if (result.status === "conflict") {
                      setTabs((ts) =>
                        ts.map((t) => (t.id === expected.id ? { ...t, disk: result.disk } : t)),
                      );
                      throw new Error(
                        "The disk changed. Review the new conflict before restoring.",
                      );
                    }
                    finishRecovery(origin, expected, result.document);
                  },
                },
              ]
            : disk
              ? [
                  {
                    label: "Keep mine",
                    primary: true,
                    run: async () => {
                      check();
                      await save(expected.path, disk.hash);
                    },
                  },
                  {
                    label: "Use disk",
                    run: async () => {
                      check();
                      await window.folio.checkpoint(expected.path, expected.value, origin);
                      const latest = await window.folio.read(expected.path);
                      check();
                      if (latest.hash !== disk.hash)
                        throw new Error("The disk changed again. Reopen comparison.");
                      finishRecovery(origin, expected, latest);
                    },
                  },
                  {
                    label: "Keep both",
                    run: async () => {
                      check();
                      const copy = conflictCopyPath(expected.path);
                      await window.folio.create(copy, expected.value, origin);
                      check();
                      const latest = await window.folio.read(expected.path);
                      finishRecovery(origin, expected, latest);
                      await refresh();
                      check();
                      await open(copy, true);
                    },
                  },
                ]
              : [];
          return (
            <RecoveryDialog
              title={version ? "Review saved version" : "Resolve external change"}
              left={{ label: "Current working copy", text: expected.value }}
              right={{
                label: version
                  ? `${new Date(version.at).toLocaleString()} · ${version.author}`
                  : `On disk · ${new Date(disk?.modified || 0).toLocaleString()}`,
                text: version?.content || disk?.content || "",
              }}
              actions={actions}
              close={() => setRecoveryPreview(undefined)}
            />
          );
        })()}
      {workspacesOpen && root && (
        <Workspaces
          key={root}
          root={root}
          entries={entries}
          snapshot={workspaceSnapshot}
          apply={applyWorkspace}
          close={() => setWorkspacesOpen(false)}
        />
      )}
      {exportNote && exportNote.root === root && (
        <ExportDialog
          key={root}
          path={exportNote.path}
          content={exportNote.content}
          root={exportNote.root}
          notify={notify}
          close={() => setExportNote(undefined)}
        />
      )}
      {dialog === "settings" && (
        <Appearance
          settings={settings}
          change={setSettings}
          close={() => {
            setDialog(null);
            setSettingsSection("appearance");
          }}
          root={root}
          initialSection={settingsSection}
          syncChanged={() => void loadSync(root)}
        />
      )}
      {dialog && dialog !== "settings" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section
            className={`modal ${dialog === "history" ? "history-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={dialog}
          >
            <header>
              <h2>{dialog === "trash" ? "Trash" : "Version history"}</h2>
              <Button label="Close dialog" onClick={() => setDialog(null)}>
                <X />
              </Button>
            </header>
            {dialog === "history" ? (
              <div className="history-list">
                <p className="muted">Restoring saves the current version first.</p>
                {!versions.length && <p>No saved versions yet.</p>}
                {versions.map((v) => (
                  <div key={v.id}>
                    <span className="history-dot" />
                    <div>
                      <strong>{new Date(v.at).toLocaleString()}</strong>
                      <small>{v.author}</small>
                    </div>
                    <button
                      className="push"
                      onClick={() => {
                        if (tab) {
                          setRecoveryPreview({ root, expected: tab, version: v });
                          setDialog(null);
                        }
                      }}
                    >
                      <RotateCcw /> Review version
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="history-list">
                <p className="muted">
                  Deleted files stay here until you restore them. Automatic cleanup is not enabled.
                </p>
                {!trash.length && <p>Trash is empty.</p>}
                {trash.map((item) => (
                  <div key={item.id}>
                    <FileText />
                    <div>
                      <strong>{item.path}</strong>
                      <small>{new Date(item.deleted).toLocaleString()}</small>
                    </div>
                    <button
                      className="push"
                      onClick={() =>
                        void window.folio
                          .undelete(item.id, root)
                          .then(async () => {
                            setTrash(await window.folio.trashList());
                            await refresh();
                            notify("File restored.");
                          })
                          .catch((e) => notify(String(e)))
                      }
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
function Assistant({
  vaultRoot,
  active,
  paths,
  tabs,
  selection,
  add,
  close,
  notify,
}: {
  vaultRoot: string;
  active: string;
  paths: string[];
  tabs: string[];
  selection: string;
  add: (p: string[]) => void;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<AgentReply["proposals"]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const context = Array.from(new Set([active, ...paths].filter((p) => p && !excluded.includes(p))));
  return (
    <aside className="assistant">
      <header>
        <div className="seg">
          {(["claude", "codex"] as const).map((p) => (
            <button
              key={p}
              className={p === provider ? "active" : ""}
              onClick={() => setProvider(p)}
            >
              {p === "claude" ? "Claude" : "Codex"}
            </button>
          ))}
        </div>
        <span className="push" />
        <Button label="New chat" onClick={() => (setMessages([]), setProposals([]))}>
          <Plus />
        </Button>
        <Button label="Close assistant" onClick={close}>
          <X />
        </Button>
      </header>
      <div className="context">
        <h4>Context · {provider === "claude" ? "Claude" : "Codex"} can see</h4>
        <div className="chips">
          {context.map((p) => (
            <span className="chip" key={p}>
              <Icon path={p} />
              {name(p)}
              <button
                aria-label={`Remove ${p} from context`}
                onClick={() => {
                  setExcluded((e) => [...e, p]);
                  add(paths.filter((x) => x !== p));
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {selection && <span className="chip">Selected text · {selection.length} characters</span>}
          <button
            className="chip"
            onClick={() => {
              setExcluded([]);
              add(tabs);
            }}
          >
            + All open tabs ({tabs.length})
          </button>
        </div>
      </div>
      <div className="thread">
        {!messages.length ? (
          <div className="assistant-empty">
            <Sparkles size={24} />
            <h3>Ask about this vault</h3>
            <p>
              Only files listed in Context are shared. Changes will appear as proposals for you to
              review.
            </p>
            {[
              "Summarize this note",
              "Help me connect these ideas",
              "Suggest a clearer structure",
            ].map((s) => (
              <button key={s} onClick={() => setPrompt(s)}>
                {s} <ChevronRight size={14} />
              </button>
            ))}
            <small>
              Uses your signed-in CLI in an isolated sandbox. Only send when you choose.
            </small>
          </div>
        ) : (
          messages.map((m, i) => (
            <div className={`message ${m.role}`} key={i}>
              {m.role === "assistant" && (
                <strong>✦ {provider === "claude" ? "Claude" : "Codex"}</strong>
              )}
              <p>{m.text}</p>
            </div>
          ))
        )}
        {proposals.map((proposal, i) => (
          <Proposal
            key={i}
            proposal={proposal}
            vaultRoot={vaultRoot}
            onApplied={() => notify("Proposal applied. The vault watcher will refresh the file.")}
          />
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!prompt.trim() || busy) return;
          setMessages((m) => [...m, { role: "user", text: prompt }]);
          setBusy(true);
          void window.folio
            .agent(
              provider,
              `${prompt}${selection ? `\nSelected text:\n${selection}` : ""}`,
              context,
              vaultRoot,
            )
            .then((reply) => {
              setMessages((m) => [...m, { role: "assistant", text: reply.text }]);
              setProposals(reply.proposals);
              setPrompt("");
            })
            .catch((e) => {
              setMessages((m) => [...m, { role: "assistant", text: String(e) }]);
              notify("Assistant is not connected.");
            })
            .finally(() => setBusy(false));
        }}
      >
        <textarea
          placeholder="Ask, or type @ to add a file"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        <footer>
          <AtSign size={16} />
          <small>Reads context · proposes changes</small>
          <button className="send push" disabled={!prompt.trim() || busy} aria-label="Send message">
            <ArrowUp size={17} />
          </button>
        </footer>
      </form>
    </aside>
  );
}
