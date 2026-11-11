import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type { LinkRef } from "./types";
const movedPath = (path: string, from: string, to: string) =>
  path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
export function resolveLink(
  source: string,
  raw: string,
  files: string[],
  wiki = false,
): { path: string; fragment: string; ambiguous: boolean } | null {
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw)) return null;
  const hash = raw.indexOf("#"),
    fragment = hash >= 0 ? raw.slice(hash) : "";
  let target = hash >= 0 ? raw.slice(0, hash) : raw;
  try {
    target = decodeURIComponent(target.replace(/\\([\\()[\]<> ])/g, "$1"));
  } catch {
    return null;
  }
  if (!target) return { path: source, fragment, ambiguous: false };
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const candidate = parts.join("/");
  if (files.includes(candidate)) return { path: candidate, fragment, ambiguous: false };
  if (wiki) {
    if (files.includes(candidate + ".md"))
      return { path: candidate + ".md", fragment, ambiguous: false };
    const matches = files.filter(
      (path) => path.split("/").pop() === target || path.split("/").pop() === target + ".md",
    );
    if (matches.length === 1) return { path: matches[0], fragment, ambiguous: false };
    if (matches.length > 1) return { path: candidate, fragment, ambiguous: true };
  }
  return { path: candidate, fragment, ambiguous: false };
}
function destination(raw: string, definition: boolean): [number, number] | null {
  let cursor = 0,
    depth = 0;
  for (; cursor < raw.length; cursor++) {
    if (raw[cursor] === "\\") {
      cursor++;
      continue;
    }
    if (raw[cursor] === "[") depth++;
    if (raw[cursor] === "]" && --depth === 0) {
      cursor++;
      break;
    }
  }
  if (raw[cursor] !== (definition ? ":" : "(")) return null;
  cursor++;
  while (/\s/.test(raw[cursor] || "") && cursor < raw.length) cursor++;
  const angle = raw[cursor] === "<";
  if (angle) cursor++;
  const start = cursor;
  depth = 0;
  for (; cursor < raw.length; cursor++) {
    const char = raw[cursor];
    if (char === "\\") {
      cursor++;
      continue;
    }
    if (angle && char === ">") break;
    if (!angle) {
      if (char === "(") depth++;
      if (char === ")") {
        if (!depth) break;
        depth--;
      }
      if (/\s/.test(char) && !depth) break;
    }
  }
  return [start, cursor];
}
export function parseLinks(sourcePath: string, text: string, files: string[]): LinkRef[] {
  const refs: LinkRef[] = [];
  const add = (from: number, to: number, syntax: LinkRef["syntax"]) => {
    const raw = text.slice(from, to),
      resolved = resolveLink(sourcePath, raw, files, syntax === "wiki");
    if (resolved)
      refs.push({
        sourcePath,
        targetPath: resolved.path,
        fragment: resolved.fragment,
        from,
        to,
        raw,
        syntax,
        missing: !files.includes(resolved.path),
        ambiguous: resolved.ambiguous,
      });
  };
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (node.type === "link" || node.type === "image" || node.type === "definition") {
        const range = destination(text.slice(start, end), node.type === "definition");
        if (range)
          add(
            start + range[0],
            start + range[1],
            node.type === "definition" ? "definition" : "markdown",
          );
      }
      if (node.type === "text")
        for (const match of text.slice(start, end).matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
          if (text[start + match.index - 1] === "\\") continue;
          const from = start + match.index + (match[0].startsWith("!") ? 3 : 2);
          add(from, from + match[1].length, "wiki");
        }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(text));
  return refs.sort((a, b) => a.from - b.from);
}
export function relativeTarget(source: string, target: string): string {
  const from = source.split("/").slice(0, -1),
    to = target.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}
export function renameReferences(
  source: string,
  text: string,
  files: string[],
  from: string,
  to: string,
): string {
  const nextSource = movedPath(source, from, to);
  for (const ref of parseLinks(source, text, files).reverse()) {
    if (ref.missing || ref.ambiguous || ref.raw.startsWith("#")) continue;
    const nextTarget = movedPath(ref.targetPath, from, to);
    if (nextSource === source && nextTarget === ref.targetPath) continue;
    const relative = relativeTarget(nextSource, nextTarget);
    const replacement =
      (ref.syntax === "wiki"
        ? relative
        : relative
            .split("/")
            .map((part) =>
              encodeURIComponent(part).replace(
                /[!'()*]/g,
                (char) => `%${char.charCodeAt(0).toString(16)}`,
              ),
            )
            .join("/")) + ref.fragment;
    text = text.slice(0, ref.from) + replacement + text.slice(ref.to);
  }
  return text;
}
/** Converts Obsidian wikilinks to Markdown the preview renders. Targets go in <…> so names with spaces still parse. */
export function wikiToMarkdown(value: string): string {
  const target = (path: string) => `<${path.replace(/[<>\n]/g, "")}>`;
  return value
    .replace(/!\[\[([^\]]+)\]\]/g, (_m, p: string) =>
      /\.excalidraw(?:\.md)?$/i.test(p)
        ? `[✎ Open drawing: ${p}](${target(`folio-drawing:${p}`)})`
        : `![${p}](${target(p)})`,
    )
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, p: string, alias: string) => `[${alias || p}](${target(`folio-note:${p}`)})`,
    );
}
