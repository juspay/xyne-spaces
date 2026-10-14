import type { ImperativeRouter as Router } from 'expo-router';

import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { TICKET_ROUTE } from '@/src/features/chat/navigation/chatRoutePolicy';
import { restorePersistedChatWindow } from '@/src/features/chat/navigation/restorePersistedChatWindow';
import { getCachedThreadTicketId } from '@/src/features/chat/navigation/threadTicketSurface';
import { getBookmarkSurface } from '@/src/features/bookmarks/bookmark-utils';

export type DraftsSentOpenInput = {
  channelId: string;
  conversationId?: string | null;
  isThreadReply: boolean;
  messageId?: string;
  scopeType?: string;
  openStartedAtMs?: number;
};

export type DraftsSentOpenDestination =
  | {
      kind: 'ticket';
      ticketId: string;
      channelId: string;
      threadId: string;
    }
  | { kind: 'chat' };

/**
 * Chat/DM threads stay on `/chat/...`. Ticket threads must open the ticket
 * Thread tab directly. Going through ChatThreadScreen first remounts ChatThread
 * and leaves Twin/drafts behind a skeleton.
 */
export const resolveDraftsSentOpenDestination = (
  input: Pick<DraftsSentOpenInput, 'channelId' | 'conversationId' | 'isThreadReply'>,
  ticketId: string | null | undefined,
): DraftsSentOpenDestination => {
  const threadId = input.isThreadReply ? input.conversationId?.trim() : undefined;
  const resolvedTicketId = ticketId?.trim();
  if (!threadId || !resolvedTicketId) {
    return { kind: 'chat' };
  }
  return {
    kind: 'ticket',
    ticketId: resolvedTicketId,
    channelId: input.channelId,
    threadId,
  };
};

/** Twin highlight id. Never fall back to the conversation UUID. */
export const twinDraftOpenMessageId = (
  twin: { sourceMessageId?: string; conversationId: string } | undefined,
): string | undefined => {
  if (!twin) return undefined;
  const source = twin.sourceMessageId?.trim();
  if (!source || source === twin.conversationId) return undefined;
  return source;
};

export const executeDraftsSentChatOpen = (
  router: Pick<Router, 'push' | 'replace' | 'setParams'>,
  input: DraftsSentOpenInput,
): boolean => {
  const threadId = input.isThreadReply ? input.conversationId?.trim() : undefined;
  const ticketId = threadId
    ? getCachedThreadTicketId({ channelId: input.channelId, threadId })
    : null;
  const destination = resolveDraftsSentOpenDestination(input, ticketId);
  const openStartedAtMs = input.openStartedAtMs ?? Date.now();

  if (destination.kind === 'ticket') {
    restorePersistedChatWindow({
      channelId: destination.channelId,
      kind: 'thread',
      threadId: destination.threadId,
      conversationId: destination.threadId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
    });
    router.push({
      pathname: TICKET_ROUTE,
      params: {
        ticketId: destination.ticketId,
        selectedTab: 'thread',
        channelId: destination.channelId,
        threadId: destination.threadId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        from: 'activity',
        openStartedAtMs: String(openStartedAtMs),
      },
    });
    return true;
  }

  const intent = createChatOpenIntent(
    {
      channelId: input.channelId,
      ...(input.conversationId ? { origin: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.isThreadReply && input.conversationId ? { threadId: input.conversationId } : {}),
      surface: getBookmarkSurface(input.scopeType),
      ...(input.scopeType ? { scopeType: input.scopeType } : {}),
      openStartedAtMs,
    },
    'activity',
  );
  if (!intent) return false;
  return executeChatOpenIntent(router, intent);
};
