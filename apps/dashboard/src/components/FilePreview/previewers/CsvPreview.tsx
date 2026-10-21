import { useEffect, useState, type ReactElement } from 'react';
import { Sheet } from 'lucide-react';
import { PreviewMessage, PreviewMeta, PreviewSkeletonView, usePreviewDownload } from '../chrome';
import { extensionOf } from '../registry';
import type { PreviewerProps } from '../types';
import CsvWorker from './csv/csv.worker?worker';
import type { CsvWorkerRequest, CsvWorkerResponse } from './csv/csv.worker';
import { DataGrid } from './grid/DataGrid';
import { MAX_ROWS } from './spreadsheet/limits';

type Table =
  | { status: 'reading' }
  | { status: 'read'; rows: string[][]; truncated: boolean }
  | { status: 'unreadable' };

/**
 * A CSV or TSV file as a sheet, parsed in a worker so a large one never freezes the
 * page. The delimiter is the extension's, else guessed.
 */
export default function CsvPreview(props: PreviewerProps): ReactElement {
  const download = usePreviewDownload();
  const [table, setTable] = useState<Table>({ status: 'reading' });

  useEffect(() => {
    if (!props.content) return;
    let cancelled = false;
    const worker = new CsvWorker();
    setTable({ status: 'reading' });
    worker.onmessage = (event: MessageEvent<CsvWorkerResponse>) => {
      if (!cancelled) {
        setTable(
          event.data.ok
            ? { status: 'read', rows: event.data.rows, truncated: event.data.truncated }
            : { status: 'unreadable' },
        );
      }
      worker.terminate();
    };
    worker.onerror = () => {
      if (!cancelled) setTable({ status: 'unreadable' });
      worker.terminate();
    };
    const request: CsvWorkerRequest = {
      file: props.content,
      delimiter: extensionOf(props.file.name) === 'tsv' ? '\t' : '',
    };
    worker.postMessage(request);
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [props.content, props.file.name]);

  if (table.status === 'reading') return <PreviewSkeletonView shape='grid' />;
  if (table.status === 'unreadable') {
    return (
      <PreviewMessage
        icon={<Sheet className='size-10 text-muted-foreground' />}
        title="Couldn't read this file"
        body='It may not be plain comma- or tab-separated text. Download it to open it in a spreadsheet app.'
        actions={[
          { label: 'Download', onClick: download, primary: true, trackName: 'PreviewDownloaded' },
        ]}
      />
    );
  }

  const { rows } = table;
  const columns = rows.reduce((most, row) => Math.max(most, row.length), 0);
  return (
    <>
      <PreviewMeta>
        {rows.length.toLocaleString()} {rows.length === 1 ? 'row' : 'rows'} ·{' '}
        {columns.toLocaleString()} {columns === 1 ? 'column' : 'columns'}
        {table.truncated && ` · first ${MAX_ROWS.toLocaleString()} rows — download for all of it`}
      </PreviewMeta>
      <DataGrid rows={rows} />
    </>
  );
}
