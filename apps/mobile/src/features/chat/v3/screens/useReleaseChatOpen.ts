import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { releaseChatOpenForChannel } from '@/src/utils/openChatRoute';

import { firstParam } from '../intent/openIntentSchema';

/** Release the tap guard as soon as this screen is up — not after paint. */
export const useReleaseChatOpen = (channelId: string): void => {
  const params = useLocalSearchParams();
  const attemptId = firstParam(params['chatOpenAttemptId']);
  useEffect(() => {
    releaseChatOpenForChannel(attemptId, channelId);
  }, [attemptId, channelId]);
};
