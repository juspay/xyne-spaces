/* eslint-disable local-rules/require-tracking-on-click */
import type { ReactElement } from 'react';
import { Download } from 'lucide-react';
import {
  buildDevTicketsCsv,
  buildDevTicketsCsvFilename,
  downloadCsvFile,
  type ReleaseDetailDevTicketRow,
} from '../../../routes/ReleaseDetailScreen/releaseReport.utils';

interface ReleaseDevTicketBulkBarProps {
  selectedRows: ReleaseDetailDevTicketRow[];
  selectedColumns: { key: string; label: string }[];
  releaseTicketXyneId: string | null | undefined;
  releaseVersion: string | null;
  onClear: () => void;
}

export const ReleaseDevTicketBulkBar = ({
  selectedRows,
  selectedColumns,
  releaseTicketXyneId,
  releaseVersion,
  onClear,
}: ReleaseDevTicketBulkBarProps): ReactElement | null => {
  if (selectedRows.length === 0) return null;

  const exportSelected = (): void => {
    const filename = buildDevTicketsCsvFilename(releaseTicketXyneId, releaseVersion).replace(
      /\.csv$/,
      '-selection.csv',
    );
    downloadCsvFile(buildDevTicketsCsv(selectedRows, selectedColumns), filename);
  };

  return (
    <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm'>
      <span className='font-medium text-foreground'>{selectedRows.length} selected</span>
      <button
        type='button'
        onClick={exportSelected}
        data-testid='release-dev-tickets-export-selected'
        className='inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted'
      >
        <Download size={13} />
        Export selected
      </button>
      <button
        type='button'
        onClick={onClear}
        className='ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground'
      >
        Clear selection
      </button>
    </div>
  );
};
