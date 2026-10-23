/**
 * A conversation is either a plain thread (`/chat/[channelId]/[threadId]`) or a
 * ticket thread (`/ticket/[ticketId]` with the Thread tab selected). Push
 * payloads do not reliably carry the ticket identity, so the route must derive
 * the surface from the conversation already available in cache/live data.
 */
import { parseTicketMd } from '@xyne/shared';
import { getThreadSnapshot } from '@xyne/shared/messages';

type TicketBearingConversation = {
  readonly ticketId?: string | null | undefined;
  readonly ticket?: { readonly id?: string | null | undefined } | null | undefined;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  readonly ticket_md?: string | null | undefined;
};

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};

/** Return the ticket a conversation belongs to, or null for a plain thread. */
export function readConversationTicketId(
  conversation: TicketBearingConversation | null | undefined,
): string | null {
  if (!conversation) return null;
  return (
    nonEmpty(conversation.ticketId) ??
    nonEmpty(conversation.ticket?.id) ??
    nonEmpty(parseTicketMd(conversation.ticket_md ?? null)?.id) ??
    null
  );
}

/** Read the ticket identity synchronously from the local thread cache. */
export function getCachedThreadTicketId(params: {
  channelId: string;
  threadId: string;
}): string | null {
  const { channelId, threadId } = params;
  if (!channelId.trim() || !threadId.trim()) return null;

  const snapshot = getThreadSnapshot({
    kind: 'thread',
    channelId,
    conversationId: threadId,
    isMember: true,
  });
  return readConversationTicketId(snapshot);
}
