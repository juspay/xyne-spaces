// TEMPORARY (TestFlight diagnostics, revert before merging): explains why an unread
// channel opened without a "New messages" divider. Every log uses
// LOTUS_CHAT_OPEN_TIMING with one of three `unread_diag_*` milestones:
//   unread_diag_route                  one per tap/route, with the tapped row's badge
//   unread_diag_list_summary           one per open, on leave or app background
//   unread_diag_mark_viewed_on_leave   the read-marking on leaving a chat
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

type UnreadDiagOpenRecord = {
  openStartedAtMs: number;
  rowLooksUnread: boolean | null;
  rowLastViewedAt: number | undefined;
  unreadOpen: string | undefined;
  unreadOpenOffReason: string | undefined;
  rowReadStaleByMs?: number | undefined;
};

const ROW_PRESS_MATCH_MS = 2_000;
const lastRowPressByChannel = new Map<
  string,
  {
    atMs: number;
    looksUnread: boolean;
    lastViewedAt: number | undefined;
    badge: Record<string, unknown>;
  }
>();
const markedViewedAtByChannel = new Map<string, number>();

/** The leave flush's timestamp, so a later open can tell a stale row from a fresh one. */
export const noteUnreadDiagChannelMarkedViewed = (channelId: string, timestamp: number): void => {
  markedViewedAtByChannel.set(channelId, timestamp);
};
const openRecordByChannel = new Map<string, UnreadDiagOpenRecord>();

const readNumber = (row: Record<string, unknown>, key: string): number | undefined => {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/** The list's own unread test: a count, a mention, or activity since the last view. */
const doesRowLookUnread = (row: Record<string, unknown>): boolean => {
  const lastViewedAt = readNumber(row, 'lastViewedAt');
  const lastActivityAt = readNumber(row, 'lastActivityAtMs') ?? readNumber(row, 'lastActivityAt');
  return (
    (readNumber(row, 'unreadCount') ?? 0) > 0 ||
    (readNumber(row, 'messageUnreadCount') ?? 0) > 0 ||
    row['hasUnread'] === true ||
    row['isMentioned'] === true ||
    (lastViewedAt !== undefined &&
      lastViewedAt > 0 &&
      lastActivityAt !== undefined &&
      lastActivityAt > lastViewedAt)
  );
};

/** What the tapped row showed: only the unread/badge fields, never names. */
export const logUnreadDiagRowPress = (
  _source: string,
  channelId: string,
  row: object | null | undefined,
): void => {
  const fields = (row ?? {}) as Record<string, unknown>;
  const badge: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ROW_PRESS_FIELD.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      badge[`row_${key}`] = value;
    }
  }
  const looksUnread = doesRowLookUnread(fields);
  lastRowPressByChannel.set(channelId, {
    atMs: Date.now(),
    looksUnread,
    lastViewedAt: readNumber(fields, 'lastViewedAt'),
    badge,
  });
};

/** The route's unread decision, joined to the row tapped just before it. */
export const logUnreadDiagRoute = (
  fields: Record<string, unknown> & {
    channelId: string;
    openStartedAtMs: number;
    unreadOpen: string | undefined;
    unreadOpenOffReason: string | undefined;
  },
): void => {
  const press = lastRowPressByChannel.get(fields.channelId);
  const matchedPress =
    press && fields.openStartedAtMs - press.atMs <= ROW_PRESS_MATCH_MS ? press : undefined;
  const markedAt = markedViewedAtByChannel.get(fields.channelId);
  const inputLastViewedAt = fields['inputLastViewedAt'];
  const inputLastActivityAt = fields['inputLastActivityAt'];
  const rowReadStaleByMs =
    markedAt !== undefined &&
    typeof inputLastViewedAt === 'number' &&
    Number.isFinite(inputLastViewedAt) &&
    inputLastViewedAt < markedAt &&
    (inputLastActivityAt === undefined ||
      (typeof inputLastActivityAt === 'number' && inputLastActivityAt <= markedAt))
      ? markedAt - inputLastViewedAt
      : undefined;
  openRecordByChannel.set(fields.channelId, {
    openStartedAtMs: fields.openStartedAtMs,
    rowLooksUnread: matchedPress ? matchedPress.looksUnread : null,
    rowLastViewedAt: matchedPress?.lastViewedAt,
    unreadOpen: fields.unreadOpen,
    unreadOpenOffReason: fields.unreadOpenOffReason,
    rowReadStaleByMs,
  });
  logUnreadDiag('unread_diag_route', {
    ...fields,
    ...matchedPress?.badge,
    rowLooksUnread: matchedPress ? matchedPress.looksUnread : null,
    rowReadStaleByMs,
  });
};

export const getUnreadDiagOpenRecord = (
  channelId: string,
  openStartedAtMs: number | null | undefined,
): UnreadDiagOpenRecord | undefined => {
  const record = openRecordByChannel.get(channelId);
  return record && record.openStartedAtMs === openStartedAtMs ? record : undefined;
};

