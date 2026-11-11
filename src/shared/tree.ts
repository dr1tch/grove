import type { Entry } from "./types";
export type FolderStyle =
  | "code"
  | "docs"
  | "notes"
  | "images"
  | "design"
  | "media"
  | "tests"
  | "config"
  | "archive"
  | "packages"
  | "people"
  | "projects"
  | "default";
export function folderStyle(path: string): FolderStyle {
  const name = (path.split("/").pop() || "").toLowerCase().replace(/[_ -]/g, "");
  if (
    /^(src|source|code|components|composables|hooks|lib|utils|scripts|api|backend|frontend)$/.test(
      name,
    )
  )
    return "code";
  if (/^(docs?|documents?|documentation|guides?|manuals?|reading|books?|research)$/.test(name))
    return "docs";
  if (/^(notes?|journal|journals|daily|knowledge|vault|ideas?|drafts?)$/.test(name)) return "notes";
  if (/^(images?|photos?|pictures?|screenshots?)$/.test(name)) return "images";
  if (/^(designs?|assets|styles?|themes?|ui|ux|icons?)$/.test(name)) return "design";
  if (/^(media|videos?|audio|music|recordings?)$/.test(name)) return "media";
  if (/^(tests?|testing|specs?|fixtures|qa|__tests__)$/.test(name)) return "tests";
  if (/^(config|configuration|settings|configs|env)$/.test(name)) return "config";
  if (/^(archive|archives|old|backups?|trash)$/.test(name)) return "archive";
  if (/^(packages?|modules?|plugins?|extensions|vendor|dependencies)$/.test(name))
    return "packages";
  if (/^(people|users?|team|contacts|personal)$/.test(name)) return "people";
  if (/^(projects?|work|workspace|workspaces|clients?)$/.test(name)) return "projects";
  return "default";
}
export function entryPath(parent: string, name: string, type: "file" | "folder"): string {
  const value = name.trim();
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value) || value.startsWith("."))
    throw new Error("Use a name without slashes or a leading dot.");
  const filename = type === "file" && !value.includes(".") ? `${value}.md` : value;
  return parent ? `${parent}/${filename}` : filename;
}
export function suggestedName(
  entries: Entry[],
  parent: string,
  type: "file" | "folder",
  drawing = false,
): string {
  const base = type === "folder" ? "Untitled folder" : "Untitled";
  const ext = type === "file" ? (drawing ? ".excalidraw" : ".md") : "";
  let name = base + ext;
  let index = 1;
  while (entries.some((e) => e.path === (parent ? `${parent}/` : "") + name))
    name = `${base} ${index++}${ext}`;
  return name;
}
