import { router } from 'expo-router';
import type { DisplaySearchResult } from '@/src/types/search';
import { ChannelService } from '@/src/services/ChannelService';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { resolveSearchResultCreatedAtMs } from '@/src/utils/search';

const channelService = new ChannelService();
const SEARCH_NAV_LOG_PREFIX = '[LOTUS_SEARCH_NAV]';

const logSearchNavigation = (step: string, payload: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.info(`${SEARCH_NAV_LOG_PREFIX} ${step}`, payload);
};

const navigateToChannel = (
  channelId: string,
  params?: { conversationId?: string; createdAt?: string; messageId?: string },
): void => {
  const openStartedAtMs = Date.now();
  const createdAt = toEpochMillisString(params?.createdAt);
  const intent = createChatOpenIntent(
    {
      channelId,
      ...(params?.conversationId ? { origin: params.conversationId } : {}),
      ...(params?.messageId ? { messageId: params.messageId } : {}),
      ...(createdAt ? { createdAt: Number(createdAt) } : {}),
      openStartedAtMs,
    },
    'search',
  );
  logSearchNavigation('route_channel', {
    channelId,
    conversationId: params?.conversationId,
    messageId: params?.messageId,
    createdAt: params?.createdAt,
  });

  if (!intent) return;
  executeChatOpenIntent(router, intent);
};

const navigateToThread = (channelId: string, threadId: string, messageId?: string): void => {
  const openStartedAtMs = Date.now();
  logSearchNavigation('route_thread', { channelId, threadId, messageId });

  const intent = createChatOpenIntent(
    {
      channelId,
      threadId,
      origin: threadId,
      ...(messageId ? { messageId } : {}),
      openStartedAtMs,
    },
    'search',
  );
  if (!intent) return;
  executeChatOpenIntent(router, intent);
};

const toEpochMillisString = (timestamp: string | undefined): string | undefined => {
  if (!timestamp || timestamp === 'N/A') {
    return undefined;
  }

  // Already epoch millis. Callers normalise through
  // resolveSearchResultCreatedAtMs, and Date.parse('1710498600000') is NaN, so
  // without this the cursor is thrown away a second time on the way through.
  if (/^\d+$/.test(timestamp)) {
    return timestamp;
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return String(parsed);
};

const MEDIA_FILE_PATTERN = /\.(avif|bmp|gif|heic|heif|jpeg|jpg|mkv|mov|mp4|png|webm|webp)$/i;

export async function navigateToGlobalSearchResult(result: DisplaySearchResult): Promise<boolean> {
  try {
    const context = result.searchContext;
    logSearchNavigation('result_clicked', {
      resultType: result.type,
      resultId: result.id,
      title: result.title,
      subtitle: result.subtitle,
      relevanceScore: result.relevanceScore,
      metadataTimestamp: result.metadata?.timestamp,
      contextChannelId: context?.channelId,
      contextConversationId: context?.conversationId,
      contextMessageId: context?.messageId,
      contextReplyCount: context?.replyCount,
      contextSubApp: context?.subApp,
      contextTicketId: context?.ticketId,
    });

    switch (result.type) {
      case 'channel': {
        const channelId = context?.channelId || result.id;
        logSearchNavigation('decision_channel_result', { channelId });
        navigateToChannel(channelId);
        return true;
      }

      case 'conversation': {
        const channelId = context?.channelId;
        if (!channelId) {
          logSearchNavigation('decision_conversation_missing_channel', {
            conversationId: context?.conversationId,
            messageId: context?.messageId,
          });
          return false;
        }

        const conversationId = context?.conversationId;
        const messageId = context?.messageId;
        const replyCount = context?.replyCount;
        const isThreadReply = Boolean(replyCount && replyCount > 0 && conversationId);

        logSearchNavigation('decision_conversation_eval', {
          channelId,
          conversationId,
          messageId,
          replyCount,
          isThreadReply,
        });

        if (isThreadReply && conversationId) {
          navigateToThread(channelId, conversationId, messageId);
          return true;
        }

        if (conversationId) {
          const createdAt = resolveSearchResultCreatedAtMs(result);
          logSearchNavigation('decision_conversation_route_channel', {
            channelId,
            conversationId,
            createdAt,
            rawTimestamp: result.metadata?.timestamp,
          });
          navigateToChannel(channelId, {
            conversationId,
            ...(messageId ? { messageId } : {}),
            ...(createdAt ? { createdAt } : {}),
          });
          return true;
        }

        logSearchNavigation('decision_conversation_route_channel_without_conversation_id', {
          channelId,
        });
        navigateToChannel(channelId);
        return true;
      }

      case 'ticket': {
        const ticketId = context?.ticketId || result.id;
        if (!ticketId) {
          logSearchNavigation('decision_ticket_missing_ticket_id', {
            channelId: context?.channelId,
            conversationId: context?.conversationId,
          });
          return false;
        }
        logSearchNavigation('route_ticket', { ticketId });
        router.push({
          pathname: '/(protected)/ticket/[ticketId]',
          params: { ticketId },
        });
        return true;
      }

      case 'attachment': {
        const channelId = context?.channelId;
        const conversationId = context?.conversationId;
        const subApp = context?.subApp?.toUpperCase();
        logSearchNavigation('decision_attachment_eval', {
          channelId,
          conversationId,
          messageId: context?.messageId,
          subApp,
          ticketId: context?.ticketId,
          attachmentId: context?.attachmentId,
          fileName: context?.fileName,
        });

        if (channelId && subApp === 'CANVAS') {
          logSearchNavigation('route_attachment_canvas', { channelId });
          router.push({
            pathname: '/(protected)/chat/[channelId]/canvas',
            params: { channelId },
          });
          return true;
        }

        // Match dashboard behavior: chat/ticket attachments should land in thread context.
        if (subApp === 'CHAT_ATTACHMENT' && channelId && conversationId) {
          navigateToThread(channelId, conversationId, context?.messageId);
          return true;
        }

        if (subApp === 'TICKET_ATTACHMENT' && channelId && conversationId) {
          navigateToThread(channelId, conversationId, context?.messageId);
          return true;
        }

        if (subApp === 'TRANSCRIPT' && channelId && conversationId) {
          navigateToThread(channelId, conversationId, context?.messageId);
          return true;
        }

        const ticketId = context?.ticketId;
        if (channelId && conversationId && ticketId) {
          navigateToThread(channelId, conversationId, context?.messageId);
          return true;
        }

        if (channelId && conversationId) {
          navigateToThread(channelId, conversationId, context?.messageId);
          return true;
        }

        if (channelId && context?.attachmentId && MEDIA_FILE_PATTERN.test(context.fileName ?? '')) {
          router.push({
            pathname: '/(protected)/chat/[channelId]/files',
            params: { channelId },
          });
          return true;
        }

        if (channelId) {
          navigateToChannel(channelId);
          return true;
        }

        return false;
      }

      case 'user': {
        if (context?.channelId) {
          logSearchNavigation('decision_user_open_existing_channel', {
            channelId: context.channelId,
            userId: result.id,
          });
          navigateToChannel(context.channelId);
          return true;
        }

        const response = await channelService.createDm({ participantIds: [result.id] });
        logSearchNavigation('decision_user_create_dm', {
          userId: result.id,
          createdDmId: response.id,
        });
        navigateToChannel(response.id);
        return true;
      }

      default:
        logSearchNavigation('decision_unknown_result_type', {
          resultType: result.type,
          resultId: result.id,
        });
        return false;
    }
  } catch (error) {
    logSearchNavigation('navigation_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
