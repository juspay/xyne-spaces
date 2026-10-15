import type { ChannelRef, ConversationRef, ThreadRef } from '@xyne/shared/messages';

import type { OpenIntent } from '../intent/openIntent.types';

export const surfaceRemountKey = (intent: OpenIntent): string => intent.intentKey;

export const conversationRefFor = (intent: OpenIntent): ConversationRef => {
  if (intent.surface.kind === 'channel') {
    const ref: ChannelRef = {
      kind: 'channel',
      channelId: intent.surface.channelId,
      isMember: true,
    };
    return ref;
  }
  const ref: ThreadRef = {
    kind: 'thread',
    channelId: intent.surface.channelId,
    conversationId: intent.surface.threadId,
    isMember: true,
  };
  return ref;
};
