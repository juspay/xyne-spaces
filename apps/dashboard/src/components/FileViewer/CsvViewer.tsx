import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Papa from 'papaparse';
import { BaseViewerProps } from './utils';
import { HighlightedText } from './search/HighlightedText';
import { cellKey, useGridSearch, useGridMatchScroll } from './search';
import { ACTIVE_CELL_ATTR } from './search/htmlHighlight';
import type { HighlightRange } from './search';

type CellProps = {
  value: string;
  width: number;
  showRightBorder: boolean;
  showBottomBorder: boolean;
  ranges?: HighlightRange[] | undefined;
};

const Cell = React.memo(function Cell({
  value,
  width,
  showRightBorder,
  showBottomBorder,
  ranges,
}: CellProps) {
  const isActiveCell = ranges?.some(range => range.isActive) ?? false;
  return (
    <div
      className='px-2 py-1 text-sm whitespace-nowrap overflow-hidden text-ellipsis text-foreground border-border bg-background'
      style={{
        width,
        borderRight: showRightBorder ? '1px solid hsl(var(--border))' : 'none',
        borderBottom: showBottomBorder ? '1px solid hsl(var(--border))' : 'none',
        boxSizing: 'border-box',
      }}
      {...(isActiveCell && { [ACTIVE_CELL_ATTR]: 'true' })}
    >
      <HighlightedText text={value} ranges={ranges} />
    </div>
  );
});

