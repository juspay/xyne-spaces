/**
 * Pure utility functions for cursor-based pagination with cache support.
 * These functions handle merging paginated data and filtering cached windows.
 * No React dependencies - can be used in hooks or outside React.
 */

import type { QueryResult } from '@rocicorp/zero/react';
import type { CacheEntry } from '../machines/queryCacheMachine';

/**
 * Symbol used to mark page breaks in the accumulated cache.
 * When a user jumps to a non-contiguous location, a break is inserted
 * so that filtering knows not to cross the gap.
 */
export const PAGE_BREAK_MARKER = Symbol('PAGE_BREAK_MARKER');

/**
 * Type guard to check if an item is a page break marker.
 */
export function isPageBreak<T>(
  item: T | typeof PAGE_BREAK_MARKER,
): item is typeof PAGE_BREAK_MARKER {
  return item === PAGE_BREAK_MARKER;
}

/**
 * Extract ID from an item.
 */
export function getId(item: unknown): string | undefined {
  return item && typeof item === 'object' && 'id' in item ? (item as { id: string }).id : undefined;
}

/**
 * Compares two items using multiple orderBy fields for sorting.
 * Handles both 'asc' and 'desc' directions. Only numeric fields (timestamps, IDs).
 */
export function compareByOrderBy<T>(
  a: T,
  b: T,
  orderBy: { field: string; direction: 'asc' | 'desc' }[],
): number {
  for (const { field, direction } of orderBy) {
    const aVal = ((a as Record<string, unknown>)[field] as number) ?? 0;
    const bVal = ((b as Record<string, unknown>)[field] as number) ?? 0;
    if (aVal !== bVal) {
      return direction === 'desc' ? bVal - aVal : aVal - bVal;
    }
  }
  return 0;
}

/**
 * Checks if an item matches the cursor based on the specified fields.
 */
export function matchesCursor(item: unknown, cursor: unknown, fields: string[]): boolean {
  if (!item || typeof item !== 'object' || !cursor || typeof cursor !== 'object') {
    return false;
  }
  const itemRecord = item as Record<string, unknown>;
  const cursorRecord = cursor as Record<string, unknown>;
  return fields.every(field => itemRecord[field] === cursorRecord[field]);
}

/**
 * Merges two arrays by ID, removing duplicates.
 * If orderBy is provided, sorts the result.
 */
export function mergeById<T>(
  existing: T[] | undefined,
  incoming: T[],
  orderBy?: { field: string; direction: 'asc' | 'desc' }[],
): T[] {
  if (!existing || existing.length === 0) {
    if (orderBy) {
      return [...incoming].sort((a, b) => compareByOrderBy(a, b, orderBy));
    }
    return incoming;
  }

  const map = new Map<string, T>();
  for (const item of existing) {
    const id = getId(item);
    if (id) map.set(id, item);
  }
  for (const item of incoming) {
    const id = getId(item);
    if (id) map.set(id, item);
  }

  let merged = [...map.values()];
  if (orderBy) {
    merged = merged.sort((a, b) => compareByOrderBy(a, b, orderBy));
  }
  return merged;
}

/**
 * Inserts a new page into accumulated cache with page break markers.
 * Detects non-contiguous jumps and inserts breaks accordingly.
 */
export function insertPageWithBreaks<T>(
  existing: (T | typeof PAGE_BREAK_MARKER)[] | undefined,
  incoming: T[],
  cursor: unknown,
  orderBy?: { field: string; direction: 'asc' | 'desc' }[],
): (T | typeof PAGE_BREAK_MARKER)[] {
  console.log('[lgs] insertPageWithBreaks called with cursor:', orderBy);
  const fields = orderBy?.map(o => o.field) ?? [];
  // Filter out existing breaks to get real items
  const existingItems = existing?.filter((item): item is T => !isPageBreak(item)) ?? [];

  // Check if cursor exists in existing data (contiguous)
  const cursorIndex = existingItems.findIndex(item => matchesCursor(item, cursor, fields));
  const isContiguous = cursor !== null && cursorIndex !== -1;

  // cursor === null means "fetch from the very beginning" (initial or reset load).
  // This is always the freshest data and has no gap relative to the existing cache,
  // so merge cleanly without inserting a PAGE_BREAK_MARKER.
  if (cursor === null || cursor === undefined) {
    return mergeById(existingItems, incoming, orderBy);
  }

  if (isContiguous) {
    // Contiguous: merge without breaks, remove any existing breaks
    return mergeById(existingItems, incoming, orderBy);
  }

  // Non-contiguous (jump): need to insert with break
  let sortedExisting = [...existingItems];
  let sortedIncoming = [...incoming];

  if (orderBy) {
    sortedExisting = sortedExisting.sort((a, b) => compareByOrderBy(a, b, orderBy));
    sortedIncoming = sortedIncoming.sort((a, b) => compareByOrderBy(a, b, orderBy));
  }

  // Determine insertion order based on primary sort field
  const result: (T | typeof PAGE_BREAK_MARKER)[] = [];

  if (!orderBy && Array.isArray(orderBy)) {
    // No sort order - just append with break
    result.push(...sortedExisting, PAGE_BREAK_MARKER, ...sortedIncoming);
  } else {
    const primary = orderBy?.[0];
    const primaryField = primary?.field ?? '';
    const primaryDirection = primary?.direction ?? 'asc';
    const existingFirst =
      ((sortedExisting[0] as Record<string, unknown>)?.[primaryField] as number) ?? 0;
    const incomingFirst =
      ((sortedIncoming[0] as Record<string, unknown>)?.[primaryField] as number) ?? 0;

    // For DESC: higher value = newer; For ASC: lower value = newer
    const incomingIsNewer =
      primaryDirection === 'desc' ? incomingFirst > existingFirst : incomingFirst < existingFirst;

    if (incomingIsNewer) {
      result.push(...sortedIncoming, PAGE_BREAK_MARKER, ...sortedExisting);
    } else {
      result.push(...sortedExisting, PAGE_BREAK_MARKER, ...sortedIncoming);
    }
  }

  // Deduplicate and clean up consecutive/trailing breaks
  return dedupeAndCleanBreaks(result);
}

