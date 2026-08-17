/**
 * Wire helpers for /api/sdk: pagination cursors, batch id parsing, and the
 * list/item response shapes.
 */

import {
  BATCH_IDS_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type ListResponse,
  type PageInfo,
} from '@xyne/spaces-contract';
import { ApiError } from './errors';

/**
 * Cursors are an opaque base64url wrapper around whatever the underlying query
 * uses for its `start` argument. Opaque so the shape can change per query
 * without becoming a public contract.
 */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T = unknown>(cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new ApiError('invalid_request', 'Malformed cursor.');
  }
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return PAGE_SIZE_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError('invalid_request', 'limit must be a positive integer.');
  }
  return Math.min(n, PAGE_SIZE_MAX);
}

export function parseIds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const ids = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return undefined;
  if (ids.length > BATCH_IDS_MAX) {
    throw new ApiError('invalid_request', `At most ${BATCH_IDS_MAX} ids may be requested at once.`);
  }
  return ids;
}

/**
 * `updatedSince` maps onto the universal `lastUpdatedAt` argument that the
 * defineQuery wrapper injects into every query in the catalog — delta reads are
 * available on every list endpoint without per-query work.
 */
export function parseUpdatedSince(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const asNumber = Number(raw);
  const ms = Number.isFinite(asNumber) ? asNumber : Date.parse(String(raw));
  if (!Number.isFinite(ms)) {
    throw new ApiError('invalid_request', 'updatedSince must be an epoch milliseconds value or ISO date.');
  }
  return ms;
}

/**
 * Build a list envelope. `nextCursorFor` derives the cursor from the last row;
 * it is only consulted when the page came back full.
 */
export function listResponse<T>(
  rows: readonly T[],
  limit: number,
  nextCursorFor?: (last: T) => unknown,
): ListResponse<T> {
  const hasMore = rows.length >= limit;
  const last = rows[rows.length - 1];
  const pageInfo: PageInfo =
    hasMore && last !== undefined && nextCursorFor
      ? { hasMore: true, nextCursor: encodeCursor(nextCursorFor(last)) }
      : { hasMore };
  return { data: rows, pageInfo };
}
