import { useMemo, type ReactElement } from 'react';
import Papa from 'papaparse';
import { PreviewMeta, PreviewSkeletonView } from '../chrome';
import { useFileText } from '../content';
import { extensionOf } from '../registry';
import type { PreviewerProps } from '../types';
import { DataGrid } from './grid/DataGrid';

/** A CSV or TSV file as a sheet. The delimiter is the extension's, else guessed. */
export default function CsvPreview(props: PreviewerProps): ReactElement {
  const text = useFileText(props.content);
  const delimiter = extensionOf(props.file.name) === 'tsv' ? '\t' : '';
  const rows = useMemo(
    () =>
      text === null
        ? null
        : Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' }).data,
    [text, delimiter],
  );
  if (rows === null) return <PreviewSkeletonView shape='grid' />;

  const columns = rows.reduce((most, row) => Math.max(most, row.length), 0);
  return (
    <>
      <PreviewMeta>
        {rows.length.toLocaleString()} {rows.length === 1 ? 'row' : 'rows'} ·{' '}
        {columns.toLocaleString()} {columns === 1 ? 'column' : 'columns'}
      </PreviewMeta>
      <DataGrid rows={rows} />
    </>
  );
}
