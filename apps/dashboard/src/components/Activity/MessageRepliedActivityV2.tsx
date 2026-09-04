import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { ActivityItemCard } from './ActivityItemCard';
import { htmlToPlainText } from '../../utils/sanitizer';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';
import { parseRepliesMd, RepliesData } from '@xyne/shared';
import { ChatTyping } from '@xyne/icons';

export const MessageRepliedActivityV2 = ({
  activity,
  isExpanded = true,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const actorUser = useUser(activity.actorId); // Most recent replier
  const { baseRoute } = useRouteContext();

  if (!message || !message.conversation) return null;
  const conversation = message.conversation;
  const latestReplyMessage = message;

  const isV2 = activity.actorAction === 'replied_v2';

  let uniqueReplierCount = 0;
  let isRecipientOwner = false;

  if (isV2) {
    const repliesData: RepliesData = parseRepliesMd(conversation.replies_md);

    if (repliesData.repliers.length === 0) {
      return null;
    }

    const recipientId = activity.userId;
    const isThreadStarter = conversation.createdBy === recipientId;
    const repliers = repliesData.repliers;
    const recipientIndex = recipientId ? repliers.indexOf(recipientId) : -1;
    const hasReplied = recipientIndex >= 0;
    isRecipientOwner = isThreadStarter || hasReplied;
    const afterRepliers = isThreadStarter
      ? repliers
      : repliers.slice(recipientIndex >= 0 ? recipientIndex + 1 : 0);
    const uniqueAfterRepliers = new Set(afterRepliers);
    if (recipientId) {
      uniqueAfterRepliers.delete(recipientId);
    }
    uniqueReplierCount = uniqueAfterRepliers.size;
  } else {
    // added to maintain backward compat for now, to be deprecated
    uniqueReplierCount = 1;
    isRecipientOwner = true;
  }

  // Format description text
  let descriptionText: string;
  if (uniqueReplierCount <= 1) {
    descriptionText = isRecipientOwner
      ? `replied on your message in`
      : `replied in a thread you're following`;
  } else if (uniqueReplierCount === 2) {
    descriptionText = isRecipientOwner
      ? `and 1 other replied on your message in`
      : `and 1 other replied in a thread you're following`;
  } else {
    descriptionText = isRecipientOwner
      ? `and ${uniqueReplierCount - 1} others replied on your message in`
      : `and ${uniqueReplierCount - 1} others replied in a thread you're following`;
  }

  const targetPath = `${baseRoute}/${conversation.channelId}/${conversation.conversationId}#origin=${conversation.conversationId}&messageId=${message.messageId}`;
  const supportTargetPath =
    conversation.channelId && conversation.conversationId
      ? `/support/${conversation.channelId}?conversationId=${conversation.conversationId}&messageId=${message.messageId}`
      : undefined;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId} // Most recent replier
      actorName={getUserDisplayName(actorUser)}
      channelId={conversation.channelId}
      badgeIcon={<ChatTyping className='size-3 text-yellow-600' />}
      badgeColorClass='bg-accent'
      description={<span className='text-muted-foreground text-sm'>{descriptionText}</span>}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      linkedItemCreatedAt={conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        <MessageBubble
          message={latestReplyMessage}
          showAvatar={false}
          variant='default'
          contentOnly={true}
        />
      ) : (
        <div className='text-foreground text-sm line-clamp-2 whitespace-normal break-words'>
          {getFlowJsonPreviewText(latestReplyMessage.content) ??
            htmlToPlainText(latestReplyMessage.content)}
        </div>
      )}
    </ActivityItemCard>
  );
};
