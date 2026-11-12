import type { AttachmentRef } from "./types";
export function attachmentMarkdown(notePath: string, ref: AttachmentRef): string {
  const from = notePath.split("/").slice(0, -1),
    to = ref.path.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const target = [...from.map(() => ".."), ...to]
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  const label = ref.path
    .split("/")
    .pop()!
    .replace(/[\\[\]]/g, "\\$&");
  return `${ref.kind === "image" ? "!" : ""}[${label}](${target})`;
}
