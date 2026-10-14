import type { MessageRowModel } from '../model/chatRow.types';

export type CallThreadView = 'summary' | 'transcript';

export type CallThreadOpen = {
  pathname: '/chat/[channelId]/[threadId]';
  params: {
    channelId: string;
    threadId: string;
    isTranscript: 'true' | 'false';
  };
};

/** Builds the complete href used by both call-card actions. */
export const callThreadOpen = (model: MessageRowModel, view: CallThreadView): CallThreadOpen => ({
  pathname: '/chat/[channelId]/[threadId]',
  params: {
    channelId: model.channelId,
    threadId: model.conversationId,
    isTranscript: view === 'transcript' ? 'true' : 'false',
  },
});
