import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export type Reference = {
  kind: "link" | "image" | "wiki" | "embed";
  address: string;
  label: string;
  title: string;
  from: number;
  to: number;
  raw: string;
  original?: string;
  labelSource?: string;
  initialLabel?: string;
};
const values = (ref: Reference) => JSON.stringify([ref.kind, ref.address, ref.label, ref.title]);
export function referenceAt(source: string, position: number): Reference | null {
  const root = fromMarkdown(source),
    definitions = new Map<string, { url: string; title?: string | null }>();
  for (const node of root.children)
    if (node.type === "definition") definitions.set(node.identifier, node);
  const pending: Nodes[] = [root],
    candidates: Reference[] = [],
    literal: { from: number; to: number }[] = [];
  while (pending.length) {
    const node = pending.pop()!,
      from = node.position?.start.offset,
      to = node.position?.end.offset;
    if (from === undefined || to === undefined) continue;
    if (["code", "inlineCode", "html", "definition"].includes(node.type)) {
      literal.push({ from, to });
      continue;
    }
    if (
      node.type === "link" ||
      node.type === "image" ||
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      const target = "url" in node ? node : definitions.get(node.identifier);
      if (target) {
        const raw = source.slice(from, to),
          image = node.type.startsWith("image");
        const first = "children" in node ? node.children[0]?.position?.start.offset : undefined;
        const last = "children" in node ? node.children.at(-1)?.position?.end.offset : undefined;
        const labelSource =
          first !== undefined && last !== undefined
            ? source.slice(first, last)
            : raw.slice(image ? 2 : 1, raw.indexOf("]"));
        const label =
          node.type === "image" ? (node.alt ?? "") : labelSource.replace(/\\([\\[\]])/g, "$1");
        const ref: Reference = {
          kind: image ? "image" : "link",
          address: target.url,
          label,
          labelSource,
          initialLabel: label,
          title: target.title ?? "",
          from,
          to,
          raw,
        };
        ref.original = values(ref);
        candidates.push(ref);
      }
    }
    if ("children" in node) pending.push(...node.children);
  }
  for (const match of source.matchAll(/!?\[\[[^\]\n]+\]\]/g)) {
    const from = match.index!,
      to = from + match[0].length;
    let slashes = 0;
    for (let i = from - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
    if (
      slashes % 2 ||
      literal.some((range) => from >= range.from && to <= range.to) ||
      candidates.some((ref) => from >= ref.from && to <= ref.to)
    )
      continue;
    const raw = match[0],
      embed = raw.startsWith("!"),
      body = raw.slice(embed ? 3 : 2, -2),
      pipe = body.indexOf("|");
    const ref: Reference = {
      kind: embed ? "embed" : "wiki",
      address: pipe < 0 ? body : body.slice(0, pipe),
      label: pipe < 0 ? "" : body.slice(pipe + 1),
      title: "",
      raw,
      from,
      to,
    };
    ref.original = values(ref);
    candidates.push(ref);
  }
  return (
    candidates
      .filter((ref) => position >= ref.from && position <= ref.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0] ?? null
  );
}
export function validReference(
  ref: Pick<Reference, "kind" | "address"> & Partial<Pick<Reference, "label">>,
) {
  const address = ref.address.trim();
  const paragraph = fromMarkdown(`[x](<${address.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`)
    .children[0];
  const link = paragraph?.type === "paragraph" ? paragraph.children[0] : null;
  const decoded = link?.type === "link" ? link.url : address;
  return (
    !!address &&
    !(address + decoded)
      .split("")
      .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    !decoded.startsWith("//") &&
    (!/^[a-z][a-z\d+.-]*:/i.test(decoded) || /^(https?:|mailto:)/i.test(decoded)) &&
    (!["wiki", "embed"].includes(ref.kind) ||
      (!/[|[\]]/.test(address) && !/[|[\]\r\n]/.test(ref.label ?? "")))
  );
}
export function referenceMarkdown(ref: Reference) {
  if (ref.original === values(ref)) return ref.raw;
  if (ref.kind === "wiki" || ref.kind === "embed")
    return `${ref.kind === "embed" ? "!" : ""}[[${ref.address}${ref.label ? `|${ref.label.replace(/[\]\r\n]/g, "")}` : ""}]]`;
  const label =
    ref.label === ref.initialLabel && ref.labelSource !== undefined
      ? ref.labelSource
      : ref.label.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
  const address = ref.address.replace(/\\/g, "\\\\").replace(/</g, "%3C").replace(/>/g, "%3E");
  const title = ref.title
    ? ` "${ref.title
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/[\r\n]/g, " ")}"`
    : "";
  return `${ref.kind === "image" ? "!" : ""}[${label}](<${address}>${title})`;
}