export type UnreadDiagVerdict =
  | 'DIVIDER_SHOWN'
  | 'NOT_UNREAD'
  | 'BADGE_WITHOUT_NEW_MESSAGES'
  | 'BUG_NEW_MESSAGES_BUT_NOT_UNREAD_OPEN'
  | 'UNREAD_OPEN_WITHOUT_BOUNDARY'
  | 'ONLY_OWN_OR_SYSTEM_MESSAGES'
  | 'NO_NEW_MESSAGES_LOADED'
  | 'UNREAD_FROM_ACTIVITY_WITHOUT_MESSAGES'
  | 'BUG_NEW_MESSAGES_NO_DIVIDER'
  | 'BUG_DIVIDER_NEVER_ON_SCREEN'
  | 'BUG_DIVIDER_NOT_DRAWN'
  | 'BUG_DIVIDER_SHOWN_WITHOUT_MESSAGE_BELOW'
  | 'BUG_STALE_READ_STATE';

type UnreadDiagOutcome = {
  verdict: UnreadDiagVerdict;
  expectedDivider: boolean;
  isFailure: boolean;
  explanation: string | undefined;
};

/** Opens that looked unread but correctly had no divider, in words a user can be given. */
const UNREAD_DIAG_EXPLANATIONS: Partial<Record<UnreadDiagVerdict, string>> = {
  BADGE_WITHOUT_NEW_MESSAGES:
    'The badge came from a notification (mention, reaction or thread activity), not a new main-chat message.',
  ONLY_OWN_OR_SYSTEM_MESSAGES:
    'The only new messages were your own or system messages, which the divider skips.',
  UNREAD_FROM_ACTIVITY_WITHOUT_MESSAGES:
    "The channel's activity time moved without a new main-chat message, e.g. a call started inside a thread.",
};

/**
 * One answer per open. `isFailure` means the user had reason to expect a
 * divider (the row looked unread, or the open was an unread open) and never
 * saw one on screen; `verdict` says why. Verdicts starting with BUG_ are ours.
 */
export const resolveUnreadDiagVerdict = ({
  rowLooksUnread,
  isUnreadOpen,
  hasUnreadOpenAnchor,
  dividerEverPresent,
  dividerEverOnScreen,
  dividerShownWithoutMessageBelow,
  dividerDrawChecks,
  dividerEverDrawn,
  rowsAfterBoundary,
  rowsAfterBoundaryEligible,
  rowReadStaleByMs,
  isLiveWindowLoaded,
}: {
  rowLooksUnread: boolean | null;
  isUnreadOpen: boolean;
  hasUnreadOpenAnchor: boolean;
  dividerEverPresent: boolean;
  dividerEverOnScreen: boolean;
  dividerShownWithoutMessageBelow: boolean;
  dividerDrawChecks: number;
  dividerEverDrawn: boolean;
  rowsAfterBoundary: number;
  rowsAfterBoundaryEligible: number;
  rowReadStaleByMs: number | undefined;
  isLiveWindowLoaded: boolean;
}): UnreadDiagOutcome => {
  const expectedDivider = rowLooksUnread === true || isUnreadOpen;
  const result = (verdict: UnreadDiagVerdict): UnreadDiagOutcome => ({
    verdict,
    expectedDivider,
    isFailure:
      verdict === 'BUG_DIVIDER_SHOWN_WITHOUT_MESSAGE_BELOW' ||
      verdict === 'BUG_STALE_READ_STATE' ||
      (expectedDivider && verdict !== 'DIVIDER_SHOWN' && !(verdict in UNREAD_DIAG_EXPLANATIONS)),
    explanation: UNREAD_DIAG_EXPLANATIONS[verdict],
  });
  if (isUnreadOpen && (rowReadStaleByMs ?? 0) > 0) return result('BUG_STALE_READ_STATE');
  if (dividerShownWithoutMessageBelow) return result('BUG_DIVIDER_SHOWN_WITHOUT_MESSAGE_BELOW');
  // The list put the divider in view, but iOS never drew it there.
  if (dividerEverOnScreen && dividerDrawChecks > 0 && !dividerEverDrawn) {
    return result('BUG_DIVIDER_NOT_DRAWN');
  }
  if (dividerEverOnScreen) return result('DIVIDER_SHOWN');
  if (!isUnreadOpen) {
    if (rowsAfterBoundaryEligible > 0) return result('BUG_NEW_MESSAGES_BUT_NOT_UNREAD_OPEN');
    return result(rowLooksUnread === true ? 'BADGE_WITHOUT_NEW_MESSAGES' : 'NOT_UNREAD');
  }
  if (!hasUnreadOpenAnchor) return result('UNREAD_OPEN_WITHOUT_BOUNDARY');
  if (dividerEverPresent) return result('BUG_DIVIDER_NEVER_ON_SCREEN');
  if (rowsAfterBoundaryEligible > 0) return result('BUG_NEW_MESSAGES_NO_DIVIDER');
  if (rowsAfterBoundary > 0) return result('ONLY_OWN_OR_SYSTEM_MESSAGES');
  // Everything up to the latest message loaded and none is newer than the last
  // visit: the channel's activity time moved without a main-chat message.
  return result(
    isLiveWindowLoaded ? 'UNREAD_FROM_ACTIVITY_WITHOUT_MESSAGES' : 'NO_NEW_MESSAGES_LOADED',
  );
};

type RowSample = {
  i: number;
  id: string;
  at: number;
  kind: string;
  type: string;
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
    type: row.paint.rowType,
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
