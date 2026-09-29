import { describe, expect, it } from 'vitest';
import {
  CSV_PREVIEW_COLS,
  CSV_PREVIEW_ROWS,
  isCsvFile,
  parseCsvPreview,
} from '../csvPreview';

describe('isCsvFile', () => {
  it('detects CSV by mime type', () => {
    expect(isCsvFile('text/csv', 'report')).toBe(true);
    expect(isCsvFile('text/csv; charset=utf-8', 'report')).toBe(true);
    expect(isCsvFile('text/comma-separated-values', 'report')).toBe(true);
    expect(isCsvFile('application/vnd.ms-excel', 'daily.CSV')).toBe(true);
  });

  it('falls back to the .csv extension', () => {
    expect(isCsvFile('application/octet-stream', 'daily-2026-09-29.csv')).toBe(true);
    expect(isCsvFile(null, 'daily.csv')).toBe(true);
  });

  it('rejects non-CSV files', () => {
    expect(isCsvFile('text/plain', 'notes.txt')).toBe(false);
    expect(isCsvFile('application/json', 'data.json')).toBe(false);
  });
});

describe('parseCsvPreview', () => {
  it('parses header and rows, honouring quoted commas', () => {
    const p = parseCsvPreview('name,note\nAlice,"a, b"\nBob,c\n', false);
    expect(p.header).toEqual(['name', 'note']);
    expect(p.rows).toEqual([
      ['Alice', 'a, b'],
      ['Bob', 'c'],
    ]);
    expect(p.hasMoreRows).toBe(false);
  });

  it('caps rows and columns and reports overflow', () => {
    const header = Array.from({ length: 12 }, (_, i) => `c${i}`).join(',');
    const body = Array.from({ length: 50 }, (_, r) =>
      Array.from({ length: 12 }, (_, c) => `${r}-${c}`).join(','),
    ).join('\n');
    const p = parseCsvPreview(`${header}\n${body}`, false);
    expect(p.rows).toHaveLength(CSV_PREVIEW_ROWS);
    expect(p.header).toHaveLength(CSV_PREVIEW_COLS);
    expect(p.rows[0]).toHaveLength(CSV_PREVIEW_COLS);
    expect(p.totalCols).toBe(12);
    expect(p.hasMoreRows).toBe(true);
  });

  it('drops a partial trailing row when the byte window truncated the file', () => {
    const p = parseCsvPreview('a,b\n1,2\n3,', true);
    expect(p.rows).toEqual([['1', '2']]);
    expect(p.hasMoreRows).toBe(true);
  });

  it('skips blank lines and handles empty input', () => {
    expect(parseCsvPreview('a,b\n\n1,2\n\n', false).rows).toEqual([['1', '2']]);
    expect(parseCsvPreview('', false).header).toEqual([]);
  });
});
