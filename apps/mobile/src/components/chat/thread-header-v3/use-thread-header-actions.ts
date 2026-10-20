import { useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChannelScopeType } from '@xyne/shared';

import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import type { BaseConversationSurface } from '@/src/features/chat/baseConversationSurface';
import { channelScopeParams, messageScopeParams } from '@/src/features/xyne-ai/model/askAIParams';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

/**
 * The thread header's parent-conversation link and thread-scoped Ask AI, with the
 * thread's reply count and replies, read from the same root conversation.
 */
export const useThreadHeaderActions = ({
  channelId,
  threadId,
  channel,
  isDM,
}: {
  channelId: string;
  threadId: string;
  channel: Parameters<typeof channelScopeParams>[0];
  isDM: boolean;
}): {
  replyCount: number;
  repliesMd: string | null | undefined;
  handleOpenParentConversation: () => void;
  handleAskAI: () => void;
} => {
  const router = useRouter();
  const { surface: surfaceParam } = useLocalSearchParams<{ surface?: string }>();

  const baseConversationSurface: BaseConversationSurface =
    surfaceParam === 'dms' || isDM || channel?.scopeType === ChannelScopeType.GROUP_DM
      ? 'dms'
      : 'channels';

  /**
   * Slack's treatment: the pill names the parent conversation, so tapping it
   * goes there. dismissTo pops to the chat screen when it already sits below
   * this thread and replaces the thread with it when it does not (deeplink,
   * notification), so no entry point can strand a thread underneath.
   *
   * Deliberately not `onBack` — that is canGoBack() ? back() : replace(), which
   * from an Activity entry lands on Activity while the pill names the channel.
   */
  const handleOpenParentConversation = useCallback(() => {
    router.dismissTo({
      pathname: '/chat/[channelId]',
      params: { channelId, surface: baseConversationSurface },
    });
  }, [baseConversationSurface, channelId, router]);

  const [conversation] = useQuery(queries.getConversationById({ conversationId: threadId }), {
    enabled: Boolean(threadId),
  });
  const rootMessage = conversation?.initialMessage;

  const handleAskAI = useCallback(() => {
    router.push({
      pathname: '/xyne-ai',
      params: {
        ...channelScopeParams(channel),
        conversationId: threadId,
        ...(rootMessage
          ? messageScopeParams(rootMessage, composerHtmlToPlainText)
          : { previewText: 'Thread' }),
      },
    });
  }, [channel, rootMessage, router, threadId]);

  return {
    replyCount: conversation?.replyCount ?? 0,
    repliesMd: conversation?.replies_md,
    handleOpenParentConversation,
    handleAskAI,
  };
};
