import { ChannelType, isDeskChannelType, parseTicketMd } from '@xyne/shared';

import type { ActivityWithRelated } from '@/src/types/activity';

export type DeskActivityNavigation = {
  kind: 'desk';
  channelId: string;
  xyneId?: string;
  ticketId?: string;
  conversationId?: string;
  messageId?: string;
  tab?: 'email' | 'messages' | 'details';
};

export function isDeskActivityChannel(type: string | null | undefined): boolean {
  return isDeskChannelType(type) || type === ChannelType.SUPPORT;
}

/** A desk-channel activity opens the Xyne desk. Thread messages open the Messages tab. */
export function deskActivityNavigation(
  activity: ActivityWithRelated,
  channel: { id?: string; type?: string | null } | null | undefined,
): DeskActivityNavigation | null {
  if (!isDeskActivityChannel(channel?.type)) return null;

  const channelId =
    channel?.id ??
    activity.message?.conversation?.channelId ??
    activity.ticket?.channelId ??
    activity.channelId;
  if (!channelId) return null;

  const conversation = activity.message?.conversation;
  const fromMd = parseTicketMd(conversation?.ticket_md ?? null);
  const xyneId = activity.ticket?.xyneId?.trim() || fromMd?.xyneId?.trim() || undefined;
  // actionSourceId is the message id on mentions and replies. It is a ticket id only when there is no message.
  const ticketId =
    activity.ticket?.id ??
    activity.ticketId ??
    conversation?.ticketId ??
    fromMd?.id ??
    (!activity.message ? activity.actionSourceId?.trim() || undefined : undefined);
  const conversationId = conversation?.conversationId ?? activity.conversationId ?? undefined;
  const messageId = activity.message?.messageId;

  return {
    kind: 'desk',
    channelId,
    ...(xyneId ? { xyneId } : {}),
    ...(ticketId ? { ticketId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId, tab: 'messages' as const } : {}),
  };
}
