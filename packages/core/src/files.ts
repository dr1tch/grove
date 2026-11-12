import type { Kind } from "./types";

const languages: Record<string, string> = {};
for (const [language, extensions] of Object.entries({
  javascript: "js mjs cjs",
  jsx: "jsx",
  typescript: "ts mts cts",
  tsx: "tsx",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  json: "json map",
  jsonc: "jsonc",
  yaml: "yaml yml",
  toml: "toml",
  ini: "ini cfg conf properties editorconfig env",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html htm xhtml",
  xml: "xml xsd xsl xslt plist svg",
  python: "py pyw pyi",
  ruby: "rb rake gemspec",
  shellscript: "sh bash zsh fish",
  powershell: "ps1 psm1 psd1",
  bat: "bat cmd",
  rust: "rs",
  go: "go",
  java: "java",
  kotlin: "kt kts",
  swift: "swift",
  c: "c h",
  cpp: "cpp cc cxx hpp hh hxx",
  csharp: "cs",
  fsharp: "fs fsx",
  "objective-c": "m mm",
  php: "php phtml",
  dart: "dart",
  lua: "lua",
  perl: "pl pm",
  r: "r rmd",
  julia: "jl",
  scala: "scala sc",
  clojure: "clj cljs cljc edn",
  elixir: "ex exs",
  erlang: "erl hrl",
  haskell: "hs lhs",
  ocaml: "ml mli",
  sql: "sql",
  graphql: "graphql gql",
  protobuf: "proto",
  terraform: "tf tfvars",
  dockerfile: "dockerfile",
  makefile: "mk makefile",
  cmake: "cmake",
  diff: "diff patch",
  markdown: "md markdown mdx",
  latex: "tex sty bib",
  text: "txt text log csv tsv rst adoc asciidoc nfo out lock gitignore gitattributes gitmodules npmrc nvmrc browserslistrc",
})) {
  for (const extension of extensions.split(" ")) languages[extension] = language;
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop()!.toLowerCase();
}
function extension(path: string): string {
  const name = basename(path);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
}

export function languageOf(path: string): string {
  const name = basename(path);
  if (/^dockerfile(?:\.|$)/.test(name)) return "dockerfile";
  if (/^(?:makefile|gnumakefile)(?:\.|$)/.test(name)) return "makefile";
  if (name === "cmakelists.txt") return "cmake";
  if (/^\.env(?:\.|$)/.test(name)) return "ini";
  if (["license", "licence", "readme", "authors", "notice", "changelog", "copying"].includes(name))
    return "text";
  return languages[extension(path)] ?? "text";
}

export function kindOf(path: string): Kind {
  const name = basename(path);
  const ext = extension(path);
  if (
    [
      "exe",
      "dll",
      "so",
      "dylib",
      "bin",
      "wasm",
      "o",
      "obj",
      "class",
      "pyc",
      "pyo",
      "zip",
      "gz",
      "bz2",
      "xz",
      "zst",
      "tar",
      "7z",
      "rar",
      "jar",
      "war",
      "deb",
      "rpm",
      "dmg",
      "iso",
      "db",
      "sqlite",
      "sqlite3",
      "woff",
      "woff2",
      "ttf",
      "otf",
    ].includes(ext)
  )
    return "unsupported";
  if (name.endsWith(".excalidraw") || name.endsWith(".excalidraw.md")) return "drawing";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (ext === "pdf") return "pdf";
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "avif",
      "bmp",
      "ico",
      "tif",
      "tiff",
      "heic",
      "heif",
    ].includes(ext)
  )
    return "image";
  if (
    [
      "doc",
      "docx",
      "docm",
      "xls",
      "xlsx",
      "xlsm",
      "ppt",
      "pptx",
      "pptm",
      "odt",
      "ods",
      "odp",
      "rtf",
    ].includes(ext)
  )
    return "office";
  if (
    ["mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "opus", "aiff", "aif", "wma"].includes(ext)
  )
    return "audio";
  if (["mp4", "m4v", "webm", "mov", "mkv", "avi", "ogv", "mpeg", "mpg", "wmv"].includes(ext))
    return "video";
  if (
    Object.hasOwn(languages, ext) ||
    languageOf(path) !== "text" ||
    ["license", "licence", "readme", "authors", "notice", "changelog", "copying"].includes(name)
  )
    return "text";
  return "unsupported";
}
