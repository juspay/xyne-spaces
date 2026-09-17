export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_PREFIX = /^\s*[=+\-@]/;

export function escapeCsvCell(value: CsvCell): string {
  let text = value === null || value === undefined ? "" : String(value);

  // Prefix at the start of the cell so spreadsheet applications keep the
  // entire value as text, including values with leading whitespace.
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(headers: string[], rows: CsvCell[][]): string {
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\r\n");
}
