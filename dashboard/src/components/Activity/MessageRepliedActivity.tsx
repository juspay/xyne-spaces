import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { MessageCircleMore } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';

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

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={sender.name}
      channelId={message.conversation?.channelId}
      badgeIcon={<MessageCircleMore className='text-yellow-600' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>replied in</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        <MessageBubble message={message} showAvatar={false} variant='default' contentOnly={true} />
      ) : (
        <div className='text-foreground text-sm line-clamp-1 truncate whitespace-normal break-all'>
          <RenderMessageWithHTML message={message.content} showEdited={message.edited} />
        </div>
      )}
    </ActivityItemCard>
  );
};
