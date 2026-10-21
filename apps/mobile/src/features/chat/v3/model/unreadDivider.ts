import type { ChatRow, MessageRowModel } from './chatRow.types';
import type { BuildRowsContext } from './conversationInput';

export const UNREAD_DIVIDER_ROW_ID = 'unread-divider';

const isUnreadEligible = (model: MessageRowModel): boolean => {
  if (model.rowKind === 'CURRENT_USER') {
    return false;
  }
  if (model.rowKind === 'SYSTEM' && !model.ticketPreview) {
    return false;
  }
  return true;
};

const timestampAnchorIndex = (rows: readonly ChatRow[], lastViewedAt: number): number => {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.type !== 'message' || !isUnreadEligible(row.model)) {
      continue;
    }
    if (row.model.createdAt > lastViewedAt) {
      return index;
    }
  }
  return -1;
};

const cursorAnchorIndex = (
  rows: readonly ChatRow[],
  lastViewedConversationId: string,
  lastViewedAt: number,
): number => {
  const lastViewedIndex = rows.findIndex(
    row => row.type === 'message' && row.id === lastViewedConversationId,
  );
  if (lastViewedIndex < 0) {
    return -1;
  }
  for (let index = lastViewedIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.type !== 'message' || !isUnreadEligible(row.model)) {
      continue;
    }
    if (row.model.createdAt < lastViewedAt) {
      return -1;
    }
    return index;
  }
  return -1;
};

/**
 * v2 paints a single "New messages" row. The channel-list unread *count* is not
 * the label — it is often stale or 1 while many messages sit below the cursor.
 * Prefer the last-viewed conversation id; fall back to first eligible message
 * after lastViewedAt. Own messages and non-ticket system rows are skipped.
 */
export const insertUnreadDivider = (rows: ChatRow[], ctx: BuildRowsContext): ChatRow[] => {
  const lastViewedAt = ctx.unreadBoundaryAt;
  if (lastViewedAt === undefined || !Number.isFinite(lastViewedAt) || lastViewedAt <= 0) {
    return rows;
  }
  const lastViewedConversationId = ctx.unreadBoundaryConversationId;
  const cursorIndex = lastViewedConversationId
    ? cursorAnchorIndex(rows, lastViewedConversationId, lastViewedAt)
    : -1;
  const anchorIndex = cursorIndex >= 0 ? cursorIndex : timestampAnchorIndex(rows, lastViewedAt);
  if (anchorIndex < 0) {
    return rows;
  }
  const next = [...rows];
  next.splice(anchorIndex, 0, { type: 'unread-divider', id: UNREAD_DIVIDER_ROW_ID });
  return next;
};
