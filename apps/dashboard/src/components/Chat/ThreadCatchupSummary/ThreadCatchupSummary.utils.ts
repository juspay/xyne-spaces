import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';

export type ThreadCatchupMessages = QueryResultType<typeof queries.conversationMessagesV2>;
export type ThreadCatchupMessage = ThreadCatchupMessages[number];

/**
 * The most recent message's id — used to tell whether a cached catch-up
 * summary (server-side ThreadSummaryCache, or the localStorage copy) is
 * stale, by comparing against its `asOfMessageId`.
 *
 * The summary is no longer stored as a Message row (see
 * backend/src/services/threadSummaryService.ts) — every entry in
 * `messages` is real thread content, so this is just the last one, no
 * filtering needed.
 */
export function findLatestMessageId(
  messages: readonly ThreadCatchupMessage[] | undefined,
): string | undefined {
  return messages && messages.length > 0 ? messages[messages.length - 1]?.messageId : undefined;
}
