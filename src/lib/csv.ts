/**
 * Minimal RFC 4180 CSV writer. Cells that a spreadsheet would read as a
 * formula (leading `=`, `+`, `-`, `@`, tab or CR) are prefixed with `'`, so an
 * exported note or URL can never execute when the file is opened.
 */
export type CsvCell = string | number | boolean | null;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<K extends string>(columns: readonly K[], rows: ReadonlyArray<Record<K, CsvCell>>): string {
  const lines = [columns.map((c) => csvCell(c)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Minimal RFC 4180 CSV reader, the counterpart of `toCsv`. Accepts CRLF or LF,
 * quoted cells with embedded commas, quotes and newlines, and a leading UTF-8
 * BOM; whitespace-only lines are skipped. Returns the header and one record per non-empty line keyed by header.
 * Throws on an unterminated quote, a duplicate column name, or a row whose width differs from the header.
 */
export function parseCsv(text: string): { header: string[]; rows: Array<Record<string, string>> } {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (quoted) throw new Error("unterminated quoted cell");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => !(r.length === 1 && (r[0] as string).trim() === ""));
  const [header, ...body] = nonEmpty;
  if (!header) throw new Error("empty file");
  const names = header.map((h) => h.trim());
  const dup = names.find((h, j) => names.indexOf(h) !== j);
  if (dup !== undefined) throw new Error(`duplicate column "${dup}"`);
  const rows = body.map((r, idx) => {
    if (r.length !== header.length) throw new Error(`data row ${idx + 1}: expected ${header.length} cells, found ${r.length}`);
    return Object.fromEntries(names.map((h, j) => [h, r[j] as string]));
  });
  return { header: names, rows };
}
