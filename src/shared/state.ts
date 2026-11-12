import type { AppState, Settings, TabState } from "./types";
export function cleanState(value: unknown): AppState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const result: AppState = {};
  if (typeof v.vault === "string") result.vault = v.vault;
  if (typeof v.active === "string") result.active = v.active;
  if (typeof v.sidebarWidth === "number" && Number.isFinite(v.sidebarWidth))
    result.sidebarWidth = Math.max(190, Math.min(520, v.sidebarWidth));
  if (typeof v.sidebar === "boolean") result.sidebar = v.sidebar;
  if (typeof v.assistant === "boolean") result.assistant = v.assistant;
  if (typeof v.maximized === "boolean") result.maximized = v.maximized;
  if (Array.isArray(v.tabs))
    result.tabs = v.tabs
      .filter(
        (t): t is TabState =>
          !!t && typeof t.path === "string" && ["edit", "preview", "split"].includes(t.mode),
      )
      .slice(0, 100);
  const settings = v.settings as Record<string, unknown> | undefined;
  if (settings && typeof settings === "object")
    result.settings = {
      theme: ["light", "dark", "system"].includes(String(settings.theme))
        ? settings.theme
        : "system",
      accent: ["emerald", "pine", "indigo", "plum", "graphite", "terracotta"].includes(
        String(settings.accent),
      )
        ? settings.accent
        : "emerald",
      font: ["serif", "sans", "mono", "local"].includes(String(settings.font))
        ? settings.font
        : "serif",
      localFont:
        typeof settings.localFont === "string" ? settings.localFont.slice(0, 150) : "system-ui",
      fontSize:
        typeof settings.fontSize === "number" && Number.isFinite(settings.fontSize)
          ? Math.max(10, Math.min(28, settings.fontSize))
          : 14,
      readingWidth: [0, 600, 680, 780, 960, 1200].includes(Number(settings.readingWidth))
        ? Number(settings.readingWidth)
        : 680,
    } as Settings;
  const b = v.bounds as Record<string, unknown> | undefined;
  if (
    b &&
    typeof b === "object" &&
    typeof b.width === "number" &&
    typeof b.height === "number" &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height)
  )
    result.bounds = {
      width: Math.max(1000, Math.min(7680, b.width)),
      height: Math.max(640, Math.min(4320, b.height)),
      ...(typeof b.x === "number" &&
      typeof b.y === "number" &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y)
        ? { x: b.x, y: b.y }
        : {}),
    };
  const sync = v.sync as Record<string, unknown> | undefined;
  if (sync && typeof sync === "object" && !Array.isArray(sync))
    result.sync = Object.fromEntries(
      Object.entries(sync)
        .filter(([, e]) => !!e && typeof e === "object" && typeof (e as any).enabled === "boolean")
        .map(([root, e]) => [root, { enabled: (e as { enabled: boolean }).enabled }]),
    );
  return result;
}
