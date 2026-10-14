import { buildWebMessageLink } from '@/src/utils/messageDeepLink';

export const messageActionLink = ({
  channelId,
  conversationId,
  messageId,
  threadId,
  workspaceId,
  isThread,
}: {
  channelId: string;
  conversationId: string;
  messageId: string;
  threadId?: string;
  workspaceId?: string;
  isThread: boolean;
}): string => {
  const workspaceScope = workspaceId ? { workspaceId } : {};
  if (isThread) {
    const thread = threadId ?? conversationId;
    return buildWebMessageLink({
      channelId,
      ...workspaceScope,
      threadId: thread,
      origin: thread,
      messageId,
    });
  }
  return buildWebMessageLink({
    channelId,
    ...workspaceScope,
    origin: conversationId,
  });
};
