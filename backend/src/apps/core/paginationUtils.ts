import { PaginatedResponse } from '../types';

export function decodeCursor<T>(cursor?: string): T | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(decoded) as T;
  } catch (error) {
    throw new Error('Invalid cursor format');
  }
}

export function encodeCursor<T>(cursor: T): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function paginateResults<T, C>(
  results: T[],
  limit: number,
  getCursorFromItem: (item: T) => C
): PaginatedResponse<T> {
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  let nextCursor: string | undefined;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    const cursorData = getCursorFromItem(lastItem);
    nextCursor = encodeCursor(cursorData);
  }

  return {
    items,
    hasMore,
    nextCursor,
  };
}
