import type { MessageRowModel } from '../model/chatRow.types';

export type ChannelThreadOpen =
  | {
      pathname: '/ticket/[ticketId]';
      params: {
        ticketId: string;
        selectedTab: 'overview' | 'thread';
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
 * Row press open target. Parent preview jumps into that thread (+ messageId).
 * Tickets: overview when there are no replies, thread tab when there are.
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
    const replyCount = model.replyPreview?.count ?? 0;
    return {
      pathname: '/ticket/[ticketId]',
      params: {
        ticketId,
        selectedTab: replyCount > 0 ? 'thread' : 'overview',
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
