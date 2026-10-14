import { useEffect } from 'react';

import { rememberLastOpenChannel } from '@/src/features/chat/lastOpenChannel';

import { runAfterFirstPaint } from '../scheduling/afterFirstPaint';

export const useRememberLastOpenChannel = (channelId: string): void => {
  useEffect(() => {
    if (!channelId) {
      return;
    }
    const task = runAfterFirstPaint((): void => {
      rememberLastOpenChannel(channelId);
    });
    return (): void => task.cancel();
  }, [channelId]);
};
