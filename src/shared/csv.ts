/** Parse CSV or TSV without losing quoted delimiters, newlines or empty cells. */
export function parseCsv(value: string, delimiter: "," | "\t" = ","): string[][] {
  const input = value.replace(/^\uFEFF/, "");
  if (!input) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== delimiter) {
        rows.push(row);
        row = [];
        if (char === "\r" && input[i + 1] === "\n") i++;
      }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Unexpected character in quoted field");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed quoted field");
  if (row.length || field || closed || input.endsWith(delimiter)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
