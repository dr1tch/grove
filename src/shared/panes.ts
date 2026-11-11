import type { PaneState, TabState, ViewState, WorkspaceLayout } from "./types";
const number = (value: unknown, fallback = 0, min = 0, max = 1e8) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function cleanView(value: unknown): ViewState {
  const v = record(value),
    selection = record(v.selection),
    media = record(v.media);
  return {
    mode: v.mode === "edit" || v.mode === "split" ? v.mode : "preview",
    editorScroll: number(v.editorScroll),
    previewScroll: number(v.previewScroll),
    page: Math.floor(number(v.page, 1, 1)),
    ...(v.selection
      ? {
          selection: {
            anchor: Math.floor(number(selection.anchor)),
            head: Math.floor(number(selection.head)),
          },
        }
      : {}),
    ...(v.media
      ? {
          media: {
            fit: media.fit !== false,
            scale: number(media.scale, 1, 0.01, 20),
            scrollLeft: number(media.scrollLeft),
            scrollTop: number(media.scrollTop),
          },
        }
      : {}),
  };
}
export function cleanLayout(value: unknown, tabs: TabState[] = [], active = ""): WorkspaceLayout {
  const v = record(value);
  const raw =
    Array.isArray(v.panes) && v.panes.length
      ? v.panes.slice(0, 2)
      : [
          {
            id: "primary",
            tabs: tabs.map((t) => t.path),
            active,
            views: Object.fromEntries(tabs.map((t) => [t.path, { mode: t.mode }])),
          },
        ];
  const panes: PaneState[] = raw.map((item, i) => {
    const p = record(item),
      views = record(p.views);
    const paths = Array.isArray(p.tabs)
      ? [...new Set(p.tabs.filter((p): p is string => typeof p === "string" && !!p))].slice(0, 100)
      : [];
    return {
      id: i === 0 ? "primary" : "secondary",
      tabs: paths,
      active: typeof p.active === "string" && paths.includes(p.active) ? p.active : paths[0] || "",
      views: Object.fromEntries(paths.map((path) => [path, cleanView(views[path])])),
    };
  });
  return {
    panes,
    activePaneId: panes.some((p) => p.id === v.activePaneId) ? String(v.activePaneId) : panes[0].id,
    splitRatio: number(v.splitRatio, 0.5, 0.25, 0.75),
  };
}
export function pruneLayout(layout: WorkspaceLayout, paths: string[]): WorkspaceLayout {
  const valid = new Set(paths);
  return {
    ...layout,
    panes: layout.panes.map((p) => ({
      ...p,
      tabs: p.tabs.filter((path) => valid.has(path)),
      active: valid.has(p.active) ? p.active : p.tabs.find((path) => valid.has(path)) || "",
      views: Object.fromEntries(Object.entries(p.views).filter(([path]) => valid.has(path))),
    })),
  };
}
export function renameLayout(layout: WorkspaceLayout, from: string, to: string): WorkspaceLayout {
  const rename = (path: string) =>
    path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
  return {
    ...layout,
    panes: layout.panes.map((p) => ({
      ...p,
      tabs: p.tabs.map(rename),
      active: rename(p.active),
      views: Object.fromEntries(
        Object.entries(p.views).map(([path, view]) => [rename(path), view]),
      ),
    })),
  };
}
