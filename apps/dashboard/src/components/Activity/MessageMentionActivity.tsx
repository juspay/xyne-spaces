import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { AtMark } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { htmlToPlainText } from '../../utils/sanitizer';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';

export const MessageMentionActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const sender = useUser(message?.senderId ?? '');

  const { baseRoute } = useRouteContext();

  if (!message || !sender || !message.conversation) return null;

  const isThreadReply = message.conversation?.initialMessageId !== message.messageId;

  const targetPath = `${baseRoute}/${message.conversation?.channelId}${isThreadReply ? `/${message.conversation?.conversationId}` : ''}#origin=${message.conversation?.conversationId}${isThreadReply ? `&messageId=${message.messageId}` : ''}`;
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
      badgeIcon={<AtMark className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>mentioned you in</span>}
      targetPath={targetPath}
      focusThread={isThreadReply}
      supportTargetPath={supportTargetPath}
      linkedItemCreatedAt={message.conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
      showUnreadDot
      className='flex items-start'
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
