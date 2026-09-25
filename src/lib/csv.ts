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
