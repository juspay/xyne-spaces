// TEMPORARY (TestFlight diagnostics, never commit): explains why an unread
// channel opened without a "New messages" divider. Every log uses
// LOTUS_CHAT_OPEN_TIMING with an `unread_diag_*` milestone.
import type { ChatRow } from '@/src/features/chat/v2/components/chat/chat-list-rows';
import { Event, logger } from '@/src/utils/logger';

const ROW_PRESS_FIELD = /unread|lastViewed|lastActivity|mention|isStarred|isMuted|^id$/i;
const SAMPLE_SIZE = 8;

export const logUnreadDiag = (milestone: string, fields: Record<string, unknown>): void => {
  logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
    milestone,
    deviceNowMs: Date.now(),
    ...fields,
  });
};

/** What the tapped row showed: only the unread/badge fields, never names. */
export const logUnreadDiagRowPress = (
  source: string,
  channelId: string,
  row: object | null | undefined,
): void => {
  const badge: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    if (!ROW_PRESS_FIELD.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      badge[`row_${key}`] = value;
    }
  }
  logUnreadDiag('unread_diag_row_press', {
    source,
    channelId,
    rowFound: !!row,
    ...badge,
  });
};

type RowSample = {
  i: number;
  id: string;
  at: number;
  kind: string;
  ticket: boolean;
  replies: number;
};

const sampleRow = (row: ChatRow, index: number): RowSample | null => {
  if (row.type !== 'message') return null;
  return {
    i: index,
    id: row.id,
    at: row.paint.createdAt,
    kind: row.paint.rowKind,
    ticket: !!row.paint.ticketPreview,
    replies: row.paint.replyPreview?.count ?? row.paint.replyCount ?? 0,
  };
};

/**
 * Everything the divider rule looks at: which loaded messages sit after the
 * last-viewed boundary, and of what kind. The divider skips the user's own
 * messages and plain system rows, so "after > 0 but eligible = 0" is a badge
 * with nothing to mark.
 */
export const describeUnreadBoundaryRows = (
  rows: readonly ChatRow[],
  lastViewedAt: number | undefined,
  lastViewedConversationId: string | undefined,
): Record<string, unknown> => {
  const hasBoundary = typeof lastViewedAt === 'number' && lastViewedAt > 0;
  const afterByKind: Record<string, number> = {};
  const firstAfter: RowSample[] = [];
  const newest: RowSample[] = [];
  let messageRows = 0;
  let atOrBefore = 0;
  let after = 0;
  let afterEligible = 0;
  let lastAtOrBefore: RowSample | null = null;
  let firstEligibleAfter: RowSample | null = null;
  let oldestAt: number | undefined;
  let newestAt: number | undefined;
  let lastViewedConversationIndex = -1;
  let lastViewedConversationAt: number | undefined;
  let dividerIndex = -1;
  let rowsWithReplies = 0;
  rows.forEach((row, index) => {
    if (row.type === 'unread-divider') dividerIndex = index;
    const sample = sampleRow(row, index);
    if (!sample || row.type !== 'message') return;
    messageRows += 1;
    oldestAt = oldestAt === undefined ? sample.at : Math.min(oldestAt, sample.at);
    newestAt = newestAt === undefined ? sample.at : Math.max(newestAt, sample.at);
    if (sample.replies > 0) rowsWithReplies += 1;
    if (row.id === lastViewedConversationId) {
      lastViewedConversationIndex = index;
      lastViewedConversationAt = sample.at;
    }
    newest.push(sample);
    if (newest.length > SAMPLE_SIZE) newest.shift();
    if (!hasBoundary) return;
    if (sample.at <= lastViewedAt) {
      atOrBefore += 1;
      lastAtOrBefore = sample;
      return;
    }
    after += 1;
    const kindKey = sample.kind === 'SYSTEM' && sample.ticket ? 'SYSTEM_TICKET' : sample.kind;
    afterByKind[kindKey] = (afterByKind[kindKey] ?? 0) + 1;
    const isEligible =
      sample.kind !== 'CURRENT_USER' && (sample.kind !== 'SYSTEM' || sample.ticket);
    if (isEligible) {
      afterEligible += 1;
      firstEligibleAfter ??= sample;
    }
    if (firstAfter.length < SAMPLE_SIZE) firstAfter.push(sample);
  });
  return {
    boundaryLastViewedAt: lastViewedAt,
    boundaryLastViewedConversationId: lastViewedConversationId,
    rowsTotal: rows.length,
    messageRows,
    dividerIndex,
    oldestRowAt: oldestAt,
    newestRowAt: newestAt,
    lastViewedAheadOfNewestMs:
      hasBoundary && newestAt !== undefined ? lastViewedAt - newestAt : undefined,
    lastViewedConversationIndex,
    lastViewedConversationAt,
    rowsAtOrBeforeBoundary: atOrBefore,
    rowsAfterBoundary: after,
    rowsAfterBoundaryEligible: afterEligible,
    afterCurrentUser: afterByKind['CURRENT_USER'] ?? 0,
    afterOtherUser: afterByKind['OTHER_USER'] ?? 0,
    afterBot: afterByKind['BOT'] ?? 0,
    afterTicket: afterByKind['TICKET'] ?? 0,
    afterSystem: afterByKind['SYSTEM'] ?? 0,
    afterSystemTicket: afterByKind['SYSTEM_TICKET'] ?? 0,
    rowsWithReplies,
    lastAtOrBeforeJson: lastAtOrBefore ? JSON.stringify(lastAtOrBefore) : undefined,
    firstEligibleAfterJson: firstEligibleAfter ? JSON.stringify(firstEligibleAfter) : undefined,
    firstAfterJson: JSON.stringify(firstAfter),
    newestRowsJson: JSON.stringify(newest),
  };
};
