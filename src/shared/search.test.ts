import { it, expect } from "vite-plus/test";
import { textMatches } from "./search";
it("finds Unicode and multiline literal matches with actual source offsets", () => {
  const text = "First\nÉté\nlast\nÉTÉ";
  expect(textMatches(text, "été").map((m) => [m.from, m.to, m.line])).toEqual([
    [6, 9, 2],
    [15, 18, 4],
  ]);
  expect(textMatches(text, "té\nla")).toHaveLength(1);
  expect(textMatches(text, "")).toEqual([]);
});
