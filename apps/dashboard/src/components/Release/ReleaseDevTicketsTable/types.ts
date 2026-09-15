import type { ReleaseDetailDevTicketRow } from '../../../routes/ReleaseDetailScreen/releaseReport.utils';

export interface RepoHeaderData {
  key: string;
  dotKey: string;
  label: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  tested: number | null;
  total: number;
}

// Full-width, non-selectable group headers interleaved with dev-ticket rows.
// `id` is the ag-grid getRowId.
export type GridRow =
  | { kind: 'group'; id: string; header: RepoHeaderData }
  | { kind: 'ticket'; id: string; row: ReleaseDetailDevTicketRow };

export const pickTicketRows = (rows: readonly GridRow[]): ReleaseDetailDevTicketRow[] =>
  rows
    .filter((r): r is Extract<GridRow, { kind: 'ticket' }> => r.kind === 'ticket')
    .map(r => r.row);
