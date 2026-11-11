import { expect, it } from "vite-plus/test";
import { parseCsv } from "./csv";

it("preserves quoted delimiters, multiline cells and escaped quotes", () => {
  expect(parseCsv('name,note\r\n"Doe, Jane","line 1\nline 2: ""hello"""\r\n')).toEqual([
    ["name", "note"],
    ["Doe, Jane", 'line 1\nline 2: "hello"'],
  ]);
});
it("handles quoted TSV cells and embedded tabs", () => {
  expect(parseCsv('a\tb\n"x\ty"\t"z"', "\t")).toEqual([
    ["a", "b"],
    ["x\ty", "z"],
  ]);
});
it("keeps empty cells and blank records without adding a final phantom row", () => {
  expect(parseCsv('\uFEFFa,,\r\n\r\n"",b,')).toEqual([["a", "", ""], [""], ["", "b", ""]]);
  expect(parseCsv("")).toEqual([]);
  expect(parseCsv('""')).toEqual([[""]]);
  expect(parseCsv("a\rb\r")).toEqual([["a"], ["b"]]);
});
it("rejects malformed quoting so the preview can show the original source", () => {
  for (const input of ['"unfinished', '"closed"oops', 'un"quoted']) {
    expect(() => parseCsv(input)).toThrow();
  }
});
