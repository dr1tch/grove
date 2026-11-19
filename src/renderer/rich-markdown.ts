import { Extension, Node, getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { codeBlocks, replaceCodeBlock } from "@grove/core/code-block";

export const GroveCode = Node.create({
  name: "groveCode",
  group: "block",
  atom: true,
  defining: true,
  addAttributes: () => ({
    body: { default: "" },
    language: { default: "" },
    original: { default: "" },
  }),
  parseHTML: () => [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (element) => ({
        body: element.textContent ?? "",
        language: element.querySelector("code")?.className.replace("language-", "") ?? "",
      }),
    },
  ],
  renderHTML: ({ node }) => ["pre", {}, ["code", {}, node.attrs.body]],
  renderText: ({ node }) => node.attrs.body,
  markdownTokenName: "code",
  parseMarkdown: (token) => ({
    type: "groveCode",
    attrs: {
      body: token.text ?? "",
      language: (token.lang ?? "").split(/\s+/)[0],
      original: token.raw ?? "",
    },
  }),
  renderMarkdown: (node) => {
    const body = String(node.attrs?.body ?? ""),
      original = String(node.attrs?.original ?? "");
    const block = codeBlocks(original)[0];
    if (block) return replaceCodeBlock(original, original, block.line, body).replace(/\r?\n$/, "");
    const fence = "`".repeat(
      Math.max(3, ...[...(body.match(/`+/g) ?? [])].map((run) => run.length + 1)),
    );
    return `${fence}${node.attrs?.language ?? ""}\n${body}\n${fence}`;
  },
});
export const GroveRaw = Node.create({
  name: "groveRaw",
  group: "block",
  atom: true,
  defining: true,
  addAttributes: () => ({ raw: { default: "" }, kind: { default: "raw" } }),
  parseHTML: () => [
    { tag: "div[data-grove-raw]", getAttrs: (element) => ({ raw: element.textContent ?? "" }) },
  ],
  renderHTML: ({ node }) => ["div", { "data-grove-raw": "" }, ["pre", {}, node.attrs.raw]],
  renderText: ({ node }) => node.attrs.raw,
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});
export const GroveWiki = Node.create({
  name: "groveWiki",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [
    {
      tag: "span[data-grove-wiki]",
      getAttrs: (element) => ({ raw: element.getAttribute("data-grove-wiki") ?? "" }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    { "data-grove-wiki": node.attrs.raw, class: "rich-wiki", contenteditable: "false" },
    wikiLabel(node.attrs.raw),
  ],
  renderText: ({ node }) => node.attrs.raw,
  markdownTokenizer: {
    name: "groveWiki",
    level: "inline",
    start: (source) => source.search(/!?\[\[/),
    tokenize: (source) => {
      const match = /^!?\[\[[^\]]+\]\]/.exec(source);
      return match ? { type: "groveWiki", raw: match[0] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "groveWiki", attrs: { raw: token.raw } }),
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});
export const GroveImage = Node.create({
  name: "groveImage",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    src: { default: "" },
    alt: { default: "" },
    title: { default: null },
    raw: { default: "" },
  }),
  parseHTML: () => [
    {
      tag: "img[src]",
      getAttrs: (element) => ({
        src: element.getAttribute("src") ?? "",
        alt: element.getAttribute("alt") ?? "",
        title: element.getAttribute("title"),
      }),
    },
  ],
  renderHTML: ({ node }) => ["span", { "data-grove-image": "" }, node.attrs.alt || "Image"],
  renderText: ({ node }) => node.attrs.alt || "Image",
  markdownTokenName: "image",
  parseMarkdown: (token) => ({
    type: "groveImage",
    attrs: {
      src: token.href ?? "",
      alt: token.text ?? "",
      title: token.title ?? null,
      raw: token.raw ?? "",
    },
  }),
  renderMarkdown: (node) => {
    if (node.attrs?.raw) return String(node.attrs.raw);
    const alt = String(node.attrs?.alt ?? "").replace(/[\\[\]]/g, "\\$&");
    const src = String(node.attrs?.src ?? "").replace(/[<>\r\n]/g, "");
    return `![${alt}](<${src}>)`;
  },
});
export function wikiLabel(raw: string): string {
  const parts = raw
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|");
  return parts[1] || parts[0];
}
const GroveInline = Node.create({
  name: "groveInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [
    {
      tag: "span[data-grove-inline]",
      getAttrs: (element) => ({ raw: element.getAttribute("data-grove-inline") ?? "" }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    {
      "data-grove-inline": node.attrs.raw,
      contenteditable: "false",
      class: "rich-preserved-inline",
    },
    String(node.attrs.raw).startsWith("<!--") ? "" : node.attrs.raw,
  ],
  renderText: ({ node }) => node.attrs.raw,
  markdownTokenizer: {
    name: "groveInline",
    level: "inline",
    start: (source) => source.indexOf("<"),
    tokenize: (source) => {
      const match = /^(?:<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*|\/?)>)/.exec(source);
      return match ? { type: "groveInline", raw: match[0] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "groveInline", attrs: { raw: token.raw } }),
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});
const Provenance = Extension.create({
  name: "groveProvenance",
  addGlobalAttributes: () => [
    {
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "bulletList",
        "orderedList",
        "taskList",
        "table",
        "horizontalRule",
        "groveCode",
        "groveRaw",
      ],
      attributes: { sourceId: { default: null, rendered: false, parseHTML: () => null } },
    },
  ],
});
const GroveLink = Link.extend({
  renderMarkdown: (node, helpers) => {
    const href = String(node.attrs?.href ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/</g, "\\<")
      .replace(/>/g, "\\>")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    const title =
      node.attrs?.title == null
        ? ""
        : ` "${String(node.attrs.title).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return `[${helpers.renderChildren(node)}](<${href}>${title})`;
  },
}).configure({ openOnClick: false });

export const richExtensions = [
  StarterKit.configure({ codeBlock: false, trailingNode: false, link: false }),
  GroveLink,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  GroveCode,
  GroveRaw,
  GroveWiki,
  GroveInline,
  GroveImage,
  Provenance,
  Markdown.configure({ markedOptions: { gfm: true } }),
];

type Original = { raw: string; before: string; json: string };
export class RichMarkdownModel {
  readonly document: JSONContent;
  #originals = new Map<string, Original>();
  #manager = new MarkdownManager({ extensions: richExtensions });
  #tail: string;
  #source: string;
  #initial: string;
  #leading = "";
  constructor(source: string) {
    this.#source = source;
    const properties = /^(?:\uFEFF)?(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?=\r?\n|$)/.exec(source);
    const bodyOffset = properties?.[0].length ?? 0;
    const root = fromMarkdown(source.slice(bodyOffset), {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      }),
      content: JSONContent[] = [];
    const definitions = root.children
      .filter((node) => node.type === "definition")
      .map((node) =>
        source.slice(
          bodyOffset + node.position!.start.offset!,
          bodyOffset + node.position!.end.offset!,
        ),
      )
      .join("\n");
    let cursor = 0,
      index = 0;
    const add = (from: number, to: number, kind: string, media = false) => {
      const raw = source.slice(from, to),
        before = source.slice(cursor, from);
      const opaque =
        ["html", "definition", "properties"].includes(kind) ||
        media ||
        /^!\[\[[^\]]+\]\]$/.test(raw.trim());
      const parsed = opaque
        ? [{ type: "groveRaw", attrs: { raw, kind } }]
        : (this.#manager.parse(raw + (definitions ? `\n\n${definitions}` : "")).content ?? []);
      // A section with an unsupported parse stays an opaque source block.
      const nodes = parsed.length === 1 ? parsed : [{ type: "groveRaw", attrs: { raw, kind } }];
      const id = `source-${index++}`,
        node = { ...nodes[0], attrs: { ...nodes[0].attrs, sourceId: id } };
      content.push(node);
      this.#originals.set(id, { raw, before, json: "" });
      cursor = to;
    };
    if (properties) add(0, properties[0].length, "properties");
    for (const node of root.children) {
      const from = node.position?.start.offset,
        to = node.position?.end.offset;
      if (from === undefined || to === undefined) continue;
      add(
        bodyOffset + from,
        bodyOffset + to,
        node.type,
        node.type === "paragraph" &&
          node.children.length === 1 &&
          node.children[0].type === "image",
      );
    }
    this.#tail = source.slice(cursor);
    const first = this.#originals.values().next().value;
    if (first) {
      this.#leading = first.before;
      first.before = "";
    }
    this.document = getSchema(richExtensions)
      .nodeFromJSON({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] })
      .toJSON();
    for (const node of this.document.content ?? []) {
      const original = this.#originals.get(node.attrs?.sourceId);
      if (original) original.json = JSON.stringify(node);
    }
    this.#initial = JSON.stringify(this.document);
  }
  serialize(document: JSONContent): string {
    if (JSON.stringify(document) === this.#initial) return this.#source;
    const eol = this.#source.includes("\r\n") ? "\r\n" : "\n";
    const seen = new Set<string>();
    return (
      this.#leading +
      (document.content ?? [])
        .map((node, index) => {
          const original = this.#originals.get(node.attrs?.sourceId);
          const prefix =
            (seen.has(node.attrs?.sourceId) ? "" : original?.before) || (index ? eol + eol : "");
          if (original) seen.add(node.attrs?.sourceId);
          if (original?.json === JSON.stringify(node)) return prefix + original.raw;
          const rendered = this.#manager
            .serialize({ type: "doc", content: [node] })
            .replace(/\r?\n/g, eol);
          return prefix + (node.type === "table" ? rendered.trim() : rendered);
        })
        .join("") +
      this.#tail
    );
  }
}
