import { kindOf, languageOf } from "./files";
export type FileIconSpec = { label: string; mark: string; color: string };
export function fileIconSpec(path: string): FileIconSpec {
  const name = (path.split("/").pop() || path).toLowerCase();
  const ext = name.split(".").pop() || "";
  const kind = kindOf(path);
  const known: Record<string, FileIconSpec> = {
    vue: { label: "Vue component", mark: "V", color: "green" },
    svelte: { label: "Svelte component", mark: "S", color: "orange" },
    astro: { label: "Astro component", mark: "A", color: "purple" },
    js: { label: "JavaScript", mark: "JS", color: "yellow" },
    jsx: { label: "React JavaScript", mark: "⚛", color: "cyan" },
    ts: { label: "TypeScript", mark: "TS", color: "blue" },
    tsx: { label: "React TypeScript", mark: "⚛", color: "blue" },
    json: { label: "JSON", mark: "{}", color: "yellow" },
    jsonc: { label: "JSON", mark: "{}", color: "yellow" },
    py: { label: "Python", mark: "Py", color: "blue" },
    css: { label: "CSS stylesheet", mark: "#", color: "blue" },
    scss: { label: "Sass stylesheet", mark: "#", color: "pink" },
    html: { label: "HTML document", mark: "<>", color: "orange" },
    rs: { label: "Rust source", mark: "R", color: "orange" },
    go: { label: "Go source", mark: "Go", color: "cyan" },
    sh: { label: "Shell script", mark: "$_", color: "green" },
    yaml: { label: "YAML configuration", mark: "Y", color: "purple" },
    yml: { label: "YAML configuration", mark: "Y", color: "purple" },
    toml: { label: "TOML configuration", mark: "T", color: "purple" },
    csv: { label: "CSV table", mark: "▦", color: "green" },
    tsv: { label: "TSV table", mark: "▦", color: "green" },
    pdf: { label: "PDF document", mark: "PDF", color: "red" },
    doc: { label: "Word document", mark: "W", color: "blue" },
    docx: { label: "Word document", mark: "W", color: "blue" },
    odt: { label: "Text document", mark: "W", color: "blue" },
    rtf: { label: "Rich text", mark: "W", color: "blue" },
    xls: { label: "Spreadsheet", mark: "X", color: "green" },
    xlsx: { label: "Spreadsheet", mark: "X", color: "green" },
    ods: { label: "Spreadsheet", mark: "X", color: "green" },
    ppt: { label: "Presentation", mark: "P", color: "orange" },
    pptx: { label: "Presentation", mark: "P", color: "orange" },
    odp: { label: "Presentation", mark: "P", color: "orange" },
  };
  if (known[ext]) return known[ext];
  if (kind === "markdown") return { label: "Markdown note", mark: "M↓", color: "blue" };
  if (kind === "drawing") return { label: "Excalidraw drawing", mark: "◇", color: "purple" };
  if (kind === "image") return { label: "Image", mark: "image", color: "pink" };
  if (kind === "audio") return { label: "Audio", mark: "audio", color: "purple" };
  if (kind === "video") return { label: "Video", mark: "video", color: "orange" };
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext))
    return { label: "Archive", mark: "archive", color: "orange" };
  const lang = languageOf(path);
  return {
    label: kind === "text" && lang !== "text" ? `${lang} source` : "File",
    mark: kind === "text" && lang !== "text" ? "<>" : "",
    color: "muted",
  };
}
