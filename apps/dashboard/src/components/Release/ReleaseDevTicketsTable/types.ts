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
  | { kind: 'ticket'; id: string; row: ReleaseDetailDevTicketRow; displayIndex: number };

// A cross-repo ticket is one grid row per group; export it once.
export const pickTicketRows = (rows: readonly GridRow[]): ReleaseDetailDevTicketRow[] => {
  const seen = new Set<string>();
  const out: ReleaseDetailDevTicketRow[] = [];
  for (const r of rows) {
    if (r.kind !== 'ticket' || seen.has(r.row.internalTicketId)) continue;
    seen.add(r.row.internalTicketId);
    out.push(r.row);
  }
  return out;
};
