import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { isDeskChannelType } from '@xyne/shared';
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
    case 'CHANNEL':
      return `/${workspaceId}/chat/${id}`;
    case 'CONVERSATION': {
      const conv = await repositories.conversations.findById(id).catch((err: unknown) => { logger.error(`[notify-action-url] CONVERSATION lookup failed id=${id}`, err); return null; });
      return conv?.channelId ? `/${workspaceId}/chat/${conv.channelId}#origin=${id}` : undefined;
    }
    case 'MESSAGE': {
      const msg = await db.message
        .findUnique({ where: { messageId: id }, select: { conversationId: true } })
        .catch((err: unknown) => { logger.error(`[notify-action-url] MESSAGE lookup failed id=${id}`, err); return null; });
      if (!msg?.conversationId) return undefined;
      const conv = await repositories.conversations.findById(msg.conversationId).catch((err: unknown) => { logger.error(`[notify-action-url] CONVERSATION lookup failed id=${msg.conversationId}`, err); return null; });
      return conv?.channelId
        ? `/${workspaceId}/chat/${conv.channelId}#origin=${msg.conversationId}&messageId=${id}`
        : undefined;
    }
    case 'EMAIL': {
      const email = await db.email
        .findUnique({ where: { id }, select: { conversationId: true, channelId: true } })
        .catch((err: unknown) => { logger.error(`[notify-action-url] EMAIL lookup failed id=${id}`, err); return null; });
      return email?.channelId && email?.conversationId
        ? `/${workspaceId}/chat/${email.channelId}#origin=${email.conversationId}`
        : undefined;
    }
    default:
      return undefined;
  }
}
