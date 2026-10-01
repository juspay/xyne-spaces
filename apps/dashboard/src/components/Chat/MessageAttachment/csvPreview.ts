import Papa from 'papaparse';
import { CSV_MIME_TYPES } from '../../ui/utils/files';

export const CSV_PREVIEW_ROWS = 20;
export const CSV_PREVIEW_COLS = 8;
export const CSV_PREVIEW_BYTES = 256 * 1024;
export const CSV_PREVIEW_MAX_FILE_BYTES = 5 * 1024 * 1024;

const CSV_RECORD_LIMIT = CSV_PREVIEW_ROWS + 2;

export const isCsvFile = (mimeType: string | null | undefined, fileName: string): boolean => {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  return CSV_MIME_TYPES.includes(mime) || fileName.toLowerCase().endsWith('.csv');
};

export interface CsvPreview {
  header: string[];
  rows: string[][];
  colCount: number;
  totalCols: number;
  hasMoreRows: boolean;
}

export const parseCsvPreview = (text: string, byteTruncated: boolean): CsvPreview => {
  const records: string[][] = [];
  let stoppedAtLimit = false;

  Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    step: (result, parser): void => {
      const row = result.data;
      if (Array.isArray(row) && row.some(cell => String(cell).trim().length > 0)) {
        records.push(row);
      }
      if (records.length >= CSV_RECORD_LIMIT) {
        stoppedAtLimit = true;
        parser.abort();
      }
    },
  });

  const lastRecordCut = byteTruncated && !stoppedAtLimit && !/\r?\n$/.test(text);
  const complete = lastRecordCut && records.length > 1 ? records.slice(0, -1) : records;

  const [header = [], ...body] = complete;
  const rows = body.slice(0, CSV_PREVIEW_ROWS);
  const totalCols = complete.reduce((max, row) => Math.max(max, row.length), 0);
  const colCount = Math.min(CSV_PREVIEW_COLS, totalCols);

  return {
    header: header.slice(0, colCount),
    rows: rows.map(row => row.slice(0, colCount)),
    colCount,
    totalCols,
    hasMoreRows: body.length > CSV_PREVIEW_ROWS || byteTruncated,
  };
};
