import { router } from 'expo-router';

import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { beginActivityOpen } from '@/src/observability/logging/activity/activityOpen';

type Args = {
  channelId: string;
  conversationId?: string;
  messageId?: string;
  isThreadReply?: boolean;
  conversationCreatedAt?: number;
};

export function navigateToMessage({
  channelId,
  conversationId,
  messageId,
  isThreadReply = false,
  conversationCreatedAt,
}: Args): void {
  const openStartedAtMs = Date.now();
  const intent = createChatOpenIntent(
    {
      channelId,
      ...(conversationId ? { origin: conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(isThreadReply && conversationId ? { threadId: conversationId } : {}),
      ...(conversationCreatedAt !== undefined ? { createdAt: conversationCreatedAt } : {}),
      openStartedAtMs,
    },
    'activity',
  );
  if (!intent) return;

  // Completion (including superseded journeys) is emitted via useTrackActivityOpen.
  beginActivityOpen({
    target: {
      channelId,
      ...(messageId ? { messageId } : {}),
      ...(isThreadReply && conversationId ? { threadId: conversationId } : {}),
    },
  });

  executeChatOpenIntent(router, intent);
}
