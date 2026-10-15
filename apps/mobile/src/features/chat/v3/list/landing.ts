import type { ChatRow } from '../model/chatRow.types';
import { keyExtractor } from '../model/rowType';
import type { LandingTarget, OpenState } from '../machine/openState';

export type { ChatMessageRow } from '../model/chatRow.types';

export const targetFromState = (state: OpenState): LandingTarget | null =>
  state.status === 'loading' || state.status === 'placing' || state.status === 'ready'
    ? state.target
    : null;

/** Distinguishes two anchors of the same kind so a re-land is not treated as already confirmed. */
export const landingIdentity = (target: LandingTarget): string =>
  target.kind === 'tail' ? 'tail' : `anchor:${target.messageId}`;

/** Newest message in the window. Tail-open read cursor — not the first visible row. */
export const newestMessageForReadCursor = (
  rows: readonly ChatRow[],
): { conversationId: string; createdAt: number } | null => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.type === 'message') {
      return { conversationId: row.model.conversationId, createdAt: row.model.createdAt };
    }
  }
  return null;
};

/**
 * At the tail, the seen message is the last one. `onFirstVisibleItemChanged`
 * reports the top of the viewport (often a date or unread banner).
 */
export const visibleRowForReadCursor = (
  item: ChatRow | null,
  rows: readonly ChatRow[],
  atEnd: boolean,
): { conversationId: string; createdAt: number } | null => {
  if (atEnd) {
    return newestMessageForReadCursor(rows);
  }
  if (item?.type === 'message') {
    return { conversationId: item.model.conversationId, createdAt: item.model.createdAt };
  }
  return null;
};

/** Index to land on, or `null` when the target row is not in this window. */
export const landingIndex = (rows: readonly ChatRow[], target: LandingTarget): number | null => {
  if (rows.length === 0) {
    return null;
  }
  if (target.kind === 'tail') {
    return rows.length - 1;
  }
  const byMessage = rows.findIndex(
    row =>
      row.type === 'message' &&
      (row.model.messageId === target.messageId || row.model.conversationId === target.messageId),
  );
  return byMessage >= 0 ? byMessage : null;
};

/** Conversation/message id to highlight for a jump target. */
export const jumpHighlightConversationId = (
  rows: readonly ChatRow[],
  target: LandingTarget | null,
): string | null => {
  if (!target || target.kind !== 'anchor') {
    return null;
  }
  const index = landingIndex(rows, target);
  if (index !== null) {
    const row = rows[index];
    if (row?.type === 'message') {
      return row.model.conversationId;
    }
  }
  // Keep highlight stable while the target row is still loading into the window.
  return target.messageId ?? null;
};

export const lockedRowIdFor = (rows: readonly ChatRow[], target: LandingTarget): string | null => {
  const index = landingIndex(rows, target);
  if (index === null) {
    return null;
  }
  const row = rows[index];
  return row ? keyExtractor(row) : null;
};

/**
 * Mount only when the first paint can land.
 * Empty first mount + later rows = blank viewport (LegendList initial scroll
 * is first-mount only). No rows → empty overlay, not a list.
 */
export const canMountConversationList = (
  target: LandingTarget | null,
  status: OpenState['status'],
  rows: readonly ChatRow[],
): boolean => {
  if (!target || rows.length === 0) {
    return false;
  }
  if (status === 'ready' || target.kind === 'tail') {
    return true;
  }
  return landingIndex(rows, target) !== null;
};
