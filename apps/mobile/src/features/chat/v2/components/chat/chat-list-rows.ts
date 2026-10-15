import { useEffect, useMemo } from 'react';
import type { ChannelScopeType, User } from '@xyne/shared';

import type { ChatMessageRow } from '@/src/features/chat/v2/components/chat/chat-message-list-row';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { getDuplicateChatRowIds } from './chat-list-policy';
import {
  CHAT_LIST_INITIAL_ITEM_SIZE,
  getChatRowEstimatedHeight,
  getDateRowEstimatedHeight,
  getUnreadDividerRowHeight,
} from '@/src/features/chat/v2/paint/chatPaintSizing';

export type ChatRow =
  | { type: 'date'; id: string; date: number }
  | { type: 'unread-divider'; id: string }
  | ChatMessageRow;

export const UNREAD_DIVIDER_ROW_ID = 'unread-divider';

export type UnreadBoundaryCursor = {
  lastViewedAt?: number | undefined;
  lastViewedConversationId?: string | undefined;
};

const getTimestampBoundaryAnchorIndex = (
  rows: readonly ChatRow[],
  boundaryLastViewedAt: number | undefined,
): number => {
  if (!boundaryLastViewedAt || boundaryLastViewedAt <= 0) return -1;
  let hasCoveredMessageAtOrBeforeBoundary = false;
  let firstMessageAfterBoundaryIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isUnreadEligibleMessageRow(row)) continue;
    if (row.paint.createdAt <= boundaryLastViewedAt) {
      hasCoveredMessageAtOrBeforeBoundary = true;
      continue;
    }
    if (firstMessageAfterBoundaryIndex < 0) {
      firstMessageAfterBoundaryIndex = index;
    }
    if (!hasCoveredMessageAtOrBeforeBoundary) return firstMessageAfterBoundaryIndex;
    return index;
  }
  return -1;
};

const getCursorBoundaryAnchorIndex = (
  rows: readonly ChatRow[],
  boundaryLastViewedConversationId: string | undefined,
  boundaryLastViewedAt: number | undefined,
): number => {
  if (!boundaryLastViewedConversationId) return -1;
  const lastViewedIndex = rows.findIndex(
    row => row.type === 'message' && row.id === boundaryLastViewedConversationId,
  );
  if (lastViewedIndex < 0) return -1;

  for (let index = lastViewedIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isUnreadEligibleMessageRow(row)) continue;
    if (
      typeof boundaryLastViewedAt === 'number' &&
      Number.isFinite(boundaryLastViewedAt) &&
      boundaryLastViewedAt > 0 &&
      row.paint.createdAt < boundaryLastViewedAt
    ) {
      return -1;
    }
    return index;
  }
  return -1;
};

// Inserts a single standalone "New messages" divider row. Prefer the stable
// last-viewed conversation cursor when available; the timestamp fallback only exists for legacy
// statuses that do not have a cursor id yet.
const insertUnreadDividerRow = (
  rows: ChatRow[],
  unreadBoundaryCursor: UnreadBoundaryCursor | undefined,
): ChatRow[] => {
  const boundaryLastViewedConversationId = unreadBoundaryCursor?.lastViewedConversationId;
  const boundaryLastViewedAt = unreadBoundaryCursor?.lastViewedAt;
  const cursorAnchorIndex = boundaryLastViewedConversationId
    ? getCursorBoundaryAnchorIndex(rows, boundaryLastViewedConversationId, boundaryLastViewedAt)
    : -1;
  const anchorIndex =
    cursorAnchorIndex >= 0
      ? cursorAnchorIndex
      : getTimestampBoundaryAnchorIndex(rows, boundaryLastViewedAt);

  if (anchorIndex < 0) return rows;

  if (!boundaryLastViewedAt || boundaryLastViewedAt <= 0) return rows;
  const anchorRow = rows[anchorIndex];
  const anchorId = anchorRow?.type === 'message' ? anchorRow.id : String(boundaryLastViewedAt);
  const nextRows = [...rows];
  nextRows.splice(anchorIndex, 0, {
    type: 'unread-divider',
    id: `${UNREAD_DIVIDER_ROW_ID}:${boundaryLastViewedConversationId ?? boundaryLastViewedAt}:${anchorId}`,
  });
  return nextRows;
};

const isUnreadEligibleMessageRow = (row: ChatRow | undefined): row is ChatMessageRow => {
  if (!row || row.type !== 'message') return false;
  if (row.paint.rowKind === 'CURRENT_USER') return false;
  if (row.paint.rowKind === 'SYSTEM' && !row.paint.ticketPreview) return false;
  return true;
};

export const getUnreadJumpTargetRowIndex = (
  rows: readonly ChatRow[],
  unreadDividerRowIndex: number,
): number => {
  if (unreadDividerRowIndex < 0) return -1;
  for (let index = unreadDividerRowIndex + 1; index < rows.length; index += 1) {
    if (rows[index]?.type === 'message') return index;
  }
  return unreadDividerRowIndex;
};

export const hasLoadedMessageAtOrBefore = (
  rows: readonly ChatRow[],
  beforeRowId: string,
  boundaryCreatedAt: number,
): boolean => {
  const boundaryIndex = rows.findIndex(row => row.id === beforeRowId);
  if (boundaryIndex < 0) return false;
  for (let index = 0; index < boundaryIndex; index += 1) {
    const row = rows[index];
    if (row?.type === 'message' && row.paint.createdAt <= boundaryCreatedAt) return true;
  }
  return false;
};

