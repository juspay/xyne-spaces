import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { channelScopeParams } from '@/src/features/xyne-ai/model/askAIParams';

/** Where the conversation header's info and Ask AI controls navigate. */
export const useConversationHeaderRoutes = (
  channelId: string,
  channel: Parameters<typeof channelScopeParams>[0],
): { handleOpenInfo: () => void; handleAskAI: () => void } => {
  const router = useRouter();

  const handleOpenInfo = useCallback(() => {
    // Haptic fires on press-in (handlePillPressIn), matching HeaderIconButton.
    router.push({ pathname: '/(protected)/chat/[channelId]/info', params: { channelId } });
  }, [router, channelId]);

  const handleAskAI = useCallback(() => {
    router.push({ pathname: '/xyne-ai', params: channelScopeParams(channel) });
  }, [channel, router]);

  return { handleOpenInfo, handleAskAI };
};
