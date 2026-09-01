import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { ActivityItemCard } from './ActivityItemCard';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';
import { parseReactionsMd, ReactionsData, getMostRecentEmoji } from '@xyne/shared';
import { ResolvedEmoji } from './ResolvedEmoji';
import { getReactionMessagePreview } from './reactionMessagePreview';

export const ReactionAddedActivityV2 = ({
  activity,
  isExpanded = true,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const actorUser = useUser(activity.actorId); // Most recent reactor
  const { baseRoute } = useRouteContext();

  if (!message || !message.conversation) return null;

  const isV2 = activity.actorAction === 'added_v2';

  let latestEmoji: string | null = null;
  let uniqueReactorCount = 0;

  if (isV2) {
    const reactionsData: ReactionsData = parseReactionsMd(message.reactions_md);
    latestEmoji = getMostRecentEmoji(reactionsData);

    if (latestEmoji) {
      const emojiNames = Object.keys(reactionsData);
      const uniqueReactors = new Set(emojiNames.flatMap(emoji => reactionsData[emoji]));
      if (activity.userId) {
        uniqueReactors.delete(activity.userId);
      }
      uniqueReactorCount = uniqueReactors.size;
    }
  } else {
    // added to maintain backward compat for now, to be deprecated
    latestEmoji = activity.reaction?.emojiName ?? null;
    uniqueReactorCount = 1;
  }

  if (!latestEmoji) {
    return null;
  }

  const reactionPreview = getReactionMessagePreview(message.content);

  // Format description text
  let descriptionText: string;
  if (uniqueReactorCount <= 1) {
    descriptionText = `reacted to your message in`;
  } else if (uniqueReactorCount === 2) {
    descriptionText = `and 1 other reacted to your message in`;
  } else {
    descriptionText = `and ${uniqueReactorCount - 1} others reacted to your message in`;
  }

  const isThreadReply = message.conversation?.initialMessageId !== message.messageId;
  const targetPath = `${baseRoute}/${message.conversation?.channelId}${isThreadReply ? `/${message.conversation?.conversationId}` : ''}#origin=${message.conversation?.conversationId}${isThreadReply ? `&messageId=${message.messageId}` : ''}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId} // Most recent reactor
      actorName={getUserDisplayName(actorUser)}
      channelId={message.conversation?.channelId}
      badgeIcon={<ResolvedEmoji emojiName={latestEmoji} />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>{descriptionText}</span>}
      targetPath={targetPath}
      focusThread={isThreadReply}
      linkedItemCreatedAt={message.conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        <MessageBubble message={message} showAvatar={false} contentOnly={true} variant='default' />
      ) : (
        (getFlowJsonPreviewText(reactionPreview) ?? (
          <RenderMessageWithHTML message={reactionPreview} showEdited={message.edited} />
        ))
      )}
    </ActivityItemCard>
  );
};
