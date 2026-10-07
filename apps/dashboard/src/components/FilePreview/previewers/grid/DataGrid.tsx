import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../../utils/classNames';
import { usePreviewFind } from '../../chrome';
import type { FindProvider } from '../../find';

/** Past this many cells, the rest are not marked. */
const MATCH_LIMIT = 5000;

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 26;
/** Rows read to size a column by its contents: enough to be fair, few enough to be quick. */
const SIZING_SAMPLE = 200;

/** A, B … Z, AA, AB …: a column's name in a spreadsheet. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

const NUMERIC = /^[-+]?[$€£¥₹]?\s?\d[\d,]*(\.\d+)?\s?%?$/;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * A table of text cells, as a spreadsheet draws one: lettered columns, numbered rows,
 * the first row held at the top as the header it almost always is, numbers set
 * right. Only the cells in sight are drawn, rows and columns both, so a sheet of a
 * hundred thousand rows or two hundred columns scrolls like a small one. Picking a
 * cell shows all of it above the grid, as a spreadsheet's formula bar does.
 */
export function DataGrid(props: {
  rows: readonly (readonly string[])[];
  /** The widths the file sets, in pixels, where it sets them. */
  columnWidths?: readonly (number | undefined)[];
}): ReactElement {
  const { rows } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);

  const columnCount = useMemo(
    () => rows.reduce((most, row) => Math.max(most, row.length), 1),
    [rows],
  );
  const widths = useMemo(() => {
    const sample = rows.slice(0, SIZING_SAMPLE);
    return Array.from({ length: columnCount }, (_, column) => {
      const set = props.columnWidths?.[column];
      if (set !== undefined) return clamp(set, 48, 480);
      const longest = sample.reduce((most, row) => Math.max(most, (row[column] ?? '').length), 0);
      return clamp(longest * 7.5 + 20, 64, 320);
    });
  }, [rows, columnCount, props.columnWidths]);

  const frozen = rows.length > 1 ? 1 : 0;
  const bodyCount = rows.length - frozen;
  const gutter = Math.max(44, String(rows.length).length * 8 + 24);
  const top = HEADER_HEIGHT + frozen * ROW_HEIGHT;

  // Both measure from the scroll's start; the header and the row numbers take a
  // little of it, which the overscan more than covers.
  const rowVirtualizer = useVirtualizer({
    count: bodyCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => widths[index] ?? 120,
    overscan: 4,
  });
  const columns = columnVirtualizer.getVirtualItems();

  // ── Find: every cell's text, not just those drawn ──
  const [marks, setMarks] = useState<{ cells: ReadonlySet<string>; current: string | null } | null>(
    null,
  );
  const foundRef = useRef<{ row: number; column: number }[]>([]);
  const finder = useMemo<FindProvider>(
    () => ({
      search: query => {
        const needle = query.toLowerCase();
        const found: { row: number; column: number }[] = [];
        for (let row = 0; row < rows.length && found.length < MATCH_LIMIT; row += 1) {
          const cells = rows[row] ?? [];
          for (let column = 0; column < cells.length; column += 1) {
            if ((cells[column] ?? '').toLowerCase().includes(needle)) found.push({ row, column });
          }
        }
        foundRef.current = found;
        setMarks({
          cells: new Set(found.map(cell => `${cell.row}:${cell.column}`)),
          current: null,
        });
        return found.length;
      },
      reveal: index => {
        const cell = foundRef.current[index];
        if (!cell) return;
        setMarks(current => current && { ...current, current: `${cell.row}:${cell.column}` });
        setSelected(cell);
        if (cell.row >= frozen)
          rowVirtualizer.scrollToIndex(cell.row - frozen, { align: 'center' });
        columnVirtualizer.scrollToIndex(cell.column, { align: 'center' });
      },
      clear: () => {
        foundRef.current = [];
        setMarks(null);
      },
    }),
    [rows, frozen, rowVirtualizer, columnVirtualizer],
  );
  usePreviewFind(finder);
  const width = gutter + columnVirtualizer.getTotalSize();

  const cells = (rowIndex: number): ReactElement[] =>
    columns.map(column => {
      const value = rows[rowIndex]?.[column.index] ?? '';
      const isSelected = selected?.row === rowIndex && selected.column === column.index;
      const at = `${rowIndex}:${column.index}`;
      const isMatch = marks?.cells.has(at) ?? false;
      const isCurrentMatch = marks?.current === at;
      return (
        <div
          key={column.key}
          role='gridcell'
          aria-selected={isSelected}
          tabIndex={-1}
          onClick={() => setSelected({ row: rowIndex, column: column.index })}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelected({ row: rowIndex, column: column.index });
            }
          }}
          data-track-category='FilePreview'
          data-track-name='PreviewCellSelected'
          {...(isCurrentMatch && { 'data-xyne-find-active-cell': 'true' })}
          className={cn(
            'absolute top-0 h-full cursor-cell truncate border-b border-r border-border/70 px-2 leading-[28px]',
            NUMERIC.test(value) && 'text-right tabular-nums',
            // The find's colours; the current one is bright in both themes, so its
            // text goes dark.
            isMatch && 'bg-[color:var(--search-result-highlight-bg)]',
            isCurrentMatch && 'bg-[color:var(--search-result-active-bg)] text-neutral-900',
            isSelected &&
              'z-[1] outline outline-2 -outline-offset-2 outline-[color:var(--link-color)]',
          )}
          style={{ left: gutter + column.start, width: column.size }}
          title={value.length > 24 ? value : undefined}
        >
          {value}
        </div>
      );
    });

  const rowNumber = (rowIndex: number): ReactElement => (
    <div
      className={cn(
        'sticky left-0 z-[2] h-full shrink-0 border-b border-r border-border bg-muted/60 pr-2 text-right text-[11px] leading-[28px] tabular-nums text-muted-foreground backdrop-blur',
        selected?.row === rowIndex && 'bg-muted font-medium text-foreground',
      )}
      style={{ width: gutter }}
    >
      {rowIndex + 1}
    </div>
  );

  const selectedValue = selected ? (rows[selected.row]?.[selected.column] ?? '') : '';

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-8 shrink-0 items-center gap-3 border-b border-border px-3 text-xs'>
        <span className='w-14 shrink-0 font-mono font-medium text-muted-foreground'>
          {selected ? `${columnName(selected.column)}${selected.row + 1}` : ''}
        </span>
        <span aria-hidden='true' className='h-4 w-px shrink-0 bg-border' />
        <span className='min-w-0 flex-1 truncate text-foreground' title={selectedValue}>
          {selected ? (
            selectedValue
          ) : (
            <span className='text-muted-foreground'>Pick a cell to see all of it</span>
          )}
        </span>
      </div>
      <div
        ref={scrollRef}
        role='grid'
        aria-rowcount={rows.length}
        aria-colcount={columnCount}
        className='min-h-0 flex-1 overflow-auto text-[12.5px] text-foreground'
      >
        <div className='relative' style={{ width, height: top + rowVirtualizer.getTotalSize() }}>
          {/* Column letters, and the first row under them, held at the top. */}
          <div className='sticky top-0 z-[3] bg-background' style={{ width, height: top }}>
            <div className='relative flex' style={{ height: HEADER_HEIGHT }}>
              <div
                className='sticky left-0 z-[2] shrink-0 border-b border-r border-border bg-muted'
                style={{ width: gutter }}
              />
              {columns.map(column => (
                <div
                  key={column.key}
                  className={cn(
                    'absolute top-0 h-full border-b border-r border-border bg-muted/60 text-center text-[11px] font-medium leading-[26px] text-muted-foreground',
                    selected?.column === column.index && 'bg-muted text-foreground',
                  )}
                  style={{ left: gutter + column.start, width: column.size }}
                >
                  {columnName(column.index)}
                </div>
              ))}
            </div>
            {frozen === 1 && (
              <div
                className='relative flex font-medium shadow-[0_1px_0_0_hsl(var(--border))]'
                style={{ height: ROW_HEIGHT }}
              >
                {rowNumber(0)}
                {cells(0)}
              </div>
            )}
          </div>
          {rowVirtualizer.getVirtualItems().map(row => {
            const rowIndex = row.index + frozen;
            return (
              <div
                key={row.key}
                role='row'
                className='absolute left-0 flex'
                style={{ top: top + row.start, height: ROW_HEIGHT, width }}
              >
                {rowNumber(rowIndex)}
                {cells(rowIndex)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
