import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { ActivityItemCard } from './ActivityItemCard';
import { htmlToPlainText } from '../../utils/sanitizer';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ChatTyping } from '@xyne/icons';

export const MessageRepliedActivity = ({
  activity,
  isExpanded = true,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const sender = useUser(message?.senderId ?? '');
  const { baseRoute } = useRouteContext();

  if (!message || !sender || !message.conversation) return null;
  const targetPath = `${baseRoute}/${message.conversation?.channelId}/${message.conversation?.conversationId}#origin=${message.conversation?.conversationId}&messageId=${message.messageId}`;
  const supportTargetPath =
    message.conversation?.channelId && message.conversation?.conversationId
      ? `/support/${message.conversation.channelId}?conversationId=${message.conversation.conversationId}&messageId=${message.messageId}`
      : undefined;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={getUserDisplayName(sender)}
      channelId={message.conversation?.channelId}
      badgeIcon={<ChatTyping className='size-3 text-yellow-600' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>replied in</span>}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      linkedItemCreatedAt={message.conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        <MessageBubble message={message} showAvatar={false} variant='default' contentOnly={true} />
      ) : (
        <div className='text-foreground text-sm line-clamp-2 whitespace-normal break-words'>
          {getFlowJsonPreviewText(message.content) ?? htmlToPlainText(message.content)}
        </div>
      )}
    </ActivityItemCard>
  );
};