export const hasLoadedTimestampBoundaryCoverage = (
  rows: readonly ChatRow[],
  boundaryCreatedAt: number | undefined,
): boolean => {
  if (
    typeof boundaryCreatedAt !== 'number' ||
    !Number.isFinite(boundaryCreatedAt) ||
    boundaryCreatedAt <= 0
  ) {
    return false;
  }

  let hasMessageAtOrBeforeBoundary = false;
  let hasMessageAfterBoundary = false;
  for (const row of rows) {
    if (!isUnreadEligibleMessageRow(row)) continue;
    if (row.paint.createdAt <= boundaryCreatedAt) {
      hasMessageAtOrBeforeBoundary = true;
    } else {
      hasMessageAfterBoundary = true;
    }
    if (hasMessageAtOrBeforeBoundary && hasMessageAfterBoundary) return true;
  }
  return false;
};

/** Only return a size when the rendered row has an explicit, invariant height. */
export const getChatRowFixedSize = (item: ChatRow): number | undefined =>
  item.type === 'unread-divider' ? getUnreadDividerRowHeight() : undefined;

/**
 * LegendList accepts one initial estimate and then learns averages per item type.
 * Seed that first allocation with the current rows so media/ticket-heavy opens do
 * not start from the short-text default. The actual rows remain dynamic and are
 * measured by the list after mount.
 */
export const getChatListEstimatedItemSize = (
  rows: readonly ChatRow[],
  charsPerLine?: number,
): number => {
  if (rows.length === 0) return CHAT_LIST_INITIAL_ITEM_SIZE;

  let totalHeight = 0;
  for (const row of rows) {
    if (row.type === 'date') {
      totalHeight += getDateRowEstimatedHeight();
    } else if (row.type === 'unread-divider') {
      totalHeight += getUnreadDividerRowHeight();
    } else {
      totalHeight += getChatRowEstimatedHeight(row.paint, charsPerLine);
    }
  }

  return Math.max(
    CHAT_LIST_INITIAL_ITEM_SIZE,
    Math.min(320, Math.round(totalHeight / rows.length)),
  );
};

export type ChatRowIndexes = {
  byConversationId: ReadonlyMap<string, number>;
  byMessageId: ReadonlyMap<string, number>;
};

const EMPTY_ROW_INDEXES: ChatRowIndexes = {
  byConversationId: new Map(),
  byMessageId: new Map(),
};

export const buildChatRowIndexes = (rows: readonly ChatRow[]): ChatRowIndexes => {
  if (rows.length === 0) return EMPTY_ROW_INDEXES;
  const byConversationId = new Map<string, number>();
  const byMessageId = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.type !== 'message') continue;
    byConversationId.set(row.id, index);
    if (row.paint.messageId) {
      byMessageId.set(row.paint.messageId, index);
    }
  }
  return {
    byConversationId,
    byMessageId,
  };
};

export const findTargetRowIndex = (
  indexes: ChatRowIndexes,
  conversationId?: string | undefined,
  messageId?: string | undefined,
): number | null => {
  if (!conversationId && !messageId) return null;
  if (messageId) {
    const messageIdx = indexes.byMessageId.get(messageId);
    if (messageIdx !== undefined) return messageIdx;
  }
  if (!conversationId) return null;
  return indexes.byConversationId.get(conversationId) ?? null;
};

type UseChatListRowsInput = {
  channelId: string;
  channelType?: ChannelScopeType | undefined;
  currentUser: User | undefined;
  hasRouteAnchor: boolean;
  isNotificationOpen?: boolean | undefined;
  messageId?: string | undefined;
  paintRows: ChatPaintRow[];
  unreadBoundaryCursor?: UnreadBoundaryCursor | undefined;
};

type UseChatListRowsResult = {
  rows: ChatRow[];
  displayRows: ChatRow[];
  displayRowIndexes: ChatRowIndexes;
};

export const useChatListRows = ({
  channelId,
  channelType,
  currentUser,
  hasRouteAnchor,
  isNotificationOpen,
  messageId,
  paintRows,
  unreadBoundaryCursor,
}: UseChatListRowsInput): UseChatListRowsResult => {
  void channelId;
  void channelType;
  void currentUser;
  void isNotificationOpen;
  void messageId;

  const rows = useMemo<ChatRow[]>(() => {
    const nextRows: ChatRow[] = [];
    let prevDateKey: string | null = null;
    for (const row of paintRows) {
      const dateKey = new Date(row.createdAt).toDateString();
      if (dateKey !== prevDateKey) {
        nextRows.push({ type: 'date', id: `date-${dateKey}`, date: row.createdAt });
        prevDateKey = dateKey;
      }
      nextRows.push({ type: 'message', id: row.conversationId, paint: row });
    }
    return nextRows;
  }, [paintRows]);
  const displayRows = useMemo(() => {
    // Route-anchor opens (notification/deeplink/activity) land on a specific
    // message and never show the unread divider, so only inject it for normal
    // opens. Notification synth-row injection retired — the shared
    // channelConversations / threadConversations caches serve the same warm
    // paint via Zero/useCachedQuery.
    if (hasRouteAnchor) return rows;
    return insertUnreadDividerRow(rows, unreadBoundaryCursor);
  }, [hasRouteAnchor, rows, unreadBoundaryCursor]);
  const displayRowIndexes = useMemo(() => buildChatRowIndexes(displayRows), [displayRows]);

  useEffect(() => {
    if (!__DEV__) return;
    const duplicateIds = getDuplicateChatRowIds(displayRows);
    if (duplicateIds.length === 0) return;
    // This is intentionally loud in development: duplicate keys corrupt
    // recycled row ownership and are otherwise difficult to diagnose.
    // eslint-disable-next-line no-console
    console.error('[ChatList] duplicate row keys', duplicateIds);
  }, [displayRows]);

  return {
    rows,
    displayRows,
    displayRowIndexes,
  };
};
