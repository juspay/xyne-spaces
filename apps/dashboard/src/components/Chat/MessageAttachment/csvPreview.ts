/**
 * Pure helpers for the inline CSV attachment preview (no DOM / app-config imports,
 * so they are unit-testable in a node environment).
 */
import Papa from 'papaparse';

export const CSV_PREVIEW_ROWS = 20;
export const CSV_PREVIEW_COLS = 8;
/** Only the head of the file is decoded for the inline preview. */
export const CSV_PREVIEW_BYTES = 256 * 1024;

const CSV_MIME_TYPES = new Set([
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/x-csv',
  'application/x-csv',
]);

export const isCsvFile = (mimeType: string | null | undefined, fileName: string): boolean => {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  return CSV_MIME_TYPES.has(mime) || fileName.toLowerCase().endsWith('.csv');
};

export interface CsvPreview {
  header: string[];
  rows: string[][];
  totalCols: number;
  /** True when the file has more rows than shown (or was byte-truncated). */
  hasMoreRows: boolean;
}

export const parseCsvPreview = (text: string, byteTruncated: boolean): CsvPreview => {
  // +2: header row, and one extra row to detect overflow.
  const result = Papa.parse<string[]>(text, {
    preview: CSV_PREVIEW_ROWS + 2,
    skipEmptyLines: 'greedy',
  });
  const all = result.data.filter(r => Array.isArray(r) && r.some(c => String(c).trim().length));
  // When the byte window cut the file mid-row, the last parsed row may be partial.
  const complete = byteTruncated && all.length <= CSV_PREVIEW_ROWS + 1 ? all.slice(0, -1) : all;
  const [header = [], ...body] = complete;
  const totalCols = complete.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    header: header.slice(0, CSV_PREVIEW_COLS),
    rows: body.slice(0, CSV_PREVIEW_ROWS).map(r => r.slice(0, CSV_PREVIEW_COLS)),
    totalCols,
    hasMoreRows: body.length > CSV_PREVIEW_ROWS || byteTruncated,
  };
};
