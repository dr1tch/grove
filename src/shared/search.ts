import type { TextItem } from "pdfjs-dist/types/src/display/api";
export function textMatches(
  text: string,
  query: string,
  limit = 1000,
): { from: number; to: number; line: number; snippet: string }[] {
  if (!query || limit <= 0) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const result = [];
  let line = 1,
    scanned = 0;
  for (const match of text.matchAll(expression)) {
    line += text.slice(scanned, match.index).split("\n").length - 1;
    scanned = match.index;
    result.push({
      from: match.index,
      to: match.index + match[0].length,
      line,
      snippet: text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 100),
    });
    if (result.length >= limit) break;
  }
  return result;
}
export function pdfPageText(items: unknown[]) {
  let text = "";
  const spans: { from: number; to: number; item: TextItem }[] = [];
  for (const value of items) {
    const item = value as TextItem;
    if (typeof item.str !== "string") continue;
    const from = text.length;
    text += item.str;
    spans.push({ from, to: text.length, item });
    text += item.hasEOL ? "\n" : " ";
  }
  return { text, spans };
}
