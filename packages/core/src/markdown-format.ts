export type MarkdownAction =
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "quote"
  | "bullet"
  | "ordered"
  | "task"
  | "h0"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";
export type MarkdownEdit = {
  changes: { from: number; to: number; insert: string }[];
  selection?: { anchor: number; head: number };
};
export function formatMarkdown(
  text: string,
  from: number,
  to: number,
  action: MarkdownAction,
): MarkdownEdit {
  const selected = text.slice(from, to);
  if ((action === "bold" || action === "italic") && selected && selected !== selected.trim()) {
    if (!selected.trim()) return formatMarkdown(text, to, to, action);
    return formatMarkdown(
      text,
      from + selected.length - selected.trimStart().length,
      to - selected.length + selected.trimEnd().length,
      action,
    );
  }
  if ((action === "bold" || action === "italic") && /\n[\t ]*\n/.test(selected)) {
    let offset = from;
    const changes: MarkdownEdit["changes"] = [];
    for (const part of selected.split(/(\n[\t ]*\n+)/)) {
      if (part.trim())
        changes.push(...formatMarkdown(text, offset, offset + part.length, action).changes);
      offset += part.length;
    }
    return { changes };
  }
  const replace = (
    start: number,
    end: number,
    insert: string,
    anchor: number,
    head: number,
  ): MarkdownEdit => ({
    changes: [{ from: start, to: end, insert }],
    selection: { anchor, head },
  });
  if (action === "link") {
    const label = selected || "text";
    const insert = `[${label}](url)`;
    return replace(from, to, insert, from + label.length + 3, from + label.length + 6);
  }
  if (action === "bold" || action === "italic" || action === "code") {
    const runs = selected.match(/`+/g) || [];
    const longest = Math.max(0, ...runs.map((run) => run.length));
    if (action === "code") {
      const opening = text.slice(0, from).match(/(`+)( ?)$/);
      const closing = text.slice(to).match(/^( ?)(`+)/);
      if (
        opening &&
        closing &&
        opening[1] === closing[2] &&
        opening[2] === closing[1] &&
        opening[1].length > longest
      ) {
        const start = from - opening[0].length;
        return replace(start, to + closing[0].length, selected, start, start + selected.length);
      }
    }
    if (action === "code" && selected.includes("\n")) {
      const fence = "`".repeat(Math.max(3, longest + 1));
      const before = `${from && text[from - 1] !== "\n" ? "\n" : ""}${fence}\n`;
      const after = `\n${fence}${to < text.length && text[to] !== "\n" ? "\n" : ""}`;
      return replace(
        from,
        to,
        before + selected + after,
        from + before.length,
        from + before.length + selected.length,
      );
    }
    let marker = action === "bold" ? "**" : action === "italic" ? "*" : "`".repeat(longest + 1);
    const outer = selected.match(action === "code" ? /^`+/ : /^\*+/)?.[0] || "";
    if (
      action === "code" &&
      outer &&
      selected.endsWith(outer) &&
      selected.length > outer.length * 2
    )
      marker = outer;
    const enclosed =
      selected.length > marker.length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      (action !== "italic" || outer.length % 2 === 1);
    if (enclosed) {
      const content = selected.slice(marker.length, -marker.length);
      return replace(from, to, content, from, from + content.length);
    }
    const before = text.slice(0, from),
      after = text.slice(to);
    const surrounded =
      before.endsWith(marker) &&
      after.startsWith(marker) &&
      (action !== "italic" ||
        ((before.match(/\*+$/)?.[0].length || 0) % 2 === 1 &&
          (after.match(/^\*+/)?.[0].length || 0) % 2 === 1));
    if (surrounded)
      return replace(
        from - marker.length,
        to + marker.length,
        selected,
        from - marker.length,
        to - marker.length,
      );
    const content = selected || (action === "code" ? "code" : "text");
    // Markdown code spans need padding when their content starts or ends with a backtick.
    const padding = action === "code" && /^`|`$/.test(content) ? " " : "";
    return replace(
      from,
      to,
      marker + padding + content + padding + marker,
      from + marker.length + padding.length,
      from + marker.length + padding.length + content.length,
    );
  }
  const start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const endpoint = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const newline = text.indexOf("\n", endpoint);
  const end = newline < 0 ? text.length : newline;
  const lines = text.slice(start, end).split("\n");
  const heading = action.startsWith("h");
  const level = heading ? Number(action[1]) : 0;
  const desired = heading
    ? new RegExp(`^#{${level}}(?:\\s+|$)`)
    : action === "quote"
      ? /^> ?/
      : action === "task"
        ? /^[-+*]\s+\[[ xX]\]\s*/
        : action === "ordered"
          ? /^\d+[.)]\s+/
          : /^[-+*]\s+(?!\[[ xX]\])/;
  const nonempty = lines.filter((line) => line.trim());
  const remove =
    (heading && !level) ||
    (nonempty.length > 0 && nonempty.every((line) => desired.test(line.trimStart())));
  const changes: MarkdownEdit["changes"] = [];
  let offset = start,
    number = 1;
  for (const line of lines) {
    if (lines.length === 1 || line.trim()) {
      const indent = line.match(/^[\t ]*/)?.[0] || "";
      const body = line.slice(indent.length);
      const old =
        body.match(
          heading
            ? /^#{1,6}(?:\s+|$)/
            : action === "quote"
              ? /^> ?/
              : /^(?:[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/,
        )?.[0] || "";
      const prefix = remove
        ? ""
        : heading
          ? "#".repeat(level) + " "
          : action === "quote"
            ? "> "
            : action === "task"
              ? "- [ ] "
              : action === "ordered"
                ? `${number++}. `
                : "- ";
      if (prefix !== old)
        changes.push({
          from: offset + indent.length,
          to: offset + indent.length + old.length,
          insert: prefix,
        });
    }
    offset += line.length + 1;
  }
  return { changes };
}
