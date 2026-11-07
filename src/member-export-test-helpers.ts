// Test-only: reads a CSV by RFC 4180's rules, so a test sees the cells a spreadsheet would, however
// the cells were quoted and whichever line ending was used. Nothing that ships imports this.

/** The records of `text`, each a list of cells. A leading byte-order mark is not a cell's. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[at + 1] === '"') {
        cell += '"';
        at++;
      } else quoted = false;
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(cell);
      cell = "";
    } else if (char === "\n" || (char === "\r" && source[at + 1] === "\n")) {
      if (char === "\r") at++;
      records.push([...record, cell]);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || record.length > 0) records.push([...record, cell]);
  return records;
}