const CsvViewer: React.FC<BaseViewerProps> = ({ source, searchable }) => {
  const [data, setData] = useState<string[][]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);

  // Calculate total table width from column widths
  const totalTableWidth = useMemo(() => {
    return columnWidths.reduce((sum, width) => sum + width, 0);
  }, [columnWidths]);

  // Determine virtualization strategy
  const shouldVirtualizeRows = data.length > 100;
  const shouldVirtualizeColumns = columnWidths.length > 80;
  const shouldUse2DVirtualization = shouldVirtualizeRows && shouldVirtualizeColumns;

  const loadFile = useCallback((): void => {
    if (!source) return;

    setLoading(true);

    const reader = new FileReader();

    reader.onload = (e): void => {
      const text = e.target?.result;
      if (!text || typeof text !== 'string') {
        setLoading(false);
        return;
      }

      // Shared logic for processing parsed CSV data
      const processParsedData = (parsedData: string[][]): void => {
        setData(parsedData);

        // Calculate column widths based on first 100 rows and columns
        if (parsedData.length > 0 && parsedData[0]) {
          const widths = parsedData[0].map(() => 0);
          const sampleRowSize = Math.min(parsedData.length, 100);
          const sampleColSize = Math.min(parsedData[0].length, 100);

          for (let i = 0; i < sampleRowSize; i++) {
            const row = parsedData[i];
            if (!row) continue;
            for (let j = 0; j < Math.min(row.length, sampleColSize) && j < widths.length; j++) {
              const cellWidth = row[j]?.length || 0;
              const currentWidth = widths[j];
              if (currentWidth !== undefined && cellWidth > currentWidth) {
                widths[j] = cellWidth;
              }
            }
          }

          // Convert to CSS units (approx 10px per character)
          setColumnWidths(widths.map(w => Math.max(w * 10, 100)));
        }

        setLoading(false);
      };

      // Try parsing with worker first (better performance for large files)
      Papa.parse(text, {
        worker: true,
        complete: results => {
          const parsedData = results.data as string[][];
          processParsedData(parsedData);
        },
        error: (error: Error) => {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Papa.parse worker error:'),
            error: error,
          });
          // Fallback to non-worker parsing if worker fails
          // This handles cases where workers are unavailable or restricted
          Papa.parse(text, {
            worker: false,
            complete: results => {
              const parsedData = results.data as string[][];
              processParsedData(parsedData);
            },
            error: (fallbackError: Error) => {
              logger.error(LogEvent.FRONTEND_ERROR, {
                type: 'migrated_console_error',
                message: String('Papa.parse fallback error:'),
                error: fallbackError,
              });
              setLoading(false);
            },
          });
        },
      });
    };

    reader.onerror = () => {
      setLoading(false);
    };

    reader.readAsText(source);
  }, [source]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // Virtualizer for rows - must be called at top level before any returns
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 2,
  });

  // Virtualizer for columns - only used when 2-D virtualization is enabled
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnWidths.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => columnWidths[index] ?? 100,
    overscan: 2,
  });

  // Search over the data model, not the DOM: the virtualizers mount only a
  // handful of cells, so a DOM scan would miss almost every match.
  const { matchesByCell, activeMatch } = useGridSearch(
    data,
    searchable !== false && !loading && data.length > 0,
  );
  useGridMatchScroll(
    activeMatch,
    rowVirtualizer,
    columnVirtualizer,
    shouldVirtualizeRows,
    shouldVirtualizeColumns,
    parentRef,
  );

  if (loading) {
    return (
      <div className='pt-[65px] p-4 flex items-center justify-center h-full min-h-[200px]'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3'></div>
          <p className='text-muted-foreground dark:text-muted text-sm'>Loading CSV file...</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return <div className='pt-[65px] p-4 text-foreground'>No data found in CSV file</div>;
  }

  // Compute visible columns once (outside row loops for performance)
  const visibleCols = shouldUse2DVirtualization ? columnVirtualizer.getVirtualItems() : null;
  const visibleColumns =
    shouldVirtualizeColumns && !shouldUse2DVirtualization
      ? columnVirtualizer.getVirtualItems()
      : null;
  const firstVisibleCol = visibleCols?.[0];
  const lastVisibleCol = visibleCols?.[visibleCols.length - 1];
  const firstVisibleColForColumns = visibleColumns?.[0];
  const lastVisibleColForColumns = visibleColumns?.[visibleColumns.length - 1];
  // Column-only mode renders only the visible columns; without this left pad
  // they'd draw flush against x=0 while the scroller sits at scrollLeft, so
  // scrolling right (including search reveal) would show empty space. Mirrors
  // the 2-D path's leftOffset.
  const columnOnlyLeftOffset =
    firstVisibleColForColumns && firstVisibleColForColumns.index > 0
      ? columnWidths.slice(0, firstVisibleColForColumns.index).reduce((sum, w) => sum + w, 0)
      : 0;

  return (
    <div className='overflow-auto pt-[65px] h-full' ref={parentRef}>
      <div
        className='border border-input'
        style={{
          width: totalTableWidth,
        }}
      >
        {shouldUse2DVirtualization && visibleCols ? (
          // 2-D Virtualization: Both rows and columns
          <div
            style={{
              width: totalTableWidth,
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const row = data[virtualRow.index];
              if (!row) return null;
              const isLastRow = virtualRow.index === data.length - 1;

              // Calculate offset for columns before the first visible column
              const leftOffset =
                firstVisibleCol && firstVisibleCol.index > 0
                  ? columnWidths
                      .slice(0, firstVisibleCol.index)
                      .reduce((sum, width) => sum + width, 0)
                  : 0;

              return (
                <div
                  key={`row-${virtualRow.index}`}
                  style={{
                    position: 'absolute',
                    top: Math.floor(virtualRow.start),
                    height: virtualRow.size,
                    width: totalTableWidth,
                    display: 'flex',
                    paddingLeft: leftOffset,
                  }}
                >
                  {visibleCols.map(virtualCol => {
                    const cellValue = row[virtualCol.index] || '';
                    const isLastVisibleCol = virtualCol.index === lastVisibleCol?.index;

                    return (
                      <Cell
                        key={virtualCol.index}
                        value={cellValue}
                        width={columnWidths[virtualCol.index] ?? 100}
                        showRightBorder={!isLastVisibleCol}
                        showBottomBorder={!isLastRow}
                        ranges={matchesByCell.get(cellKey(virtualRow.index, virtualCol.index))}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : shouldVirtualizeRows ? (
          // Row-only virtualization
          <div style={{ width: totalTableWidth }}>
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const row = data[virtualRow.index];
                if (!row) return null;
                const isLastRow = virtualRow.index === data.length - 1;
                const lastColIndex = row.length - 1;

                return (
                  <div
                    key={`row-${virtualRow.index}`}
                    style={{
                      position: 'absolute',
                      top: Math.floor(virtualRow.start),
                      left: 0,
                      height: virtualRow.size,
                      display: 'flex',
                    }}
                  >
                    {row.map((cell, j) => (
                      <Cell
                        key={j}
                        value={cell}
                        width={columnWidths[j] ?? 100}
                        showRightBorder={j < lastColIndex}
                        showBottomBorder={!isLastRow}
                        ranges={matchesByCell.get(cellKey(virtualRow.index, j))}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : shouldVirtualizeColumns && visibleColumns ? (
          // Column-only virtualization
          <div
            style={{
              width: columnVirtualizer.getTotalSize(),
            }}
          >
            <div className='flex flex-col'>
              {data.map((row, i) => {
                const isLastRow = i === data.length - 1;

                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      paddingLeft: columnOnlyLeftOffset,
                    }}
                  >
                    {visibleColumns.map(virtualCol => {
                      const cellValue = row[virtualCol.index] || '';
                      const isLastVisibleCol = virtualCol.index === lastVisibleColForColumns?.index;

                      return (
                        <Cell
                          key={virtualCol.index}
                          value={cellValue}
                          width={virtualCol.size}
                          showRightBorder={!isLastVisibleCol}
                          showBottomBorder={!isLastRow}
                          ranges={matchesByCell.get(cellKey(i, virtualCol.index))}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // No virtualization
          <div
            className='flex flex-col'
            style={{
              width: totalTableWidth,
            }}
          >
            {data.map((row, i) => {
              const isLastRow = i === data.length - 1;
              const lastColIndex = row.length - 1;

              return (
                <div key={i} style={{ display: 'flex' }}>
                  {row.map((cell, j) => (
                    <Cell
                      key={j}
                      value={cell}
                      width={columnWidths[j] ?? 100}
                      showRightBorder={j < lastColIndex}
                      showBottomBorder={!isLastRow}
                      ranges={matchesByCell.get(cellKey(i, j))}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CsvViewer;
