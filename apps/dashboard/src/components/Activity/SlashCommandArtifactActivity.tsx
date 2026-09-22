import { ReactElement } from 'react';
import { parseSlashCommandArtifactMessage, type FlowComponent } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ActivityItemCard } from './ActivityItemCard';
import { buildSlashCommandArtifactRoute } from '../Chat/SlashCommandArtifacts';
import { TextNode } from '../flowUI/nodes/TextNode';

/** Badge that marks an activity row as belonging to a slash-command artifact. */
export const SlashCommandArtifactBadge = ({ badge }: { badge: string }): ReactElement => (
  <span className='rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white'>
    {badge}
  </span>
);

/**
 * Body every activity row shows for an artifact message. Rendering the FlowJSON
 * card instead would repeat the artifact's own header out of context, and the
 * flat preview drops the `<userid:…>` tokens — including the mention that
 * produced the activity in the first place.
 */
export const SlashCommandArtifactActivityBody = ({
  messageId,
  body,
}: {
  messageId: string;
  body: string;
}): ReactElement => {
  const bodyNode: FlowComponent = {
    id: `${messageId}:activity-body`,
    type: 'text',
    props: { content: body },
  };

  return (
    <div className='text-sm text-foreground'>
      <TextNode node={bodyNode} />
    </div>
  );
};

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

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={getUserDisplayName(sender)}
      channelId={conversation.channelId}
      badgeIcon={<span className='text-[10px] font-bold text-white'>!</span>}
      badgeColorClass='border-background bg-orange-500'
      titlePrefix={<SlashCommandArtifactBadge badge={artifact.definition.badge} />}
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
      <SlashCommandArtifactActivityBody messageId={message.messageId} body={artifact.body} />
    </ActivityItemCard>
  );
};
