import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

/** Vault-root references stay valid when a new draft is first saved into a folder. */
export function vaultReference(path: string, embed: boolean): string {
  const target = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const label = (path.split("/").pop() || path).replace(/[\\[\]]/g, "\\$&");
  return `${embed ? "!" : ""}[${label}](</${target}>)`;
}

export function mermaidBlocks(source: string): { label: string; content: string }[] {
  const result: { label: string; content: string }[] = [];
  let heading = "";
  const visit = (node: Nodes) => {
    if (node.type === "heading")
      heading = node.children.map((child) => ("value" in child ? child.value : "")).join("");
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const longest = Math.max(0, ...(node.value.match(/`+/g) || []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      result.push({
        label: heading || `Mermaid block ${result.length + 1}`,
        content: `${fence}mermaid\n${node.value}\n${fence}`,
      });
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(source));
  return result;
}
