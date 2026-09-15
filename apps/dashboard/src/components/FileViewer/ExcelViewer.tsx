import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import ExcelParserWorker from './excelParser.worker?worker';
import type { ExcelParserResponse } from './excelParser.worker';
import { HighlightedText } from './search/HighlightedText';
import { cellKey, useSheetsSearch, useGridMatchScroll } from './search';
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

const ExcelViewer: React.FC<BaseViewerProps> = ({ source, searchable }) => {
  const [sheets, setSheets] = useState<{ name: string; data: unknown[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSwitchingSheet, setIsSwitchingSheet] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const columnWidthCache = useRef<Record<string, number[]>>({});
  const workerRef = useRef<Worker | null>(null);
  const { isMobile } = usePlatform();

  // Calculate total table width from column widths
  const totalTableWidth = useMemo(() => {
    return columnWidths.reduce((sum, width) => sum + width, 0);
  }, [columnWidths]);

  const currentSheet = sheets[activeSheet];
  const shouldVirtualizeRows = (currentSheet?.data.length || 0) > 100;
  const shouldVirtualizeColumns = columnWidths.length > 80;
  const shouldUse2DVirtualization = shouldVirtualizeRows && shouldVirtualizeColumns;

  const loadFile = useCallback((): void => {
    if (!source) return;

    setLoading(true);

    // Clean up existing worker if any
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    // Create new worker for this parse operation
    const worker = new ExcelParserWorker();
    workerRef.current = worker;

    // Set up message handler
    worker.onmessage = (event: MessageEvent<ExcelParserResponse>) => {
      const { type, sheets, error } = event.data;

      if (type === 'SUCCESS' && sheets) {
        setSheets(sheets);
        setActiveSheet(0);
        setLoading(false);
      } else if (type === 'ERROR') {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error parsing Excel file:'),
          error: error,
        });
        setLoading(false);
      }

      // Clean up worker after use
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };

    worker.onerror = error => {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Worker error:'),
        error: error,
      });
      setLoading(false);
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };

    // Read file and send to worker with transferable ArrayBuffer
    const reader = new FileReader();
    reader.onload = (e): void => {
      const arrayBuffer = e.target?.result;
      if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
        setLoading(false);
        return;
      }

      // Transfer ArrayBuffer to worker (zero-copy, main thread loses ownership)
      worker.postMessage(
        {
          type: 'PARSE',
          arrayBuffer,
        },
        [arrayBuffer], // Transfer ownership to worker
      );
    };

    reader.onerror = () => {
      setLoading(false);
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };

    reader.readAsArrayBuffer(source);
  }, [source]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Calculate column widths based on active sheet (with caching)
  useEffect(() => {
    if (!currentSheet || currentSheet.data.length === 0) {
      setColumnWidths([]);
      return;
    }

    // Check cache first
    const cached = columnWidthCache.current[currentSheet.name];
    if (cached) {
      setColumnWidths(cached);
      return;
    }

    const firstRow = currentSheet.data[0];
    if (!firstRow) {
      setColumnWidths([]);
      return;
    }

    const widths = firstRow.map(() => 0);
    const sampleRowSize = Math.min(currentSheet.data.length, 100);
    const sampleColSize = Math.min(firstRow.length, 100);

    for (let i = 0; i < sampleRowSize; i++) {
      const row = currentSheet.data[i];
      if (!row) continue;
      for (let j = 0; j < Math.min(row.length, sampleColSize) && j < widths.length; j++) {
        const cellWidth = String(row[j]).length || 0;
        const currentWidth = widths[j];
        if (currentWidth !== undefined && cellWidth > currentWidth) {
          widths[j] = cellWidth;
        }
      }
    }

    // Convert to CSS units (approx 10px per character)
    const computed = widths.map(w => Math.max(w * 10, 100));
    columnWidthCache.current[currentSheet.name] = computed;
    setColumnWidths(computed);
  }, [currentSheet?.name]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // Virtualizer for rows - must be called at top level before any returns
  const rowVirtualizer = useVirtualizer({
    count: currentSheet?.data.length || 0,
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

  // Search spans every sheet. When the active match is on another sheet, the
  // hook switches to it; activeCellMatch is only set once that sheet is shown.
  const { matchesByCell, activeCellMatch } = useSheetsSearch(
    sheets,
    activeSheet,
    setActiveSheet,
    searchable !== false && !loading && sheets.length > 0,
  );
  useGridMatchScroll(
    activeCellMatch,
    rowVirtualizer,
    columnVirtualizer,
    shouldVirtualizeRows,
    shouldVirtualizeColumns,
    parentRef,
  );

  // Read the active match without making it a dep of the reset effect below.
  const activeCellMatchRef = useRef(activeCellMatch);
  activeCellMatchRef.current = activeCellMatch;

  // Reset virtualizers on sheet switch — but not when search drove the switch,
  // or it would scroll to the top and clobber the reveal of the match that
  // caused the switch.
  useEffect(() => {
    if (activeCellMatchRef.current) return;
    rowVirtualizer.scrollToIndex(0);
    columnVirtualizer.scrollToIndex(0);
  }, [activeSheet, rowVirtualizer, columnVirtualizer]);

  // Handle sheet switching with transition lock
  const onSheetChange = (idx: number) => {
    setIsSwitchingSheet(true);
    setActiveSheet(idx);
  };

  // Clear switching state after render
  useEffect(() => {
    if (isSwitchingSheet) {
      const id = requestAnimationFrame(() => {
        setIsSwitchingSheet(false);
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isSwitchingSheet, activeSheet]);

  if (loading) {
    return (
      <div className='pt-[65px] p-4 flex items-center justify-center h-full min-h-[200px]'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3'></div>
          <p className='text-muted-foreground dark:text-muted text-sm'>Loading Excel file...</p>
        </div>
      </div>
    );
  }

  if (sheets.length === 0) {
    return <div className='pt-[65px] p-4 text-foreground'>No data found in Excel file</div>;
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
    <div className='pt-[65px] h-full'>
      {/* Sheet selector */}
      <div className='flex space-x-2 mb-2 overflow-x-auto'>
        {sheets.map((sheet, idx) => (
          <button
            key={sheet.name}
            onClick={() => onSheetChange(idx)}
            className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'} border rounded whitespace-nowrap flex-shrink-0 ${
              idx === activeSheet
                ? 'bg-action-primary text-action-primary-foreground'
                : 'bg-background text-foreground '
            }`}
            data-track-category='FileViewer'
            data-track-name='SWITCH_SHEET'
            data-track-metadata={JSON.stringify({ sheetName: sheet.name, sheetIndex: idx })}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div ref={parentRef} className='overflow-auto' style={{ height: 'calc(100% - 40px)' }}>
        <div
          className='border border-input'
          style={{
            width: totalTableWidth,
          }}
        >
          {isSwitchingSheet ? (
            <div className='p-4 text-sm text-muted-foreground'>Loading sheet…</div>
          ) : shouldUse2DVirtualization && currentSheet && visibleCols ? (
            // 2-D Virtualization: Both rows and columns
            <div
              style={{
                width: totalTableWidth,
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const row = currentSheet.data[virtualRow.index];
                if (!row) return null;
                const isLastRow = virtualRow.index === currentSheet.data.length - 1;

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
                      const cellValue = row[virtualCol.index];
                      const isLastVisibleCol = virtualCol.index === lastVisibleCol?.index;

                      return (
                        <Cell
                          key={virtualCol.index}
                          value={cellValue?.toString() ?? ''}
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
          ) : shouldVirtualizeColumns && currentSheet && visibleColumns ? (
            // Column-only virtualization
            <div
              style={{
                width: columnVirtualizer.getTotalSize(),
              }}
            >
              <div className='flex flex-col'>
                {currentSheet.data.map((row, i) => {
                  const isLastRow = i === currentSheet.data.length - 1;

                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        paddingLeft: columnOnlyLeftOffset,
                      }}
                    >
                      {visibleColumns.map(virtualCol => {
                        const cellValue = row[virtualCol.index];
                        const isLastVisibleCol =
                          virtualCol.index === lastVisibleColForColumns?.index;

                        return (
                          <Cell
                            key={virtualCol.index}
                            value={cellValue?.toString() ?? ''}
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
          ) : shouldVirtualizeRows && currentSheet ? (
            // Row-only virtualization
            <div style={{ width: totalTableWidth }}>
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const row = currentSheet.data[virtualRow.index];
                  if (!row) return null;
                  const isLastRow = virtualRow.index === currentSheet.data.length - 1;
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
                          value={cell?.toString() ?? ''}
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
          ) : (
            // No virtualization
            <div style={{ width: totalTableWidth }}>
              <div className='flex flex-col'>
                {currentSheet &&
                  currentSheet.data.map((row, i) => {
                    const isLastRow = i === currentSheet.data.length - 1;
                    const lastColIndex = row.length - 1;

                    return (
                      <div key={i} style={{ display: 'flex' }}>
                        {row.map((cell, j) => (
                          <Cell
                            key={j}
                            value={cell?.toString() ?? ''}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExcelViewer;
