import { parse, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import type { Vault } from "./vault";
import type { ExportRequest } from "../shared/types";
import { assetBytes } from "./assets";
import { resolveLink } from "../shared/links";
import { staticTags } from "./html-preview";
export const exportCSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const exportLimit = 100 * 1024 * 1024;
const svgTags = new Set(
  "marker pattern filter feGaussianBlur feOffset feMerge feMergeNode feBlend feColorMatrix feFlood feComposite symbol use image desc foreignObject".split(
    " ",
  ),
);
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
export async function portableDocument(
  vault: Vault,
  request: ExportRequest,
  rendered: string,
  css: string,
): Promise<{ html: string; warnings: string[] }> {
  const warnings = new Set<string>(),
    document = parse(rendered),
    paths = (await vault.list()).map((e) => e.path),
    cache = new Map<string, string>();
  let size = Buffer.byteLength(rendered) + Buffer.byteLength(css);
  const resource = async (raw: string, image: boolean) => {
    if (raw.startsWith("data:")) {
      if (image && !/^data:image\//i.test(raw)) throw new Error("Invalid embedded image");
      return raw;
    }
    let path: string;
    if (raw.startsWith("folio://app/_export/"))
      path = decodeURIComponent(new URL(raw).pathname.split("/").slice(3).join("/"));
    else {
      const wiki = raw.startsWith("folio-note:");
      const link = resolveLink(request.path, raw.replace(/^folio-note:/, ""), paths, wiki);
      if (!link) throw new Error(`External asset omitted: ${raw}`);
      path = link.path;
    }
    if (cache.has(path)) return cache.get(path)!;
    const info = await vault.info(path);
    if (image && !info.mime.startsWith("image/")) throw new Error(`Not an image: ${path}`);
    if (size + Math.ceil(info.size / 3) * 4 > exportLimit)
      throw new Error(`${path} omitted: total embedded size would exceed 100 MiB`);
    const data = await assetBytes(vault, path, undefined, exportLimit);
    const encoded = `data:${info.mime};base64,${data.toString("base64")}`;
    size += encoded.length;
    cache.set(path, encoded);
    return encoded;
  };
  const walk = async (parent: Tree.ParentNode) => {
    for (const node of parent.childNodes) {
      if (!("tagName" in node)) continue;
      const element = node as Tree.Element,
        tag = element.tagName;
      if (
        (!staticTags.has(tag) && !svgTags.has(tag)) ||
        ["button", "form", "input", "textarea", "select", "meta"].includes(tag)
      ) {
        parent.childNodes = parent.childNodes.filter((n) => n !== node);
        continue;
      }
      const attrs = [];
      for (const attr of element.attrs) {
        const name = attr.name.toLowerCase();
        if (
          name.startsWith("on") ||
          ["srcdoc", "srcset", "action", "formaction", "ping", "autofocus", "target"].includes(name)
        )
          continue;
        if ((name === "src" && tag === "img") || (name === "href" && tag === "image")) {
          try {
            attrs.push({ ...attr, value: await resource(attr.value, true) });
          } catch (error) {
            warnings.add(String(error));
            attrs.push({ name: "alt", value: `Image omitted: ${attr.value}` });
          }
          continue;
        }
        if (name === "href") {
          if (attr.value.startsWith("#") || /^(https?:|mailto:)/i.test(attr.value)) {
            attrs.push(attr);
            continue;
          }
          if (tag === "a" && request.format === "html") {
            try {
              attrs.push(
                { ...attr, value: await resource(attr.value, false) },
                {
                  name: "download",
                  value: decodeURIComponent(attr.value.split("/").pop() || "attachment").replace(
                    /^folio-note:/,
                    "",
                  ),
                },
              );
            } catch (error) {
              warnings.add(String(error));
            }
          }
          continue;
        }
        attrs.push(attr);
      }
      element.attrs = attrs;
      if (tag === "style")
        for (const child of element.childNodes)
          if (child.nodeName === "#text")
            (child as Tree.TextNode).value = (child as Tree.TextNode).value.replaceAll(
              "<",
              "\\3c ",
            );
      await walk(element);
    }
  };
  await walk(document);
  const htmlElement = document.childNodes.find(
    (n): n is Tree.Element => "tagName" in n && n.tagName === "html",
  )!;
  const body = htmlElement.childNodes.find(
    (n): n is Tree.Element => "tagName" in n && n.tagName === "body",
  )!;
  const html = `<!doctype html><html data-theme="${request.theme}" data-docfont="serif" data-reading="full"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${exportCSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(request.path.split("/").pop() || "Note")}</title><style>${css.replaceAll("<", "\\3c ")}
html,body{height:auto!important;overflow:visible!important}body{margin:0;background:var(--surface,#fff);color:var(--text,#222)}.exported-note{max-width:960px;margin:auto;padding:40px}.md{max-width:none!important;width:100%!important;padding:0!important;margin:0!important}.document-outline,.diagram-block header,.drawing-caption button,.code-block header button{display:none!important}.diagram-viewport{overflow:visible!important;max-height:none!important}.mermaid,.drawing-preview svg,img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #8885}figure,svg,pre,tr{break-inside:avoid}h1,h2,h3{break-after:avoid}@page{size:A4;margin:18mm 16mm}@media print{.exported-note{padding:0;max-width:none}body{print-color-adjust:exact}}
</style></head><body><main class="exported-note">${serialize(body)}</main></body></html>`;
  if (Buffer.byteLength(html) > exportLimit)
    throw new Error("Export exceeds 100 MiB. Remove large embeds or split the note.");
  return { html, warnings: [...warnings] };
}
