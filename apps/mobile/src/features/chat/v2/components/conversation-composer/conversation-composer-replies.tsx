import { memo, type ReactElement } from 'react';
import { parseRepliesMd } from '@xyne/shared';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import { ChatReplyTray } from './chat-reply-tray';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';

type RepliesProps = {
  className?: string;
};

const Replies = memo(({ className }: RepliesProps): ReactElement | null => {
  const { item, kind, paintRow, parentMessage } = useConversationComposer();
  const { actionPrimaryColor, rootAccentUser } = useChatRenderTokens();

  const replyCount = parentMessage ? 0 : (paintRow?.replyCount ?? item.replyCount ?? 0);
  if (replyCount <= 0) return null;
  const isCurrentUser =
    kind === 'CURRENT_USER' || paintRow?.senderPaintModel.isCurrentUser === true;

  const latestReplierIds = paintRow?.replyPreviewUserIds?.length
    ? paintRow.replyPreviewUserIds.slice(-3)
    : parseRepliesMd(item.replies_md ?? null).repliers.slice(-3);

  return (
    <DebugBoundary>
      <ChatReplyTray
        replyCount={replyCount}
        replierUserIds={latestReplierIds}
        accentColor={isCurrentUser ? rootAccentUser : actionPrimaryColor}
        {...(className ? { className } : {})}
      />
    </DebugBoundary>
  );
});
Replies.displayName = 'ConversationComposer.Replies';

export { Replies };
