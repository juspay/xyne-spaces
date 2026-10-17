export type ReadCursor = { conversationId: string; createdAt: number } | null;

export type VisibleRow = { conversationId: string; createdAt: number };

export type FlushDecision =
  | { kind: 'flush'; timestamp: number; conversationId: string }
  | { kind: 'defer' }
  | { kind: 'skip' };

export const advanceReadCursor = (
  cursor: ReadCursor,
  newestVisible: VisibleRow | null,
  atEnd: boolean,
): ReadCursor => {
  if (!atEnd || !newestVisible) {
    return cursor;
  }
  if (
    cursor &&
    cursor.conversationId === newestVisible.conversationId &&
    cursor.createdAt === newestVisible.createdAt
  ) {
    return cursor;
  }
  if (!cursor || newestVisible.createdAt >= cursor.createdAt) {
    return newestVisible;
  }
  return cursor;
};

export const flushDecision = (
  reason: 'leave' | 'background' | 'viewing',
  cursor: ReadCursor,
  statusKnown: boolean,
  unreadJustSet: boolean,
  now: number,
): FlushDecision => {
  if (unreadJustSet) {
    return { kind: 'skip' };
  }
  if (!statusKnown) {
    return reason === 'viewing' ? { kind: 'skip' } : { kind: 'defer' };
  }
  if (reason === 'viewing' && !cursor) {
    return { kind: 'skip' };
  }
  const createdAt = cursor?.createdAt ?? 0;
  return {
    kind: 'flush',
    timestamp: Math.max(createdAt, now),
    conversationId: cursor?.conversationId ?? '',
  };
};
