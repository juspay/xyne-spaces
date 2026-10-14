import type { ChannelTicketRow } from '../types';
import { getTicketStatusStyle } from './ticket-status-style';

/** Trimmed, lower-cased query; empty string when there is nothing to search for. */
export function normalizeTicketSearchQuery(query: string | null | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * Local substring match over a loaded row, mirroring the dashboard table's
 * search filter (title / human id / status / priority / stage). Runs on every
 * keystroke against the loaded window, so results are instant and offline-safe;
 * the Vespa search widens the net to tickets outside the window.
 */
export function channelTicketRowMatchesQuery(
  row: ChannelTicketRow,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const haystack = [
    row.title,
    row.xyneId,
    row.stageName ?? '',
    row.statusV2 ?? '',
    getTicketStatusStyle(row.statusV2).label,
    row.priority ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

export function filterChannelTicketRowsByQuery(
  rows: readonly ChannelTicketRow[],
  query: string | null | undefined,
): ChannelTicketRow[] {
  const normalized = normalizeTicketSearchQuery(query);
  if (!normalized) return [...rows];
  return rows.filter(row => channelTicketRowMatchesQuery(row, normalized));
}

/**
 * Merge local matches with server hits into one stable list:
 * local matches first (already newest-first), then server-only hits in the
 * order the search ranked them. Server hits that are already loaded but did not
 * match locally (Vespa matched on description, for instance) are pulled from the
 * loaded window so they render with full data; the rest come from `hydrated`.
 */
export function mergeChannelTicketSearchRows(
  localMatches: readonly ChannelTicketRow[],
  remoteIds: readonly string[],
  loadedRows: readonly ChannelTicketRow[],
  hydrated: readonly ChannelTicketRow[],
): ChannelTicketRow[] {
  const seen = new Set(localMatches.map(row => row.id));
  const loadedById = new Map(loadedRows.map(row => [row.id, row]));
  const hydratedById = new Map(hydrated.map(row => [row.id, row]));
  const merged = [...localMatches];

  for (const id of remoteIds) {
    if (seen.has(id)) continue;
    const row = loadedById.get(id) ?? hydratedById.get(id);
    if (!row) continue;
    seen.add(id);
    merged.push(row);
  }

  return merged;
}
