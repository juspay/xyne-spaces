import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';

export type ThreadCatchupMessages = QueryResultType<typeof queries.conversationMessagesV2>;
export type ThreadCatchupMessage = ThreadCatchupMessages[number];

export function findLatestMessageId(
  messages: readonly ThreadCatchupMessage[] | undefined,
): string | undefined {
  return messages && messages.length > 0 ? messages[messages.length - 1]?.messageId : undefined;
}
