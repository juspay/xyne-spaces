import { ReactElement } from 'react';
import { parseSlashCommandArtifactMessage, type FlowComponent } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ActivityItemCard } from './ActivityItemCard';
import { buildSlashCommandArtifactRoute } from '../Chat/SlashCommandArtifacts';
import { TextNode } from '../flowUI/nodes/TextNode';

export const SlashCommandArtifactActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const sender = useUser(message?.senderId ?? '');
  const { baseRoute } = useRouteContext();
  const artifact = parseSlashCommandArtifactMessage(message?.content);

  if (!message || !sender || !message.conversation || !artifact) return null;

  const conversation = message.conversation;
  const isInitialMessage = conversation.initialMessageId === message.messageId;
  const targetPath = buildSlashCommandArtifactRoute({
    baseRoute,
    channelId: conversation.channelId,
    conversationId: conversation.conversationId,
    messageId: message.messageId,
    isInitialMessage,
  });
  const bodyNode: FlowComponent = {
    id: `${message.messageId}:activity-body`,
    type: 'text',
    props: { content: artifact.body },
  };

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={getUserDisplayName(sender)}
      channelId={conversation.channelId}
      badgeIcon={<span className='text-[10px] font-bold text-white'>!</span>}
      badgeColorClass='border-background bg-orange-500'
      titlePrefix={
        <span className='rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white'>
          {artifact.definition.badge}
        </span>
      }
      description={
        <span className='text-sm text-muted-foreground'>
          {artifact.definition.activityActionLabel}
        </span>
      }
      targetPath={targetPath}
      focusThread={!isInitialMessage}
      linkedItemCreatedAt={conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
      showUnreadDot
      className='flex items-start'
      actorAction={activity.actorAction}
    >
      <div className={isExpanded ? 'text-sm text-foreground' : 'truncate text-sm text-foreground'}>
        <TextNode node={bodyNode} />
      </div>
    </ActivityItemCard>
  );
};
