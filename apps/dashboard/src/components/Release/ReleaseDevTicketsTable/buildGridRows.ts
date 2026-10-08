import { repoShortName } from '../repoVisual';
import {
  isRowTested,
  type DevTicketRepoGroup,
  type ReleaseDetailDevTicketRow,
} from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import type { GridRow } from './types';

interface BuildGridRowsArgs {
  isMultiRepo: boolean;
  filteredRows: ReleaseDetailDevTicketRow[];
  repoGroups: { groups: DevTicketRepoGroup[]; unmapped: ReleaseDetailDevTicketRow[] };
}

// Turns the flat filtered rows into the ag-grid row model: in multi-repo mode,
// full-width group headers interleaved with their (deduped) ticket rows, empty
// groups dropped and tested/total recomputed from the survivors.
export function buildGridRows({
  isMultiRepo,
  filteredRows,
  repoGroups,
}: BuildGridRowsArgs): GridRow[] {
  if (!isMultiRepo) {
    return filteredRows.map((row, i) => ({
      kind: 'ticket' as const,
      id: `ticket:${row.internalTicketId}`,
      row,
      displayIndex: i + 1,
    }));
  }

  const survivors = new Set(filteredRows.map(row => row.internalTicketId));
  const out: GridRow[] = [];
  let displayIndex = 0;
  const pushGroup = (
    key: string,
    dotKey: string,
    label: string,
    rangeFrom: string | null,
    rangeTo: string | null,
    rows: readonly ReleaseDetailDevTicketRow[],
    showTested: boolean,
  ): void => {
    const kept = rows.filter(row => survivors.has(row.internalTicketId));
    if (kept.length === 0) return;
    out.push({
      kind: 'group',
      id: `group:${key}`,
      header: {
        key,
        dotKey,
        label,
        rangeFrom,
        rangeTo,
        tested: showTested ? kept.filter(isRowTested).length : null,
        total: kept.length,
      },
    });
    // A cross-repo ticket sits in several groups; the row id must be unique per group.
    for (const row of kept) {
      out.push({
        kind: 'ticket',
        id: `ticket:${key}:${row.internalTicketId}`,
        row,
        displayIndex: ++displayIndex,
      });
    }
  };

  for (const group of repoGroups.groups) {
    pushGroup(
      group.key,
      group.key || group.repoUrl || '',
      group.repoUrl ? repoShortName(group.repoUrl) : group.fallbackName || 'Repository',
      group.rangeFrom,
      group.rangeTo,
      group.rows,
      true,
    );
  }
  if (repoGroups.unmapped.length > 0) {
    pushGroup('__unmapped', '', 'Other', null, null, repoGroups.unmapped, false);
  }
  return out;
}
