import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import type { ForwardedMessageData } from '@xyne/shared';

import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

export const useForwardedMessageNavigation = (): ((
  forwarded: ForwardedMessageData,
) => Promise<void>) => {
  const router = useRouter();

  return useCallback(
    async (forwarded: ForwardedMessageData): Promise<void> => {
      if (!forwarded.originalChannelId) return;
      const intent = createChatOpenIntent(
        {
          channelId: forwarded.originalChannelId,
          ...(forwarded.originalConversationId ? { origin: forwarded.originalConversationId } : {}),
          ...(forwarded.originalMessageId ? { messageId: forwarded.originalMessageId } : {}),
          openStartedAtMs: Date.now(),
        },
        'forward',
      );

      if (intent) {
        executeChatOpenIntent(router, intent);
      }
    },
    [router],
  );
};
