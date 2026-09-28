import { db } from '@/database/client';
import { ChannelScopeType, isDeskChannelType } from '@xyne/shared';
import { logger } from '@/utils/logger';

/** What a notification can deep-link to. The user picks the kind; we build the URL. */
export const NOTIFY_LINK_TYPES = [
  'NONE',
  'TICKET',
  'CONVERSATION',
  'MESSAGE',
  'CHANNEL',
  'EMAIL',
] as const;
export type NotifyLinkType = (typeof NOTIFY_LINK_TYPES)[number];

function chatRouteBase(workspaceId: string, channelId: string, scopeType: string | undefined): string {
  const isDM = scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
  return `/${workspaceId}/chat/${isDM ? 'dm' : 'dir'}/${channelId}`;
}

/**
 * Builds the notification deep-link from the kind the user selected + the single
 * id they supplied for that kind. We resolve any supporting ids (a message's
 * conversation/channel) server-side. Returns undefined when there's nothing to
 * link to.
 */
export async function buildNotifyActionUrl(
  workspaceId: string,
  linkType: NotifyLinkType | undefined,
  linkId: string | undefined | null,
): Promise<string | undefined> {
  const id = linkId?.trim();
  if (!id || !linkType || linkType === 'NONE') return undefined;

  switch (linkType) {
    case 'TICKET': {
      const ticket = await db.ticket
        .findUnique({
          where: { id },
          select: {
            xyneId: true,
            channelId: true,
            conversationId: true,
            channel: { select: { type: true } },
          },
        })
        .catch((err: unknown) => { logger.error(`[notify-action-url] TICKET lookup failed id=${id}`, err); return null; });
      // Desk channels (email/slack/app) live in the support screen, which
      // deeplinks by xyneId not the internal id.
      if (ticket?.channelId && isDeskChannelType(ticket.channel?.type)) {
        return ticket.xyneId
          ? `/${workspaceId}/support/${ticket.channelId}/${ticket.xyneId}`
          : `/${workspaceId}/support/${ticket.channelId}`;
      }
      return ticket?.channelId && ticket?.conversationId
        ? `/${workspaceId}/chat/dir/${ticket.channelId}?tab=tickets&ticketId=${id}&conversationId=${ticket.conversationId}`
        : `/${workspaceId}/tickets?tickets=${id}`;
    }
    case 'CHANNEL': {
      const channel = await db.channel
        .findUnique({ where: { id }, select: { scopeType: true } })
        .catch((err: unknown) => { logger.error(`[notify-action-url] CHANNEL lookup failed id=${id}`, err); return null; });
      return chatRouteBase(workspaceId, id, channel?.scopeType);
    }
    case 'CONVERSATION': {
      const conv = await db.conversation
        .findUnique({ where: { conversationId: id }, select: { channelId: true, channel: { select: { scopeType: true } } } })
        .catch((err: unknown) => { logger.error(`[notify-action-url] CONVERSATION lookup failed id=${id}`, err); return null; });
      return conv?.channelId
        ? `${chatRouteBase(workspaceId, conv.channelId, conv.channel.scopeType)}#origin=${id}`
        : undefined;
    }
    case 'MESSAGE': {
      const msg = await db.message
        .findUnique({
          where: { messageId: id },
          select: {
            conversationId: true,
            conversation: { select: { channelId: true, channel: { select: { scopeType: true } } } },
          },
        })
        .catch((err: unknown) => { logger.error(`[notify-action-url] MESSAGE lookup failed id=${id}`, err); return null; });
      const conv = msg?.conversation;
      return msg && conv?.channelId
        ? `${chatRouteBase(workspaceId, conv.channelId, conv.channel.scopeType)}#origin=${msg.conversationId}&messageId=${id}`
        : undefined;
    }
    case 'EMAIL': {
      const email = await db.email
        .findUnique({ where: { id }, select: { conversationId: true, channelId: true } })
        .catch((err: unknown) => { logger.error(`[notify-action-url] EMAIL lookup failed id=${id}`, err); return null; });
      return email?.channelId && email?.conversationId
        ? `/${workspaceId}/chat/dir/${email.channelId}#origin=${email.conversationId}`
        : undefined;
    }
    default:
      return undefined;
  }
}
