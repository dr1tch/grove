import type { Entry } from "./types";
export function rankFiles(
  query: string,
  entries: Entry[],
  recentPaths: string[],
): { path: string; score: number; ranges: [number, number][] }[] {
  const q = query.trim().toLocaleLowerCase(),
    recent = new Map(recentPaths.map((p, i) => [p, i]));
  const characters = Array.from(new Intl.Segmenter().segment(q), (part) => part.segment);
  return entries
    .filter((e) => e.kind !== "folder")
    .flatMap((entry) => {
      const path = entry.path,
        lower = path.toLocaleLowerCase(),
        offset = path.lastIndexOf("/") + 1,
        base = lower.slice(offset);
      if (!q) return recent.has(path) ? [{ path, score: 100 - recent.get(path)!, ranges: [] }] : [];
      const exact = base === q || base.replace(/\.[^.]+$/, "") === q;
      let start = lower.indexOf(q),
        score = exact ? 3000 : start >= 0 ? 2000 : 1000;
      let positions: number[] = [];
      if (start >= 0) positions = Array.from({ length: q.length }, (_, i) => start + i);
      else {
        for (const origin of [offset, 0]) {
          let cursor = origin;
          positions = [];
          let matched = 0;
          for (const char of characters) {
            const at = lower.indexOf(char, cursor);
            if (at < 0) break;
            positions.push(...Array.from({ length: char.length }, (_, i) => at + i));
            matched++;
            cursor = at + char.length;
          }
          if (matched === characters.length) break;
        }
        if (positions.length !== q.length) return [];
        score -= positions.at(-1)! - positions[0] - positions.length;
      }
      const ranges: [number, number][] = [];
      for (const position of positions) {
        const previous = ranges.at(-1);
        if (previous?.[1] === position) previous[1]++;
        else ranges.push([position, position + 1]);
      }
      return [
        {
          path,
          score:
            score - base.length / 100 + (recent.has(path) ? (100 - recent.get(path)!) / 1000 : 0),
          ranges,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
