import React, { useState } from 'react';
import { formatLatency } from './chartUtils';

interface SimpleTableProps {
  data: Record<string, string | number>[];
  className?: string;
  style?: React.CSSProperties;
}

const PAGE_SIZE = 5;

function isDateTimeString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(
    value.trim(),
  );
}

function isNumericString(value: string): boolean {
  return /^-?\d+(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function isDurationColumn(col: string): boolean {
  const lower = col.toLowerCase();
  const isTimestamp =
    lower.includes('created_at') ||
    lower.includes('updated_at') ||
    lower.includes('date') ||
    lower.endsWith('_at_time');
  return (
    !isTimestamp &&
    (lower.includes('latency') ||
      lower.includes('duration') ||
      lower.includes('time_taken') ||
      lower.includes('elapsed_time'))
  );
}

function formatCellValue(value: string | number | null | undefined, col: string): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'string') {
    if (isDateTimeString(value)) return value.trim();
    if (!isNumericString(value)) return value;
  }
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (isNaN(num)) return String(value);
  const lower = col.toLowerCase();
  if (lower.includes('rate') || lower.includes('percentage') || lower.includes('percent')) {
    return `${num}%`;
  }
  if (isDurationColumn(col)) return formatLatency(num);
  if (
    lower.includes('volume') ||
    lower.includes('count') ||
    lower.includes('amount') ||
    lower.includes('total')
  ) {
    if (num >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
    if (num >= 100000) return `${(num / 100000).toFixed(1)}L`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  }
  if (lower.includes('price') || lower.includes('cost')) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  }
  if (typeof value === 'number') return new Intl.NumberFormat('en-US').format(value);
  return String(value);
}

const SimpleTable: React.FC<SimpleTableProps> = ({ data, className, style }) => {
  const [page, setPage] = useState(1);

  if (!data || data.length === 0 || !data[0]) return null;

  const allHeaders = Object.keys(data[0]);
  const stringCols: string[] = [];
  const numericCols: string[] = [];
  allHeaders.forEach(h => {
    const sample = data.find(r => r[h] !== null && r[h] !== undefined)?.[h];
    if (
      typeof sample === 'string' ||
      h.toLowerCase().includes('name') ||
      h.toLowerCase().includes('id')
    ) {
      stringCols.push(h);
    } else {
      numericCols.push(h);
    }
  });
  const headers = [...stringCols, ...numericCols];

  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const rows = data.slice(start, start + PAGE_SIZE);

  return (
    <div
      className={`w-full overflow-x-auto rounded-lg border border-border${className ? ` ${className}` : ''}`}
      style={style}
    >
      <table className='w-full text-sm border-collapse'>
        <thead>
          <tr className='bg-muted/50 border-b border-border'>
            {headers.map(h => (
              <th
                key={h}
                className='px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap'
              >
                {h.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className='border-b border-border last:border-0 hover:bg-muted/30 transition-colors'
            >
              {headers.map(h => (
                <td key={h} className='px-3 py-2 text-xs text-foreground whitespace-nowrap'>
                  {formatCellValue(row[h], h)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className='flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground'>
          <span>
            {start + 1}–{Math.min(start + PAGE_SIZE, data.length)} of {data.length}
          </span>
          <div className='flex items-center gap-1'>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              data-track-category='Charts'
              data-track-name='TABLE_PAGE_PREV'
              className='px-2 py-1 rounded disabled:opacity-40 hover:bg-muted transition-colors'
            >
              ←
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => Math.abs(p - page) <= 1 || p === 1 || p === totalPages)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (
                  i > 0 &&
                  typeof arr[i - 1] === 'number' &&
                  typeof p === 'number' &&
                  p - (arr[i - 1] as number) > 1
                ) {
                  acc.push('...');
                }
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className='px-1'>
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => typeof p === 'number' && setPage(p)}
                    data-track-category='Charts'
                    data-track-name='TABLE_PAGE_SELECT'
                    className={`px-2 py-1 rounded transition-colors ${
                      page === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              data-track-category='Charts'
              data-track-name='TABLE_PAGE_NEXT'
              className='px-2 py-1 rounded disabled:opacity-40 hover:bg-muted transition-colors'
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleTable;
