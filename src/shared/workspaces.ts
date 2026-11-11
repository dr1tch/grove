import type { WorkspacePreset } from "./types";
import { cleanLayout, renameLayout } from "./panes";
import { cleanState } from "./state";
export function cleanPresets(value: unknown, root: string): WorkspacePreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v) =>
        v &&
        typeof v === "object" &&
        v.vaultRoot === root &&
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        v.name.trim(),
    )
    .slice(0, 100)
    .map((v) => ({
      id: v.id.slice(0, 100),
      name: v.name.trim().slice(0, 80),
      vaultRoot: root,
      layout: cleanLayout(v.layout),
      tabs: cleanState({ tabs: v.tabs }).tabs || [],
      expandedFolders: Array.isArray(v.expandedFolders)
        ? v.expandedFolders
            .filter((p: unknown): p is string => typeof p === "string")
            .slice(0, 10000)
        : [],
      sidebar: v.sidebar !== false,
      sidebarWidth: cleanState({ sidebarWidth: v.sidebarWidth }).sidebarWidth || 268,
      assistant: v.assistant === true,
    }));
}
export function migratePresets(
  presets: WorkspacePreset[],
  from: string,
  to: string,
): WorkspacePreset[] {
  const rename = (path: string) =>
    path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
  return presets.map((p) => ({
    ...p,
    layout: renameLayout(p.layout, from, to),
    tabs: p.tabs.map((t) => ({ ...t, path: rename(t.path) })),
    expandedFolders: p.expandedFolders.map(rename),
  }));
}
