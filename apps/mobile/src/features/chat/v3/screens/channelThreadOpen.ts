import type { MessageRowModel } from '../model/chatRow.types';

export type ChannelThreadOpen =
  | {
      pathname: '/ticket/[ticketId]';
      params: {
        ticketId: string;
        selectedTab: 'thread';
        channelId: string;
        threadId: string;
        from: 'channel_thread';
        openStartedAtMs: string;
      };
    }
  | {
      pathname: '/chat/[channelId]/[threadId]';
      params: {
        channelId: string;
        threadId: string;
        from: 'channel_thread';
        openStartedAtMs: string;
        messageId?: string;
      };
    };

/**
 * v2 `handleMessagePress`: a replies tap opens the thread, it does not jump
 * to the parent `messageId`. Only a show-in-channel parent preview passes a
 * message id. Tickets go straight to Ticket Details so the first tap is not
 * a thread hunt that fails, then a redirect.
 */
export const channelThreadOpen = (
  model: MessageRowModel,
  channelId: string,
  now: number,
): ChannelThreadOpen => {
  const parentThreadId = model.parentPreview?.conversationId;
  const threadId = parentThreadId ?? model.conversationId;
  const ticketId = parentThreadId ? undefined : model.ticketPreview?.ticketId;
  const openStartedAtMs = String(now);
  if (ticketId) {
    return {
      pathname: '/ticket/[ticketId]',
      params: {
        ticketId,
        selectedTab: 'thread',
        channelId,
        threadId,
        from: 'channel_thread',
        openStartedAtMs,
      },
    };
  }
  return {
    pathname: '/chat/[channelId]/[threadId]',
    params: {
      channelId,
      threadId,
      from: 'channel_thread',
      openStartedAtMs,
      ...(parentThreadId && model.parentPreview?.messageId
        ? { messageId: model.parentPreview.messageId }
        : {}),
    },
  };
};
