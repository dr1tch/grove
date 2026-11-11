import { parse, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import postcss from "postcss";
import values from "postcss-value-parser";
import type { Vault } from "./vault";
import { assetBytes } from "./assets";
import { resolveLink } from "../shared/links";
export const htmlCSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export const staticTags = new Set(
  "html head body title meta style main section article nav aside header footer div span p h1 h2 h3 h4 h5 h6 a ul ol li table thead tbody tfoot tr th td caption col colgroup blockquote pre code strong em b i u s small sub sup br hr details summary figure figcaption img dl dt dd q abbr time mark kbd samp var address button input textarea select option label form svg path circle ellipse g rect line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask".split(
    " ",
  ),
);
const unescapeCSS = (value: string) =>
  value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_all, part: string) =>
    /^[0-9a-f]/i.test(part)
      ? String.fromCodePoint(Math.min(0x10ffff, parseInt(part.trim(), 16)))
      : part,
  );
export async function buildHtmlPreview(
  vault: Vault,
  path: string,
  source: string,
): Promise<{ html: string; warnings: string[] }> {
  if (typeof source !== "string" || Buffer.byteLength(source) > 20 * 1024 * 1024)
    throw new Error("HTML exceeds the 20 MB preview limit");
  await vault.path(path);
  const warnings = new Set<string>(),
    images = new Map<string, string>();
  let bytes = 0,
    imports = 0;
  const local = (owner: string, url: string) => {
    const resolved = resolveLink(owner, unescapeCSS(url.trim()), []);
    if (!resolved || !resolved.path || url.startsWith("#"))
      throw new Error(`Blocked external or invalid resource: ${url.slice(0, 120)}`);
    return resolved.path;
  };
  const image = async (owner: string, url: string) => {
    if (/^data:(image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/(?:woff2?|ttf));base64,/i.test(url)) {
      bytes += url.length;
      if (bytes > 32 * 1024 * 1024) throw new Error("Preview resources exceed 32 MB");
      return url;
    }
    const target = local(owner, url);
    if (images.has(target)) return images.get(target)!;
    const info = await vault.info(target);
    if (!/^(image\/|font\/|application\/(?:font|x-font))/.test(info.mime))
      throw new Error(`Unsupported preview resource: ${target}`);
    const data = await assetBytes(vault, target, undefined, 8 * 1024 * 1024);
    bytes += data.length;
    if (bytes > 32 * 1024 * 1024) throw new Error("Preview resources exceed 32 MB");
    const result = `data:${info.mime};base64,${data.toString("base64")}`;
    images.set(target, result);
    return result;
  };
  const css = async (text: string, owner: string, stack: string[] = []): Promise<string> => {
    const root = postcss.parse(text),
      rules: postcss.AtRule[] = [];
    root.walkAtRules((rule) => {
      if (rule.name.toLowerCase() === "import") rules.push(rule);
    });
    for (const rule of rules) {
      try {
        const params = values(rule.params),
          first = params.nodes.find((node) => node.type !== "space");
        const url =
          first?.type === "string"
            ? first.value
            : first?.type === "function" && first.value.toLowerCase() === "url"
              ? values.stringify(first.nodes).replace(/^['"]|['"]$/g, "")
              : "";
        const target = local(owner, url);
        if (stack.includes(target) || stack.length >= 8 || ++imports > 32)
          throw new Error(`CSS import cycle or depth limit: ${target}`);
        const imported = await vault.read(target);
        bytes += Buffer.byteLength(imported.content);
        if (bytes > 32 * 1024 * 1024) throw new Error("Preview resources exceed 32 MB");
        const transformed = await css(imported.content, target, [...stack, target]);
        const trailing = first
          ? values.stringify(params.nodes.slice(params.nodes.indexOf(first) + 1)).trim()
          : "";
        rule.replaceWith(
          postcss.parse(trailing ? `@media ${trailing}{${transformed}}` : transformed).nodes,
        );
      } catch (error) {
        warnings.add(String(error));
        rule.remove();
      }
    }
    const declarations: postcss.Declaration[] = [];
    root.walkDecls((declaration) => {
      declarations.push(declaration);
    });
    for (const declaration of declarations) {
      const parsed = values(declaration.value),
        urls: values.FunctionNode[] = [];
      parsed.walk((node) => {
        if (node.type === "function" && unescapeCSS(node.value).toLowerCase() === "url") {
          urls.push(node);
          return false;
        }
      });
      for (const node of urls) {
        try {
          const url = values
            .stringify(node.nodes)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          const data = await image(owner, url);
          node.value = "url";
          node.nodes = [
            { type: "string", quote: '"', value: data, sourceIndex: 0, sourceEndIndex: 0 },
          ];
        } catch (error) {
          warnings.add(String(error));
          node.nodes = [
            { type: "string", quote: '"', value: "", sourceIndex: 0, sourceEndIndex: 0 },
          ];
        }
      }
      declaration.value = values.stringify(parsed.nodes);
    }
    return root.toString();
  };
  const document = parse(source);
  const walk = async (parent: Tree.ParentNode) => {
    for (const node of parent.childNodes) {
      if (!("tagName" in node)) continue;
      const element = node as Tree.Element,
        tag = element.tagName;
      if (tag === "link") {
        const rel = element.attrs.find((a) => a.name === "rel")?.value,
          href = element.attrs.find((a) => a.name === "href")?.value;
        if (rel?.toLowerCase() === "stylesheet" && href) {
          try {
            const target = local(path, href),
              doc = await vault.read(target);
            const transformed = await css(doc.content, target, [target]);
            element.tagName = "style";
            element.attrs = [];
            element.childNodes = [
              {
                nodeName: "#text",
                value: transformed.replaceAll("<", "\\3c "),
                parentNode: element,
              },
            ];
          } catch (error) {
            warnings.add(String(error));
            parent.childNodes = parent.childNodes.filter((n) => n !== node);
            continue;
          }
        } else {
          parent.childNodes = parent.childNodes.filter((n) => n !== node);
          continue;
        }
      } else if (!staticTags.has(tag)) {
        warnings.add(`Omitted active or unsupported element: ${tag}`);
        parent.childNodes = parent.childNodes.filter((n) => n !== node);
        continue;
      }
      if (tag === "meta" && !element.attrs.some((a) => a.name === "charset")) {
        parent.childNodes = parent.childNodes.filter((n) => n !== node);
        continue;
      }
      const attrs = [];
      for (const attribute of element.attrs) {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith("on") ||
          [
            "href",
            "srcset",
            "srcdoc",
            "action",
            "formaction",
            "ping",
            "target",
            "download",
            "autofocus",
            "background",
            "poster",
            "data",
            "content",
            "http-equiv",
          ].includes(name)
        )
          continue;
        if (name === "src") {
          if (tag === "img") {
            try {
              attrs.push({ ...attribute, value: await image(path, attribute.value) });
            } catch (error) {
              warnings.add(String(error));
              attrs.push({ name: "alt", value: `Missing image: ${attribute.value}` });
            }
          }
          continue;
        }
        if (name === "style") {
          try {
            const transformed = await css(`x{${attribute.value}}`, path);
            attrs.push({
              ...attribute,
              value: transformed.slice(transformed.indexOf("{") + 1, transformed.lastIndexOf("}")),
            });
          } catch (error) {
            warnings.add(String(error));
          }
          continue;
        }
        attrs.push(attribute);
      }
      element.attrs = attrs;
      if (["button", "input", "textarea", "select"].includes(tag))
        element.attrs.push({ name: "disabled", value: "" });
      if (tag === "style") {
        const text = element.childNodes
          .filter((child): child is Tree.TextNode => child.nodeName === "#text")
          .map((child) => child.value)
          .join("");
        try {
          element.childNodes = [
            {
              nodeName: "#text",
              value: (await css(text, path)).replaceAll("<", "\\3c "),
              parentNode: element,
            },
          ];
        } catch (error) {
          warnings.add(String(error));
          element.childNodes = [];
        }
      } else if ("childNodes" in element) await walk(element);
    }
  };
  await walk(document);
  const html = serialize(document);
  if (Buffer.byteLength(html) > 40 * 1024 * 1024) throw new Error("Rendered preview exceeds 40 MB");
  return { html, warnings: [...warnings] };
}
