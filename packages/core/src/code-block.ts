import { fromMarkdown } from "mdast-util-from-markdown";
import { wikiToMarkdown } from "./links";
export function markdownWithBlocks(source: string) {
  let value = "",
    cursor = 0,
    line = 1;
  const append = (part: string) => {
    value += part;
    line += part.split("\n").length - 1;
  };
  const blocks = codeBlocks(source).map((block) => {
    append(wikiToMarkdown(source.slice(cursor, block.from)));
    const displayLine = line;
    append(source.slice(block.from, block.to));
    cursor = block.to;
    return { ...block, displayLine };
  });
  append(wikiToMarkdown(source.slice(cursor)));
  return { value, blocks };
}
export function codeBlocks(source: string) {
  return fromMarkdown(source).children.flatMap((node) => {
    if (
      node.type !== "code" ||
      node.position?.start.offset === undefined ||
      node.position.end.offset === undefined
    )
      return [];
    const from = node.position.start.offset,
      to = node.position.end.offset;
    if (!/^ {0,3}(?:`{3,}|~{3,})/.test(source.slice(from, to))) return [];
    return [
      {
        from,
        to,
        line: node.position.start.line,
        body: node.value.replace(/\r\n?/g, "\n"),
        language: node.lang ?? "",
      },
    ];
  });
}
export function replaceCodeBlock(
  current: string,
  original: string,
  line: number,
  body: string,
): string {
  if (current !== original)
    throw new Error(
      "The note changed while you were editing. Copy your block edits, then cancel and reopen the block.",
    );
  const block = codeBlocks(original).find((block) => block.line === line);
  if (!block) throw new Error("The original code block is no longer available.");
  const raw = original.slice(block.from, block.to);
  const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(\r?\n|$)/.exec(raw)!;
  const [, indent, marker, info, ending] = opening;
  const eol = ending || "\n",
    character = marker[0];
  const longest = Math.max(
    0,
    ...(body.match(character === "`" ? /`+/g : /~+/g) ?? []).map((run) => run.length),
  );
  const fence = character.repeat(Math.max(marker.length, longest + 1));
  const text = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => indent + line)
    .join(eol);
  return (
    original.slice(0, block.from) +
    `${indent}${fence}${info}${eol}${text}${eol}${indent}${fence}` +
    original.slice(block.to)
  );
}