/**
 * Deduplicates items and cleans up break markers.
 * Removes consecutive breaks and trailing breaks.
 */
function dedupeAndCleanBreaks<T>(
  items: (T | typeof PAGE_BREAK_MARKER)[],
): (T | typeof PAGE_BREAK_MARKER)[] {
  const deduped: (T | typeof PAGE_BREAK_MARKER)[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (isPageBreak(item)) {
      // Only add break if last item wasn't also a break
      if (deduped.length > 0 && !isPageBreak(deduped[deduped.length - 1])) {
        deduped.push(item);
      }
    } else {
      const id = getId(item);
      if (id && !seen.has(id)) {
        seen.add(id);
        deduped.push(item);
      }
    }
  }

  // Remove trailing break if present
  if (deduped.length > 0 && isPageBreak(deduped[deduped.length - 1])) {
    deduped.pop();
  }

  return deduped;
}

/**
 * Filters cached items to return only items after the cursor.
 * Stops at page break markers to prevent crossing non-contiguous ranges.
 */
export function filterAfterCursor<T>(
  items: (T | typeof PAGE_BREAK_MARKER)[],
  cursor: unknown,
  limit: number,
  direction: 'forward' | 'backward' | undefined,
  orderBy?: { field: string; direction: 'asc' | 'desc' }[],
): T[] {
  const fields = orderBy?.map(o => o.field) ?? [];
  // The primary sort field (orderBy[0]) determines how the cache array is laid out.
  const primarySortDesc = (orderBy?.[0]?.direction ?? 'desc') === 'desc';
  const isForward = direction === 'forward';

  // No cursor: return from start until first break or limit
  if (!cursor) {
    const result: T[] = [];
    for (const item of items) {
      if (isPageBreak(item)) break;
      result.push(item);
      if (result.length >= limit) break;
    }
    return result;
  }

  // Find cursor position
  const cursorIndex = items.findIndex(
    item => !isPageBreak(item) && matchesCursor(item, cursor, fields),
  );

  if (cursorIndex === -1) {
    return []; // Cursor not in cache
  }

  const result: T[] = [];

  // For DESC primary sort: forward (newer items) = lower indices.
  // For ASC primary sort:  forward (newer items) = higher indices.
  const forwardTowardStart = primarySortDesc;

  if (isForward === forwardTowardStart) {
    // Walk toward index 0
    for (let i = cursorIndex - 1; i >= 0 && result.length < limit; i--) {
      if (isPageBreak(items[i])) break;
      result.unshift(items[i] as T);
    }
  } else {
    // Walk toward end of array
    for (let i = cursorIndex + 1; i < items.length && result.length < limit; i++) {
      if (isPageBreak(items[i])) break;
      result.push(items[i] as T);
    }
  }

  return result;
}

/**
 * Computes the cached window for cursor pagination.
 * Pure function - no side effects.
 */
export function computeCachedWindow<T>({
  cacheEntry,
  cursor,
  limit,
  direction,
  orderBy,
}: {
  cacheEntry: CacheEntry<T> | undefined;
  cursor: unknown;
  limit: number;
  direction: 'forward' | 'backward' | undefined;
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
}): {
  hasCachedWindow: boolean;
  data: T | null;
  details: QueryResult<T>[1] | null;
} {
  const cachedData = cacheEntry?.data?.[0];

  if (!cachedData || !Array.isArray(cachedData)) {
    return { hasCachedWindow: false, data: null, details: null };
  }

  const filtered = filterAfterCursor(
    cachedData as (Record<string, unknown> | typeof PAGE_BREAK_MARKER)[],
    cursor,
    limit,
    direction,
    orderBy,
  );

  return filtered.length > 0
    ? {
        hasCachedWindow: true,
        data: filtered as T,
        details: cacheEntry.data[1],
      }
    : { hasCachedWindow: false, data: null, details: null };
}
