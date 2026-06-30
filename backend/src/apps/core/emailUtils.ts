import { EmailType, UserType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { decodeCursor, paginateResults } from './paginationUtils';
import { EmailRepliesCursor, EmailRepliesItem, EmailRepliesResponse, AppEventType, BaseAppEvent, EmailEventPayload } from '../types';
import { handleEventSubscriptionsForUsers } from './eventSubscriptionUtils';
import { emitEmailReceived } from '@/automations/triggers/email-received.trigger';

// A thread root is the first message of a thread: an inbound email (DEFAULT)
// or a brand-new outbound email we composed (COMPOSE). REPLY / REPLY_ALL hang
// off a root.
const isRootEmailType = (type: EmailType): boolean =>
  type === EmailType.DEFAULT || type === EmailType.COMPOSE;

/**
 * Get all emails in a conversation thread with cursor-based pagination
 *
 * @param channelId - Channel ID (required for validation)
 * @param conversationId - Conversation ID to fetch emails for (required)
 * @param limit - Maximum number of items to return (optional, default: 1000, max: 1000)
 * @param cursor - Base64 encoded cursor for pagination (optional)
 * @returns Email replies response with items, next cursor, and hasMore flag
 */
export async function getEmailReplies(
  channelId: string,
  conversationId: string,
  limit?: number,
  cursor?: string
): Promise<EmailRepliesResponse> {
  try {
    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.channelId !== channelId) {
      throw new Error('Conversation does not belong to the specified channel');
    }

    const actualLimit = Math.min(limit || 1000, 1000);
    const decodedCursor = decodeCursor<EmailRepliesCursor>(cursor);

    const emails = await repositories.emails.findManyWithCursor(
      conversationId,
      actualLimit + 1,
      decodedCursor
    );

    // Resolve parent (root email) per externalThreadId in one query
    const rootByThread = new Map<string, string>();
    const replyThreadIds = Array.from(
      new Set(emails.filter(e => !isRootEmailType(e.type)).map(e => e.externalThreadId))
    );
    const roots = await repositories.emails.findRootsByExternalThreadIds(replyThreadIds);
    for (const r of roots) {
      if (!rootByThread.has(r.externalThreadId)) {
        rootByThread.set(r.externalThreadId, r.id);
      }
    }

    const itemsResults: EmailRepliesItem[] = emails.map((email) => ({
      id: email.id,
      parentId:
        isRootEmailType(email.type)
          ? email.id
          : (rootByThread.get(email.externalThreadId) ?? email.id),
      type: email.type,
      subject: email.subject,
      content: email.body,
      to: email.to,
      from: email.from,
      cc: email.cc,
      bcc: email.bcc,
      createdAt: email.createdAt,
    }));

    const paginationResult = paginateResults(
      itemsResults,
      actualLimit,
      (item): EmailRepliesCursor => ({
        id: item.id,
        createdAt: item.createdAt.getTime(),
      })
    );

    return {
      items: paginationResult.items,
      nextCursor: paginationResult.nextCursor,
      hasMore: paginationResult.hasMore,
    };
  } catch (error) {
    logger.error('[EMAIL-REPLIES] Error fetching email replies:', error);
    throw error;
  }
}

export async function dispatchEmailEventForEmailId(emailId: string): Promise<void> {
  try {
    const email = await repositories.emails.findById(emailId);
    if (!email) return;
    // Only fire for incoming mail. Outgoing REPLY / REPLY_ALL rows are mail
    // we sent ourselves and must not be re-broadcast to subscribed apps.
    if (email.type !== EmailType.DEFAULT) return;

    // Fan out to the automation EMAIL_RECEIVED trigger as well as the legacy
    // app-subscriber dispatch below. Fire-and-forget — automation hiccups
    // must not break email persistence.
    void emitEmailReceived(emailId);

    const channelParticipants = await repositories.channelParticipants.getChannelParticipants(
      email.channelId,
    );
    const participantUserIds = channelParticipants.map(p => p.userId);
    if (participantUserIds.length === 0) return;

    const appUsers = await repositories.users.findMany({
      where: { id: { in: participantUserIds }, userType: UserType.APP },
    });
    const appUserIds = appUsers.map(u => u.id);
    if (appUserIds.length === 0) return;

    const [ticket, channel] = await Promise.all([
      repositories.tickets.findFirstByConversationId(email.conversationId),
      repositories.channels.findById(email.channelId),
    ]);

    const payload: EmailEventPayload = {
      conversationId: email.conversationId,
      subject: email.subject,
      content: email.body,
      to: email.to,
      from: email.from,
      recipients: [...email.cc, ...email.bcc],
      parentId: email.id,
      id: email.id,
      ticketId: ticket?.id ?? '',
      channelName: channel?.name ?? '',
    };

    const event: BaseAppEvent = {
      eventType: AppEventType.EMAIL,
      payload,
      timestamp: new Date().toISOString(),
    };

    await handleEventSubscriptionsForUsers(event, appUserIds);
  } catch (error) {
    logger.error('[dispatchEmailEventForEmailId] Failed to dispatch EMAIL event', {
      emailId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Outbound acknowledgment for API-created email tickets (createEmailTicket). */
export function buildEmailTicketAcknowledgmentBody(_subject: string, body: string): string {
  const safeBody = body.trim();
  return [
    '<p>We have received your request and created a support ticket.</p>',
    `<p>${escapeHtmlForEmail(safeBody).replace(/\n/g, '<br>')}</p>`,
    '<p>Our team will follow up on this thread.</p>',
  ].join('\n');
}

function escapeHtmlForEmail(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
