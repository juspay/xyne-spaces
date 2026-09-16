import type { ReleaseDetailDevTicketRow } from '../../../routes/ReleaseDetailScreen/releaseReport.utils';

export interface ReleaseDevTicketFilters {
  statuses: string[];
  types: string[];
  devOwners: string[];
  hotfixOnly: boolean;
}

export const EMPTY_RELEASE_DEV_TICKET_FILTERS: ReleaseDevTicketFilters = {
  statuses: [],
  types: [],
  devOwners: [],
  hotfixOnly: false,
};

export function hasActiveReleaseDevTicketFilters(
  filters: ReleaseDevTicketFilters,
  search: string,
): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.types.length > 0 ||
    filters.devOwners.length > 0 ||
    filters.hotfixOnly ||
    search.trim().length > 0
  );
}

// `searchLower` must be pre-lowercased by the caller.
export function matchesReleaseDevTicketRow(
  row: ReleaseDetailDevTicketRow,
  filters: ReleaseDevTicketFilters,
  searchLower: string,
): boolean {
  if (filters.hotfixOnly && !row.isHotfix) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) return false;
  if (filters.types.length > 0 && !filters.types.includes(row.type)) return false;
  if (filters.devOwners.length > 0 && !filters.devOwners.includes(row.devOwner)) return false;
  if (searchLower) {
    const hay = `${row.ticketId} ${row.title} ${row.devOwner} ${row.prId ?? ''}`.toLowerCase();
    if (!hay.includes(searchLower)) return false;
  }
  return true;
}
