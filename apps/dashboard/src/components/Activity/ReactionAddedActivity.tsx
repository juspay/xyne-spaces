import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { ActivityItemCard } from './ActivityItemCard';
import { htmlToPlainText } from '../../utils/sanitizer';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';
import { renderEmoji } from '../../utils/customEmojiUtils';
import { getReactionMessagePreview } from './reactionMessagePreview';

export const ReactionAddedActivity = ({
  activity,
  isExpanded = true,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const reaction = activity.reaction;
  const message = activity.message;
  const actorUser = useUser(reaction?.userId ?? '');
  const { baseRoute } = useRouteContext();

  if (!reaction || !message || !reaction.userId || !message.conversation) return null;

  const reactionPreview = getReactionMessagePreview(message.content);
  const actionText = activity.actorAction === 'added' ? 'reacted' : 'removed reaction';
  const isThreadReply = message.conversation?.initialMessageId !== message.messageId;
  const targetPath = `${baseRoute}/${message.conversation?.channelId}${isThreadReply ? `/${message.conversation?.conversationId}` : ''}#origin=${message.conversation?.conversationId}${isThreadReply ? `&messageId=${message.messageId}` : ''}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={reaction.userId}
      actorName={getUserDisplayName(actorUser)}
      channelId={message.conversation?.channelId}
      badgeIcon={renderEmoji(reaction.emojiName)}
      badgeColorClass='bg-muted'
      description={
        <>
          <span className='text-muted-foreground text-sm'>{actionText}</span>
          <span className='text-muted-foreground text-sm ml-1'>to your message in</span>
        </>
      }
      targetPath={targetPath}
      focusThread={isThreadReply}
      linkedItemCreatedAt={message.conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        <MessageBubble message={message} showAvatar={false} contentOnly={true} variant='default' />
      ) : (
        <div className='text-foreground text-sm line-clamp-2 whitespace-normal break-words'>
          {getFlowJsonPreviewText(reactionPreview) ?? htmlToPlainText(reactionPreview)}
        </div>
      )}
    </ActivityItemCard>
  );
};
