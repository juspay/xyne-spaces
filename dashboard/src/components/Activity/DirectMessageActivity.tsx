import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { MessageCircle } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';

export const DirectMessageActivity = ({
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
  const targetPath = `${baseRoute}/${message.conversation?.channelId}${
    isThreadReply ? `/${message.conversation?.conversationId}` : ''
  }#origin=${message.conversation?.conversationId}${
    isThreadReply ? `&messageId=${message.messageId}` : ''
  }`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={sender.name}
      channelId={message.conversation?.channelId}
      badgeIcon={<MessageCircle className='w-4 h-4 text-emerald-500' />}
      badgeColorClass='bg-[#FAFAFA]'
      description={<span className='text-gray-500 text-sm'>sent you a DM in</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      {isExpanded ? (
        <MessageBubble message={message} showAvatar={false} variant='default' contentOnly={true} />
      ) : (
        <div className='text-[#181B1D] text-sm line-clamp-1 truncate'>
          <RenderMessageWithHTML message={message.content} showEdited={message.edited} />
        </div>
      )}
    </ActivityItemCard>
  );
};
