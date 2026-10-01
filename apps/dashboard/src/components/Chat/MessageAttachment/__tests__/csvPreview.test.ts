import { describe, expect, it } from 'vitest';
import {
  CSV_PREVIEW_COLS,
  CSV_PREVIEW_ROWS,
  isCsvFile,
  parseCsvPreview,
  shouldRenderCsvInline,
} from '../csvPreview';

const row = (cols: number, r: number): string =>
  Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(',');

const csv = (rows: number, cols: number): string =>
  [
    Array.from({ length: cols }, (_, c) => `h${c}`).join(','),
    ...Array.from({ length: rows }, (_, r) => row(cols, r)),
  ].join('\n');

describe('isCsvFile', () => {
  it('matches the csv mime types', () => {
    expect(isCsvFile('text/csv', 'report.dat')).toBe(true);
    expect(isCsvFile('application/csv', 'report.dat')).toBe(true);
    expect(isCsvFile('text/comma-separated-values', 'report.dat')).toBe(true);
    expect(isCsvFile('text/csv; charset=utf-8', 'report.dat')).toBe(true);
    expect(isCsvFile('TEXT/CSV', 'report.dat')).toBe(true);
  });

  it('matches the .csv extension when the mime type is wrong or missing', () => {
    expect(isCsvFile('text/plain', 'report.csv')).toBe(true);
    expect(isCsvFile(null, 'report.CSV')).toBe(true);
    expect(isCsvFile(undefined, 'report.csv')).toBe(true);
  });

  it('rejects non-csv files', () => {
    expect(isCsvFile('text/plain', 'notes.txt')).toBe(false);
    expect(isCsvFile('application/json', 'data.json')).toBe(false);
    expect(isCsvFile('application/pdf', 'doc.pdf')).toBe(false);
    expect(isCsvFile('text/plain', 'report.csv.txt')).toBe(false);
  });
});

describe('shouldRenderCsvInline', () => {
  const csv = { mimetype: 'text/csv', originalFilename: 'report.csv' };

  it('renders inline only on non-compact desktop surfaces', () => {
    expect(shouldRenderCsvInline(csv, { isMobile: false })).toBe(true);
    expect(shouldRenderCsvInline(csv, { compact: false, isMobile: false })).toBe(true);
    expect(shouldRenderCsvInline(csv, { compact: true, isMobile: false })).toBe(false);
    expect(shouldRenderCsvInline(csv, { isMobile: true })).toBe(false);
  });

  it('never renders a non-csv inline', () => {
    expect(
      shouldRenderCsvInline(
        { mimetype: 'text/plain', originalFilename: 'n.txt' },
        { isMobile: false },
      ),
    ).toBe(false);
  });
});

describe('parseCsvPreview', () => {
  it('splits the first record off as the header', () => {
    const preview = parseCsvPreview('a,b\n1,2\n3,4', false);
    expect(preview.header).toEqual(['a', 'b']);
    expect(preview.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(preview.hasMoreRows).toBe(false);
  });

  it('caps rows and reports the overflow', () => {
    const preview = parseCsvPreview(csv(45, 3), false);
    expect(preview.rows).toHaveLength(CSV_PREVIEW_ROWS);
    expect(preview.hasMoreRows).toBe(true);
  });

  it('caps columns and reports the true total', () => {
    const preview = parseCsvPreview(csv(3, 12), false);
    expect(preview.colCount).toBe(CSV_PREVIEW_COLS);
    expect(preview.totalCols).toBe(12);
    expect(preview.header).toHaveLength(CSV_PREVIEW_COLS);
    expect(preview.rows[0]).toHaveLength(CSV_PREVIEW_COLS);
  });

  it('keeps quoted commas and newlines inside one cell', () => {
    const preview = parseCsvPreview('name,note\n"Smith, John","line1\nline2"', false);
    expect(preview.header).toEqual(['name', 'note']);
    expect(preview.rows).toEqual([['Smith, John', 'line1\nline2']]);
  });

  it('sizes columns from the widest record, not the header', () => {
    const preview = parseCsvPreview('Daily report\nh0,h1,h2\n1,2,3\n4,5,6', false);
    expect(preview.colCount).toBe(3);
    expect(preview.header).toEqual(['Daily report']);
    expect(preview.rows[0]).toEqual(['h0', 'h1', 'h2']);
    expect(preview.rows[1]).toEqual(['1', '2', '3']);
  });

  it('keeps ragged cells that run past the header', () => {
    const preview = parseCsvPreview('a,b\n1,2,3,4', false);
    expect(preview.colCount).toBe(4);
    expect(preview.rows[0]).toEqual(['1', '2', '3', '4']);
    expect(preview.totalCols).toBe(4);
  });

  it('fills the row budget even when the file is padded with blank lines', () => {
    const padded = [
      'h0,h1',
      ...Array.from({ length: 60 }, (_, r) => (r % 2 === 0 ? `${r},${r}` : '')),
    ].join('\n');
    const preview = parseCsvPreview(padded, false);
    expect(preview.rows).toHaveLength(CSV_PREVIEW_ROWS);
    expect(preview.rows[0]).toEqual(['0', '0']);
    expect(preview.rows[1]).toEqual(['2', '2']);
    expect(preview.hasMoreRows).toBe(true);
  });

  it('drops the record the byte slice cut in half', () => {
    const preview = parseCsvPreview('a,b\n1,2\n3,', true);
    expect(preview.rows).toEqual([['1', '2']]);
    expect(preview.hasMoreRows).toBe(true);
  });

  it('keeps every record when truncation landed on a row boundary', () => {
    const preview = parseCsvPreview('a,b\n1,2\n3,4\n', true);
    expect(preview.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a full row budget from a truncated file', () => {
    const preview = parseCsvPreview(csv(30, 2), true);
    expect(preview.rows).toHaveLength(CSV_PREVIEW_ROWS);
  });

  it('keeps the header when it is the only record left after truncation', () => {
    const preview = parseCsvPreview('a,b,c', true);
    expect(preview.header).toEqual(['a', 'b', 'c']);
    expect(preview.rows).toEqual([]);
    expect(preview.colCount).toBe(3);
  });

  it('reports empty input as having no columns', () => {
    expect(parseCsvPreview('', false).colCount).toBe(0);
    expect(parseCsvPreview('\n\n   \n', false).colCount).toBe(0);
    expect(parseCsvPreview('', false).header).toEqual([]);
    expect(parseCsvPreview('', false).rows).toEqual([]);
  });
});
