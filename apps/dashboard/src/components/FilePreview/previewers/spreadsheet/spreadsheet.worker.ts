import * as XLSX from 'xlsx';
import { MAX_COLUMNS, MAX_ROWS } from './limits';

export interface SpreadsheetSheet {
  name: string;
  /** Every cell as the spreadsheet shows it — its formatted value — from A1. */
  rows: string[][];
  /** Column widths the file sets, in pixels. */
  columnWidths: (number | undefined)[];
  /** True when the sheet goes on past what is read: MAX_ROWS rows, MAX_COLUMNS columns. */
  truncated: boolean;
}

export type SpreadsheetWorkerResponse =
  | { ok: true; sheets: SpreadsheetSheet[] }
  | { ok: false; error: string };

/** Excel's own character width, in pixels, for a width set in characters. */
const PIXELS_PER_CHARACTER = 7;

/**
 * The cells that hold something, as a range from A1. A sheet's own `!ref` is no guide:
 * formatting a whole column stretches it to row 1,048,576, and reading that densely
 * would build a billion empty strings. Only cells that exist count.
 */
function filledRange(sheet: XLSX.WorkSheet): { lastRow: number; lastColumn: number } | null {
  let lastRow = -1;
  let lastColumn = -1;
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const cell = XLSX.utils.decode_cell(address);
    if (cell.r > lastRow) lastRow = cell.r;
    if (cell.c > lastColumn) lastColumn = cell.c;
  }
  return lastRow < 0 ? null : { lastRow, lastColumn };
}

/**
 * Reads a workbook — xlsx, xls, xlsm, ods — off the page's thread, so a large one
 * never freezes it. Values come formatted, as the sheet shows them (dates, currency,
 * percentages), from A1 even when the data starts further in, so row numbers and
 * column letters match the file's own.
 */
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  // Only the page that made a dedicated worker can message it, and its messages carry
  // no origin: one that does came from elsewhere and is ignored.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  try {
    const workbook = XLSX.read(event.data, { type: 'array', cellDates: true, cellNF: true });
    const sheets = workbook.SheetNames.map((name): SpreadsheetSheet => {
      const sheet = workbook.Sheets[name];
      const filled = sheet ? filledRange(sheet) : null;
      if (!sheet || !filled) return { name, rows: [], columnWidths: [], truncated: false };
      const lastRow = Math.min(filled.lastRow, MAX_ROWS - 1);
      const lastColumn = Math.min(filled.lastColumn, MAX_COLUMNS - 1);
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: true,
        range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastColumn } }),
      });
      const columnWidths = (sheet['!cols'] ?? [])
        .slice(0, lastColumn + 1)
        .map(
          column =>
            column?.wpx ??
            (column?.wch !== undefined ? column.wch * PIXELS_PER_CHARACTER + 10 : undefined),
        );
      return {
        name,
        rows,
        columnWidths,
        truncated: filled.lastRow >= MAX_ROWS || filled.lastColumn >= MAX_COLUMNS,
      };
    });
    const response: SpreadsheetWorkerResponse = { ok: true, sheets };
    self.postMessage(response);
  } catch (error) {
    const response: SpreadsheetWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'Unreadable workbook',
    };
    self.postMessage(response);
  }
};
