import * as XLSX from 'xlsx';

export interface SpreadsheetSheet {
  name: string;
  /** Every cell as the spreadsheet shows it — its formatted value — from A1. */
  rows: string[][];
  /** Column widths the file sets, in pixels. */
  columnWidths: (number | undefined)[];
}

export type SpreadsheetWorkerResponse =
  | { ok: true; sheets: SpreadsheetSheet[] }
  | { ok: false; error: string };

/** Excel's own character width, in pixels, for a width set in characters. */
const PIXELS_PER_CHARACTER = 7;

/**
 * Reads a workbook — xlsx, xls, xlsm, ods — off the page's thread, so a large one
 * never freezes it. Values come formatted, as the sheet shows them (dates, currency,
 * percentages), from A1 even when the data starts further in, so row numbers and
 * column letters match the file's own.
 */
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const workbook = XLSX.read(event.data, { type: 'array', cellDates: true, cellNF: true });
    const sheets = workbook.SheetNames.map((name): SpreadsheetSheet => {
      const sheet = workbook.Sheets[name];
      const ref = sheet?.['!ref'];
      if (!sheet || !ref) return { name, rows: [], columnWidths: [] };
      const range = XLSX.utils.decode_range(ref);
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: true,
        range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: range.e }),
      });
      const columnWidths = (sheet['!cols'] ?? []).map(
        column =>
          column?.wpx ??
          (column?.wch !== undefined ? column.wch * PIXELS_PER_CHARACTER + 10 : undefined),
      );
      return { name, rows, columnWidths };
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
