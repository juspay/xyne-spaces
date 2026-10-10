import { useEffect, useState, type ReactElement } from 'react';
import { Sheet } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { PreviewMessage, PreviewMeta, PreviewSkeletonView, usePreviewDownload } from '../chrome';
import type { PreviewerProps } from '../types';
import { DataGrid } from './grid/DataGrid';
import { MAX_COLUMNS, MAX_ROWS } from './spreadsheet/limits';
import SpreadsheetWorker from './spreadsheet/spreadsheet.worker?worker';
import type { SpreadsheetSheet, SpreadsheetWorkerResponse } from './spreadsheet/spreadsheet.worker';

type Workbook =
  | { status: 'reading' }
  | { status: 'read'; sheets: SpreadsheetSheet[] }
  | { status: 'unreadable' };

/** A workbook as its sheets, one at a time, picked from the tabs along the bottom. */
export default function SpreadsheetPreview(props: PreviewerProps): ReactElement {
  const download = usePreviewDownload();
  const [workbook, setWorkbook] = useState<Workbook>({ status: 'reading' });
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    if (!props.content) return;
    let cancelled = false;
    const worker = new SpreadsheetWorker();
    setWorkbook({ status: 'reading' });
    setSheetIndex(0);
    worker.onmessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
      if (cancelled) return;
      setWorkbook(
        event.data.ok ? { status: 'read', sheets: event.data.sheets } : { status: 'unreadable' },
      );
      worker.terminate();
    };
    worker.onerror = () => {
      if (!cancelled) setWorkbook({ status: 'unreadable' });
      worker.terminate();
    };
    void props.content.arrayBuffer().then(buffer => {
      if (!cancelled) worker.postMessage(buffer, [buffer]);
    });
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [props.content]);

  if (workbook.status === 'reading') return <PreviewSkeletonView shape='grid' />;
  if (workbook.status === 'unreadable' || workbook.sheets.length === 0) {
    return (
      <PreviewMessage
        icon={<Sheet className='size-10 text-muted-foreground' />}
        title="Couldn't read this workbook"
        body='It may be damaged or password-protected. Download it to open it in a spreadsheet app.'
        actions={[
          { label: 'Download', onClick: download, primary: true, trackName: 'PreviewDownloaded' },
        ]}
      />
    );
  }

  const sheets = workbook.sheets;
  const sheet = sheets[Math.min(sheetIndex, sheets.length - 1)] ?? sheets[0];
  if (!sheet) return <PreviewSkeletonView shape='grid' />;
  const columns = sheet.rows.reduce((most, row) => Math.max(most, row.length), 0);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <PreviewMeta>
        {sheets.length > 1 && `${sheets.length} sheets · `}
        {sheet.rows.length.toLocaleString()} {sheet.rows.length === 1 ? 'row' : 'rows'} ·{' '}
        {columns.toLocaleString()} {columns === 1 ? 'column' : 'columns'}
        {sheet.truncated &&
          ` · first ${MAX_ROWS.toLocaleString()} rows and ${MAX_COLUMNS.toLocaleString()} columns — download for all of it`}
      </PreviewMeta>
      <div className='min-h-0 flex-1'>
        {sheet.rows.length > 0 ? (
          <DataGrid key={sheet.name} rows={sheet.rows} columnWidths={sheet.columnWidths} />
        ) : (
          <div className='flex h-full items-center justify-center text-[13px] text-muted-foreground'>
            This sheet is empty
          </div>
        )}
      </div>
      {/* The sheets, along the bottom as a spreadsheet has them. */}
      <div
        role='tablist'
        aria-label='Sheets'
        className='scrollbar-none flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-t border-border bg-muted/40 px-2'
      >
        {sheets.map((each, index) => {
          const isActive = each === sheet;
          return (
            <button
              key={`${index}-${each.name}`}
              type='button'
              role='tab'
              aria-selected={isActive}
              onClick={() => setSheetIndex(index)}
              className={cn(
                'outline-none mb-1 h-7 shrink-0 rounded-md px-3 text-xs transition-colors',
                isActive
                  ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60 focus-visible:bg-background/60 hover:text-foreground focus-visible:text-foreground',
              )}
              data-track-category='FilePreview'
              data-track-name='PreviewSheetChanged'
            >
              {each.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
